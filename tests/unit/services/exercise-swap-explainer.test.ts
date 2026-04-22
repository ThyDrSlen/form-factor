/**
 * Unit tests for exercise-swap-explainer (wave-34 G5).
 *
 * Covers:
 * - happy path: Gemma reply is trimmed + shaped and surfaced.
 * - fallback on Gemma throw: generic fallback string, provider='fallback'.
 * - fallback on empty Gemma reply: generic fallback string.
 * - taskKind propagation via sendCoachPrompt opts.
 * - prompt builder shape (system + user roles, includes swap fields).
 * - optional reason + goal threading.
 */

const mockSendCoachPrompt = jest.fn();

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: mockSendCoachPrompt,
}));

import type { ExerciseSwapContext } from '@/lib/services/exercise-swap-explainer';

let explainExerciseSwap: typeof import('@/lib/services/exercise-swap-explainer')['explainExerciseSwap'];
let buildExerciseSwapMessages: typeof import('@/lib/services/exercise-swap-explainer')['buildExerciseSwapMessages'];
let EXERCISE_SWAP_FALLBACK_TEXT: typeof import('@/lib/services/exercise-swap-explainer')['EXERCISE_SWAP_FALLBACK_TEXT'];
let EXERCISE_SWAP_SYSTEM_PROMPT: typeof import('@/lib/services/exercise-swap-explainer')['EXERCISE_SWAP_SYSTEM_PROMPT'];

const baseCtx: ExerciseSwapContext = {
  fromExerciseId: 'barbell-back-squat',
  toExerciseId: 'goblet-squat',
  reason: 'equipment',
  userGoal: 'hypertrophy',
};

describe('exercise-swap-explainer', () => {
  beforeAll(() => {
    ({
      explainExerciseSwap,
      buildExerciseSwapMessages,
      EXERCISE_SWAP_FALLBACK_TEXT,
      EXERCISE_SWAP_SYSTEM_PROMPT,
    } = require('@/lib/services/exercise-swap-explainer'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds a two-message payload with SYSTEM prompt and user fields', () => {
    const msgs = buildExerciseSwapMessages(baseCtx);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe(EXERCISE_SWAP_SYSTEM_PROMPT);
    expect(msgs[1].role).toBe('user');
    const userText = msgs[1].content;
    expect(userText).toContain('barbell-back-squat');
    expect(userText).toContain('goblet-squat');
    expect(userText).toContain('equipment');
    expect(userText).toContain('hypertrophy');
  });

  it('omits reason and goal lines when not provided', () => {
    const minimal = buildExerciseSwapMessages({
      fromExerciseId: 'a',
      toExerciseId: 'b',
    });
    expect(minimal[1].content).not.toMatch(/Reason for swap/);
    expect(minimal[1].content).not.toMatch(/Lifter goal/);
  });

  it('happy path: returns shaped Gemma reply with provider metadata', async () => {
    mockSendCoachPrompt.mockResolvedValue({
      role: 'assistant',
      content: '  Both hit quads and glutes. Goblet reduces spinal load but limits absolute load.  ',
      provider: 'gemma_cloud',
      model: 'gemma-4-26b-a4b-it',
    });
    const result = await explainExerciseSwap(baseCtx);
    expect(result.explanation).toBe(
      'Both hit quads and glutes. Goblet reduces spinal load but limits absolute load.',
    );
    expect(result.provider).toBe('gemma_cloud');
    expect(result.model).toBe('gemma-4-26b-a4b-it');
  });

  it('propagates taskKind="exercise_swap_explanation" and provider=gemma in opts', async () => {
    mockSendCoachPrompt.mockResolvedValue({
      role: 'assistant',
      content: 'ok',
    });
    await explainExerciseSwap(baseCtx);
    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toMatchObject({
      provider: 'gemma',
      taskKind: 'exercise_swap_explanation',
    });
  });

  it('falls back to generic string when Gemma throws', async () => {
    mockSendCoachPrompt.mockRejectedValue(new Error('Gemma unreachable'));
    const result = await explainExerciseSwap(baseCtx);
    expect(result.explanation).toBe(EXERCISE_SWAP_FALLBACK_TEXT);
    expect(result.provider).toBe('fallback');
    expect(result.model).toBe('fallback');
  });

  it('falls back when Gemma returns an empty body', async () => {
    mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: '   ' });
    const result = await explainExerciseSwap(baseCtx);
    expect(result.explanation).toBe(EXERCISE_SWAP_FALLBACK_TEXT);
    expect(result.provider).toBe('fallback');
  });

  it('never throws even on unexpected error shapes', async () => {
    mockSendCoachPrompt.mockRejectedValue('string-shaped error');
    await expect(explainExerciseSwap(baseCtx)).resolves.toMatchObject({
      explanation: EXERCISE_SWAP_FALLBACK_TEXT,
      provider: 'fallback',
    });
  });
});
