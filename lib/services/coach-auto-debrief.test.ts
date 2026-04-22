/**
 * Tests for coach-auto-debrief orchestrator.
 *
 * Covers the happy path, provider fallback, feature flag gating, caching,
 * and memory-synth failure resilience. Mocks:
 *   - @/lib/services/coach-service.sendCoachPrompt
 *   - @/lib/services/coach-memory-context.synthesizeMemoryClause
 *   - AsyncStorage (from tests/setup.ts global mock)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---- sendCoachPrompt mock --------------------------------------------------
const mockSendCoachPrompt = jest.fn();
jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: (...args: unknown[]) => mockSendCoachPrompt(...args),
}));

// ---- sendCoachGemmaPrompt mock ---------------------------------------------
const mockSendCoachGemmaPrompt = jest.fn();
jest.mock('@/lib/services/coach-gemma-service', () => ({
  sendCoachGemmaPrompt: (...args: unknown[]) => mockSendCoachGemmaPrompt(...args),
}));

// ---- synthesizeMemoryClause mock -------------------------------------------
const mockSynth = jest.fn();
jest.mock('@/lib/services/coach-memory-context', () => ({
  synthesizeMemoryClause: (...args: unknown[]) => mockSynth(...args),
}));

// ---- cost-guard mock (#537) ------------------------------------------------
const mockAssertUnderWeeklyCap = jest.fn().mockResolvedValue(undefined);
jest.mock('./coach-cost-guard', () => ({
  assertUnderWeeklyCap: (...args: unknown[]) => mockAssertUnderWeeklyCap(...args),
}));

import {
  AUTO_DEBRIEF_KEY_PREFIX,
  cacheAutoDebrief,
  clearAutoDebrief,
  generateAutoDebrief,
  getCachedAutoDebrief,
  isAutoDebriefEnabled,
  resolveCloudProvider,
} from './coach-auto-debrief';
import type { DebriefAnalytics } from './coach-debrief-prompt';

function analytics(overrides: Partial<DebriefAnalytics> = {}): DebriefAnalytics {
  return {
    sessionId: 'sess-1',
    exerciseName: 'Back Squat',
    repCount: 5,
    avgFqi: 0.8,
    fqiTrendSlope: 0.01,
    topFault: 'depth_short',
    maxSymmetryPct: 8,
    tempoTrendSlope: 10,
    reps: [],
    ...overrides,
  };
}

describe('coach-auto-debrief', () => {
  const ORIGINAL_DISPATCH = process.env.EXPO_PUBLIC_COACH_DISPATCH;

  beforeEach(async () => {
    await AsyncStorage.clear();
    mockSendCoachPrompt.mockReset();
    mockSendCoachGemmaPrompt.mockReset();
    mockSynth.mockReset();
    mockAssertUnderWeeklyCap.mockReset();
    mockAssertUnderWeeklyCap.mockResolvedValue(undefined);
    mockSynth.mockResolvedValue({ text: null, lastBrief: null, weekSummary: null });
    delete process.env.EXPO_PUBLIC_COACH_AUTO_DEBRIEF_ENABLED;
    delete process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER;
    delete process.env.EXPO_PUBLIC_COACH_DISPATCH;
  });

  afterEach(() => {
    if (ORIGINAL_DISPATCH === undefined) {
      delete process.env.EXPO_PUBLIC_COACH_DISPATCH;
    } else {
      process.env.EXPO_PUBLIC_COACH_DISPATCH = ORIGINAL_DISPATCH;
    }
  });

  // -------------------------------------------------------------------
  // Feature flag
  // -------------------------------------------------------------------
  describe('isAutoDebriefEnabled', () => {
    it('is enabled by default (unset env)', () => {
      expect(isAutoDebriefEnabled()).toBe(true);
    });

    it('accepts truthy values', () => {
      for (const v of ['true', '1', 'on', 'TRUE']) {
        process.env.EXPO_PUBLIC_COACH_AUTO_DEBRIEF_ENABLED = v;
        expect(isAutoDebriefEnabled()).toBe(true);
      }
    });

    it('respects a falsey value', () => {
      process.env.EXPO_PUBLIC_COACH_AUTO_DEBRIEF_ENABLED = 'false';
      expect(isAutoDebriefEnabled()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // resolveCloudProvider
  // -------------------------------------------------------------------
  describe('resolveCloudProvider', () => {
    it('defaults to openai', () => {
      expect(resolveCloudProvider()).toBe('openai');
    });

    it('returns gemma when env requests it', () => {
      process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'gemma';
      expect(resolveCloudProvider()).toBe('gemma');
    });

    it('falls back to openai for unknown providers', () => {
      process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'llama';
      expect(resolveCloudProvider()).toBe('openai');
    });
  });

  // -------------------------------------------------------------------
  // Cache helpers
  // -------------------------------------------------------------------
  describe('cache helpers', () => {
    it('round-trips through AsyncStorage', async () => {
      await cacheAutoDebrief({
        sessionId: 'sess-1',
        provider: 'openai',
        brief: 'Solid session.',
        generatedAt: new Date().toISOString(),
      });
      const got = await getCachedAutoDebrief('sess-1');
      expect(got?.brief).toBe('Solid session.');
    });

    it('returns null on corrupt payloads', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      await AsyncStorage.setItem(`${AUTO_DEBRIEF_KEY_PREFIX}sess-1`, 'garbage{{{');
      const got = await getCachedAutoDebrief('sess-1');
      expect(got).toBeNull();
    });

    it('clearAutoDebrief removes only the targeted entry', async () => {
      await cacheAutoDebrief({
        sessionId: 'sess-1',
        provider: 'openai',
        brief: 'a',
        generatedAt: new Date().toISOString(),
      });
      await cacheAutoDebrief({
        sessionId: 'sess-2',
        provider: 'openai',
        brief: 'b',
        generatedAt: new Date().toISOString(),
      });
      await clearAutoDebrief('sess-1');
      expect(await getCachedAutoDebrief('sess-1')).toBeNull();
      expect(await getCachedAutoDebrief('sess-2')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // generateAutoDebrief
  // -------------------------------------------------------------------
  describe('generateAutoDebrief', () => {
    it('throws when the feature is disabled', async () => {
      process.env.EXPO_PUBLIC_COACH_AUTO_DEBRIEF_ENABLED = 'false';
      await expect(
        generateAutoDebrief({ sessionId: 'sess-1', analytics: analytics() }),
      ).rejects.toThrow(/disabled/);
    });

    it('returns the cached brief without calling the coach when one exists', async () => {
      await cacheAutoDebrief({
        sessionId: 'sess-1',
        provider: 'openai',
        brief: 'cached',
        generatedAt: new Date().toISOString(),
      });

      const result = await generateAutoDebrief({ sessionId: 'sess-1', analytics: analytics() });
      expect(result.brief).toBe('cached');
      expect(mockSendCoachPrompt).not.toHaveBeenCalled();
    });

    it('invokes sendCoachPrompt, shapes, and caches the reply on the happy path', async () => {
      mockSendCoachPrompt.mockResolvedValue({
        role: 'assistant',
        content: '• Great reps.\n• Watch depth.\u200B',
      });

      const result = await generateAutoDebrief({
        sessionId: 'sess-abc',
        analytics: analytics({ sessionId: 'sess-abc' }),
        athleteName: 'Pat',
      });

      expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
      // Shaped: bullet glyph -> "- " and zero-width stripped.
      expect(result.brief).toMatch(/- Great reps/);
      expect(result.brief).not.toMatch(/\u200B/);

      // Cached.
      const cached = await getCachedAutoDebrief('sess-abc');
      expect(cached?.brief).toBe(result.brief);
    });

    it('passes athleteName and memoryClause through to the prompt', async () => {
      mockSynth.mockResolvedValue({
        text: 'Prior session was moderate.',
        lastBrief: null,
        weekSummary: null,
      });
      mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: 'OK' });

      await generateAutoDebrief({
        sessionId: 'sess-1',
        analytics: analytics(),
        athleteName: 'Pat',
      });

      const [, context] = mockSendCoachPrompt.mock.calls[0];
      expect(context.memoryClause).toBe('Prior session was moderate.');
      expect(context.focus).toBe('post_session_debrief');
    });

    it('survives synthesizeMemoryClause throwing', async () => {
      mockSynth.mockRejectedValue(new Error('memory boom'));
      mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: 'OK' });
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await generateAutoDebrief({ sessionId: 'sess-1', analytics: analytics() });
      expect(result.brief).toBe('OK');
    });

    it('uses explicit memoryClause when provided (skips synth)', async () => {
      mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: 'OK' });

      await generateAutoDebrief({
        sessionId: 'sess-1',
        analytics: analytics(),
        memoryClause: 'explicit',
      });

      expect(mockSynth).not.toHaveBeenCalled();
      const [, context] = mockSendCoachPrompt.mock.calls[0];
      expect(context.memoryClause).toBe('explicit');
    });

    it('propagates downstream coach errors so the UI can retry', async () => {
      mockSendCoachPrompt.mockRejectedValue(Object.assign(new Error('boom'), { domain: 'network' }));
      await expect(
        generateAutoDebrief({ sessionId: 'sess-1', analytics: analytics() }),
      ).rejects.toMatchObject({ message: 'boom' });
    });

    it('gemma provider falls back to sendCoachPrompt on sendCoachGemmaPrompt failure', async () => {
      // Gemma path now calls sendCoachGemmaPrompt directly; on failure we
      // fall back to sendCoachPrompt (the OpenAI-backed generic path).
      // Dispatch-flag gate (#536): the direct Gemma call is only attempted
      // when the global dispatch flag is on — flip it on explicitly here.
      process.env.EXPO_PUBLIC_COACH_DISPATCH = 'on';
      mockSendCoachGemmaPrompt.mockRejectedValueOnce(new Error('gemma unavailable'));
      mockSendCoachPrompt.mockResolvedValueOnce({
        role: 'assistant',
        content: 'Fallback brief.',
      });
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await generateAutoDebrief({
        sessionId: 'sess-gem',
        analytics: analytics(),
        provider: 'gemma',
      });

      expect(mockSendCoachGemmaPrompt).toHaveBeenCalledTimes(1);
      expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
      expect(result.brief).toBe('Fallback brief.');
      expect(result.provider).toBe('gemma');
    });

    it('skips direct Gemma call and falls through to OpenAI when dispatch flag is off (#536)', async () => {
      // When EXPO_PUBLIC_COACH_DISPATCH is unset or !== 'on', the gemma
      // branch in `dispatch()` is bypassed entirely — sendCoachGemmaPrompt
      // is never called, and sendCoachPrompt (OpenAI by default) owns the turn.
      delete process.env.EXPO_PUBLIC_COACH_DISPATCH;
      mockSendCoachPrompt.mockResolvedValueOnce({
        role: 'assistant',
        content: 'OpenAI brief.',
      });

      const result = await generateAutoDebrief({
        sessionId: 'sess-no-dispatch',
        analytics: analytics(),
        provider: 'gemma',
      });

      expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
      expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
      expect(result.brief).toBe('OpenAI brief.');
      // provider annotation on result is the *resolved* provider preference,
      // not the path actually taken — keep the existing shape.
      expect(result.provider).toBe('gemma');
    });

    it('falls back to OpenAI when weekly Gemma cap is exceeded (#537)', async () => {
      // Dispatch flag is on, but assertUnderWeeklyCap throws — dispatch()
      // catches and switches to the generic OpenAI path without invoking
      // sendCoachGemmaPrompt at all.
      process.env.EXPO_PUBLIC_COACH_DISPATCH = 'on';
      mockAssertUnderWeeklyCap.mockRejectedValueOnce({
        domain: 'validation',
        code: 'COACH_COST_CAP_EXCEEDED',
        message: 'cap blown',
      });
      mockSendCoachPrompt.mockResolvedValueOnce({
        role: 'assistant',
        content: 'OpenAI fallback.',
      });
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await generateAutoDebrief({
        sessionId: 'sess-cap',
        analytics: analytics(),
        provider: 'gemma',
      });

      expect(mockAssertUnderWeeklyCap).toHaveBeenCalledTimes(1);
      expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
      expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
      expect(result.brief).toBe('OpenAI fallback.');
    });
  });
});
