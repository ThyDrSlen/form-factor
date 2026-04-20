/**
 * Tests for coach-memory — AsyncStorage-backed SessionBrief / WeekSummary cache.
 *
 * AsyncStorage is mocked globally in tests/setup.ts with the jest mock
 * provided by @react-native-async-storage/async-storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cacheSessionBrief,
  getCachedSessionBrief,
  cacheWeekSummary,
  getCachedWeekSummary,
  clearSessionMemory,
  SESSION_BRIEF_KEY_PREFIX,
  WEEK_SUMMARY_KEY,
  LAST_SESSION_BRIEF_KEY,
  MEMORY_TTL_MS,
  type SessionBrief,
  type TrainingWeekSummary,
} from './coach-memory';

function makeBrief(overrides: Partial<SessionBrief> = {}): SessionBrief {
  return {
    sessionId: 'sess-1',
    startedAt: '2026-04-16T10:00:00.000Z',
    endedAt: '2026-04-16T11:00:00.000Z',
    durationMinutes: 60,
    goalProfile: 'hypertrophy',
    topExerciseName: 'Back Squat',
    totalSets: 12,
    totalReps: 80,
    avgRpe: 7.5,
    avgFqi: 0.82,
    notablePositive: 'Symmetric depth',
    notableNegative: null,
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSummary(overrides: Partial<TrainingWeekSummary> = {}): TrainingWeekSummary {
  return {
    windowStartedAt: '2026-04-09T00:00:00.000Z',
    sessionCount: 4,
    totalSets: 40,
    avgRpe: 7.2,
    avgFqi: 0.78,
    volumeTrend: 'rising',
    phase: 'building',
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('coach-memory', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  describe('cacheSessionBrief / getCachedSessionBrief', () => {
    it('round-trips a brief keyed by session id', async () => {
      const brief = makeBrief({ sessionId: 'sess-abc' });
      await cacheSessionBrief(brief);

      const got = await getCachedSessionBrief('sess-abc');
      expect(got).toEqual(brief);
    });

    it('returns the most recent brief when no session id is passed', async () => {
      await cacheSessionBrief(makeBrief({ sessionId: 'sess-old' }));
      await cacheSessionBrief(makeBrief({ sessionId: 'sess-new' }));

      const got = await getCachedSessionBrief();
      expect(got?.sessionId).toBe('sess-new');
    });

    it('returns null on cache miss', async () => {
      const got = await getCachedSessionBrief('does-not-exist');
      expect(got).toBeNull();
    });

    it('returns null when cached payload is older than TTL', async () => {
      const old = makeBrief({
        cachedAt: new Date(Date.now() - MEMORY_TTL_MS - 1000).toISOString(),
      });
      // Bypass the write path's fresh-at stamp — write directly.
      await AsyncStorage.setItem(
        `${SESSION_BRIEF_KEY_PREFIX}${old.sessionId}`,
        JSON.stringify(old),
      );

      const got = await getCachedSessionBrief(old.sessionId);
      expect(got).toBeNull();
    });

    it('returns null when cached payload is corrupt JSON', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      await AsyncStorage.setItem(LAST_SESSION_BRIEF_KEY, 'not-json{{{');
      const got = await getCachedSessionBrief();
      expect(got).toBeNull();
    });

    it('returns null when cached payload lacks a sessionId', async () => {
      await AsyncStorage.setItem(LAST_SESSION_BRIEF_KEY, JSON.stringify({ wrong: 'shape' }));
      const got = await getCachedSessionBrief();
      expect(got).toBeNull();
    });
  });

  describe('cacheWeekSummary / getCachedWeekSummary', () => {
    it('round-trips a summary', async () => {
      const summary = makeSummary();
      await cacheWeekSummary(summary);

      const got = await getCachedWeekSummary();
      expect(got).toEqual(summary);
    });

    it('returns null on cache miss', async () => {
      const got = await getCachedWeekSummary();
      expect(got).toBeNull();
    });

    it('returns null when summary is stale', async () => {
      const stale = makeSummary({
        cachedAt: new Date(Date.now() - MEMORY_TTL_MS - 1000).toISOString(),
      });
      await AsyncStorage.setItem(WEEK_SUMMARY_KEY, JSON.stringify(stale));

      const got = await getCachedWeekSummary();
      expect(got).toBeNull();
    });

    it('returns null when summary is corrupt', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      await AsyncStorage.setItem(WEEK_SUMMARY_KEY, '<<not json>>');

      const got = await getCachedWeekSummary();
      expect(got).toBeNull();
    });
  });

  describe('clearSessionMemory', () => {
    it('removes all session briefs and the week summary', async () => {
      await cacheSessionBrief(makeBrief({ sessionId: 'sess-1' }));
      await cacheSessionBrief(makeBrief({ sessionId: 'sess-2' }));
      await cacheWeekSummary(makeSummary());
      // Unrelated key — must survive.
      await AsyncStorage.setItem('unrelated-key', 'keep-me');

      await clearSessionMemory();

      expect(await AsyncStorage.getItem(`${SESSION_BRIEF_KEY_PREFIX}sess-1`)).toBeNull();
      expect(await AsyncStorage.getItem(`${SESSION_BRIEF_KEY_PREFIX}sess-2`)).toBeNull();
      expect(await AsyncStorage.getItem(LAST_SESSION_BRIEF_KEY)).toBeNull();
      expect(await AsyncStorage.getItem(WEEK_SUMMARY_KEY)).toBeNull();
      expect(await AsyncStorage.getItem('unrelated-key')).toBe('keep-me');
    });

    it('is a no-op when nothing is cached', async () => {
      await expect(clearSessionMemory()).resolves.toBeUndefined();
    });
  });

  describe('error resilience', () => {
    it('swallows AsyncStorage.setItem errors without throwing', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest
        .spyOn(AsyncStorage, 'setItem')
        .mockRejectedValueOnce(new Error('disk full'));

      await expect(cacheSessionBrief(makeBrief())).resolves.toBeUndefined();
    });

    it('swallows AsyncStorage.getItem errors and returns null', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest
        .spyOn(AsyncStorage, 'getItem')
        .mockRejectedValueOnce(new Error('io error'));

      const got = await getCachedSessionBrief();
      expect(got).toBeNull();
    });
  });
});
