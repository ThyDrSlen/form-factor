const mockSendCoachPrompt = jest.fn();
const mockSendCoachGemmaPrompt = jest.fn();
const mockAssertUnderWeeklyCap = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: (...args: unknown[]) => mockSendCoachPrompt(...args),
}));

jest.mock('@/lib/services/coach-gemma-service', () => ({
  sendCoachGemmaPrompt: (...args: unknown[]) => mockSendCoachGemmaPrompt(...args),
}));

jest.mock('@/lib/services/coach-cost-guard', () => ({
  assertUnderWeeklyCap: (...args: unknown[]) => mockAssertUnderWeeklyCap(...args),
}));

// The service imports FrameSnapshot + JointAngles from the ARKit tracker
// barrel. We do not exercise the native side here — stub it.
jest.mock('@/lib/arkit/ARKitBodyTracker', () => ({}));

import type { FrameSnapshot, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import {
  buildPreSetPrompt,
  checkPreSetStance,
} from '@/lib/services/pre-set-preview';

const snapshot: FrameSnapshot = {
  frame: 'data:image/jpeg;base64,AAAA',
  width: 320,
  height: 240,
  orientation: 'portrait',
  mirrored: false,
};

const angles: JointAngles = {
  leftKnee: 172,
  rightKnee: 170,
  leftElbow: 178,
  rightElbow: 176,
  leftHip: 165,
  rightHip: 164,
  leftShoulder: 90,
  rightShoulder: 88,
};

describe('buildPreSetPrompt', () => {
  it('includes the exercise name, serialized angles, and verdict template', () => {
    const prompt = buildPreSetPrompt('deadlift', 'L-knee 170°');
    expect(prompt).toContain('deadlift');
    expect(prompt).toContain('L-knee 170°');
    expect(prompt).toContain("'✓ Good'");
    expect(prompt).toContain('${specific adjustment}');
    expect(prompt).toContain('under 20 words');
  });
});

describe('checkPreSetStance', () => {
  const originalProvider = process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER;
  const originalDispatch = process.env.EXPO_PUBLIC_COACH_DISPATCH;

  beforeEach(() => {
    mockSendCoachPrompt.mockReset();
    mockSendCoachGemmaPrompt.mockReset();
    mockAssertUnderWeeklyCap.mockReset();
    mockAssertUnderWeeklyCap.mockResolvedValue(undefined);
    delete process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER;
    // Dispatch-flag gate (#536): Gemma path requires both env=gemma AND
    // dispatch flag on. Individual tests turn it on when they want the
    // Gemma branch; it's off by default.
    delete process.env.EXPO_PUBLIC_COACH_DISPATCH;
  });

  afterAll(() => {
    if (originalProvider === undefined) {
      delete process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER;
    } else {
      process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = originalProvider;
    }
    if (originalDispatch === undefined) {
      delete process.env.EXPO_PUBLIC_COACH_DISPATCH;
    } else {
      process.env.EXPO_PUBLIC_COACH_DISPATCH = originalDispatch;
    }
  });

  it('uses OpenAI when Gemma is not enabled and returns the coach verdict', async () => {
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '✓ Good, ready to pull.',
    });

    const result = await checkPreSetStance(snapshot, 'deadlift', angles);

    expect(result.provider).toBe('openai');
    expect(result.isFormGood).toBe(true);
    expect(result.verdict).toContain('✓ Good');
    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    const [, context] = mockSendCoachPrompt.mock.calls[0];
    expect(context.focus).toBe('pre-set-stance-preview');
  });

  it('flags warning replies as isFormGood=false', async () => {
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '⚠ Elbows should be straighter',
    });

    const result = await checkPreSetStance(snapshot, 'pullup', angles);

    expect(result.isFormGood).toBe(false);
    expect(result.verdict.startsWith('⚠')).toBe(true);
    expect(result.provider).toBe('openai');
  });

  it('routes through Gemma when EXPO_PUBLIC_COACH_CLOUD_PROVIDER=gemma and dispatch flag is on', async () => {
    process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'gemma';
    process.env.EXPO_PUBLIC_COACH_DISPATCH = 'on';
    mockSendCoachGemmaPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '✓ Good setup',
    });

    const result = await checkPreSetStance(snapshot, 'squat', angles);

    expect(result.provider).toBe('gemma');
    expect(result.isFormGood).toBe(true);
    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledTimes(1);
    expect(mockSendCoachPrompt).not.toHaveBeenCalled();
    const [, context] = mockSendCoachGemmaPrompt.mock.calls[0];
    expect(context.focus).toBe('pre-set-stance-preview-gemma');
  });

  it('falls back to OpenAI when the Gemma path throws', async () => {
    process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'gemma';
    process.env.EXPO_PUBLIC_COACH_DISPATCH = 'on';
    mockSendCoachGemmaPrompt.mockRejectedValueOnce(new Error('gemma-offline'));
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '✓ Good',
    });

    const result = await checkPreSetStance(snapshot, 'squat', angles);

    expect(result.provider).toBe('openai');
    expect(result.isFormGood).toBe(true);
    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledTimes(1);
    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    expect(mockSendCoachGemmaPrompt.mock.calls[0][1].focus).toBe(
      'pre-set-stance-preview-gemma'
    );
    expect(mockSendCoachPrompt.mock.calls[0][1].focus).toBe(
      'pre-set-stance-preview'
    );
  });

  it('skips the Gemma path when env=gemma but dispatch flag is off (#536)', async () => {
    // With env pointing at gemma but the dispatch flag unset, isGemmaEnabled()
    // now returns false so we go straight to OpenAI without calling Gemma.
    process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'gemma';
    delete process.env.EXPO_PUBLIC_COACH_DISPATCH;
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '✓ Good',
    });

    const result = await checkPreSetStance(snapshot, 'squat', angles);

    expect(result.provider).toBe('openai');
    expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
  });

  it('falls back to OpenAI when weekly Gemma cap is exceeded (#537)', async () => {
    // Both env and dispatch flag point at Gemma, but the weekly cap guard
    // throws → Gemma is never called, OpenAI owns the turn.
    process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'gemma';
    process.env.EXPO_PUBLIC_COACH_DISPATCH = 'on';
    mockAssertUnderWeeklyCap.mockRejectedValueOnce({
      domain: 'validation',
      code: 'COACH_COST_CAP_EXCEEDED',
      message: 'cap blown',
    });
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '✓ Good (openai)',
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await checkPreSetStance(snapshot, 'squat', angles);

    expect(mockAssertUnderWeeklyCap).toHaveBeenCalledTimes(1);
    expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('openai');
  });

  it('propagates OpenAI errors when there is no Gemma fallback path', async () => {
    mockSendCoachPrompt.mockRejectedValueOnce(new Error('coach-invoke-failed'));

    await expect(
      checkPreSetStance(snapshot, 'pushup', angles)
    ).rejects.toThrow('coach-invoke-failed');
  });
});
