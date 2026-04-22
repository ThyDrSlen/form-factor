const mockSendCoachPrompt = jest.fn();
const mockSendCoachGemmaPrompt = jest.fn();
const mockRecordCoachUsage = jest.fn<Promise<void>, unknown[]>();

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: (...args: unknown[]) => mockSendCoachPrompt(...args),
}));

jest.mock('@/lib/services/coach-gemma-service', () => ({
  sendCoachGemmaPrompt: (...args: unknown[]) => mockSendCoachGemmaPrompt(...args),
}));

jest.mock('@/lib/services/coach-cost-tracker', () => ({
  recordCoachUsage: (...args: unknown[]) => mockRecordCoachUsage(...args),
}));

// The service imports FrameSnapshot + JointAngles from the ARKit tracker
// barrel. We do not exercise the native side here — stub it.
jest.mock('@/lib/arkit/ARKitBodyTracker', () => ({}));

import type { FrameSnapshot, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import {
  buildPreSetPrompt,
  checkPreSetStance,
  PRE_SET_PREVIEW_TASK_KIND,
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

  beforeEach(() => {
    mockSendCoachPrompt.mockReset();
    mockSendCoachGemmaPrompt.mockReset();
    mockRecordCoachUsage.mockReset();
    mockRecordCoachUsage.mockResolvedValue(undefined);
    delete process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER;
  });

  afterAll(() => {
    if (originalProvider === undefined) {
      delete process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER;
    } else {
      process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = originalProvider;
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

  it('routes through Gemma when EXPO_PUBLIC_COACH_CLOUD_PROVIDER=gemma', async () => {
    process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'gemma';
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

  it('propagates OpenAI errors when there is no Gemma fallback path', async () => {
    mockSendCoachPrompt.mockRejectedValueOnce(new Error('coach-invoke-failed'));

    await expect(
      checkPreSetStance(snapshot, 'pushup', angles)
    ).rejects.toThrow('coach-invoke-failed');
  });

  it("records usage with taskKind: 'form_check' on the OpenAI path", async () => {
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '✓ Good',
    });

    await checkPreSetStance(snapshot, 'deadlift', angles);

    expect(mockRecordCoachUsage).toHaveBeenCalledTimes(1);
    const event = mockRecordCoachUsage.mock.calls[0][0] as {
      provider: string;
      taskKind: string;
    };
    expect(event.taskKind).toBe(PRE_SET_PREVIEW_TASK_KIND);
    expect(event.taskKind).toBe('form_check');
    expect(event.provider).toBe('openai');
  });

  it("records usage with provider 'gemma_cloud' when Gemma path succeeds", async () => {
    process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'gemma';
    mockSendCoachGemmaPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '✓ Good',
    });

    await checkPreSetStance(snapshot, 'squat', angles);

    expect(mockRecordCoachUsage).toHaveBeenCalledTimes(1);
    const event = mockRecordCoachUsage.mock.calls[0][0] as {
      provider: string;
      taskKind: string;
    };
    expect(event.taskKind).toBe('form_check');
    expect(event.provider).toBe('gemma_cloud');
  });

  it('records usage against OpenAI when Gemma throws and OpenAI fallback succeeds', async () => {
    process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER = 'gemma';
    mockSendCoachGemmaPrompt.mockRejectedValueOnce(new Error('gemma-offline'));
    mockSendCoachPrompt.mockResolvedValueOnce({
      role: 'assistant',
      content: '✓ Good',
    });

    await checkPreSetStance(snapshot, 'squat', angles);

    // Exactly one record per completed call; Gemma attempt produced no usage event
    // since it failed before the interpret/record step.
    expect(mockRecordCoachUsage).toHaveBeenCalledTimes(1);
    const event = mockRecordCoachUsage.mock.calls[0][0] as {
      provider: string;
      taskKind: string;
    };
    expect(event.provider).toBe('openai');
    expect(event.taskKind).toBe('form_check');
  });
});
