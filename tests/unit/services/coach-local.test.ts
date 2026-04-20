// Mock dependencies before importing the module under test.
jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    getAllWorkouts: jest.fn(),
  },
}));

jest.mock('@/lib/services/coach-context-enricher', () => ({
  enrichCoachContext: jest.fn(),
}));

jest.mock('@/lib/services/coach-telemetry', () => ({
  recordContextTokens: jest.fn(),
  recordFallback: jest.fn(),
  recordSafetyReject: jest.fn(),
}));

import {
  COACH_LOCAL_NOT_AVAILABLE,
  buildLocalPrompt,
  finalizeOutput,
  sendCoachPromptLocal,
} from '@/lib/services/coach-local';
import { enrichCoachContext } from '@/lib/services/coach-context-enricher';
import {
  recordContextTokens,
  recordFallback,
  recordSafetyReject,
} from '@/lib/services/coach-telemetry';

const mockEnrich = enrichCoachContext as jest.Mock;
const mockContextTokens = recordContextTokens as jest.Mock;
const mockFallback = recordFallback as jest.Mock;
const mockSafetyReject = recordSafetyReject as jest.Mock;

describe('coach-local / sentinel behaviour', () => {
  beforeEach(() => {
    mockEnrich.mockReset().mockResolvedValue('');
    mockContextTokens.mockReset();
    mockFallback.mockReset();
    mockSafetyReject.mockReset();
  });

  it('throws the COACH_LOCAL_NOT_AVAILABLE sentinel', async () => {
    await expect(
      sendCoachPromptLocal([{ role: 'user', content: 'hi' }])
    ).rejects.toMatchObject({
      domain: 'ml',
      code: COACH_LOCAL_NOT_AVAILABLE,
      retryable: false,
    });
  });

  it('exposes a stable error code string', () => {
    expect(COACH_LOCAL_NOT_AVAILABLE).toBe('COACH_LOCAL_NOT_AVAILABLE');
  });

  it('records fallback telemetry even though runtime throws', async () => {
    await expect(
      sendCoachPromptLocal([{ role: 'user', content: 'hi' }])
    ).rejects.toBeDefined();
    expect(mockFallback).toHaveBeenCalledWith('runtime_unavailable');
  });
});

describe('coach-local / context enrichment wiring', () => {
  beforeEach(() => {
    mockEnrich.mockReset();
    mockContextTokens.mockReset();
  });

  it('runs enrichCoachContext for default fitness_coach focus', async () => {
    mockEnrich.mockResolvedValue('Last 2 workouts: squat, deadlift.');
    await expect(
      sendCoachPromptLocal([{ role: 'user', content: 'plan my day' }])
    ).rejects.toBeDefined();
    expect(mockEnrich).toHaveBeenCalledTimes(1);
    expect(mockContextTokens).toHaveBeenCalledTimes(1);
    const [tokens] = mockContextTokens.mock.calls[0] as [number];
    expect(tokens).toBeGreaterThan(0);
  });

  it('skips enrichCoachContext for non-fitness focus', async () => {
    mockEnrich.mockResolvedValue('');
    await expect(
      sendCoachPromptLocal([{ role: 'user', content: 'meal plan' }], {
        focus: 'nutrition',
      })
    ).rejects.toBeDefined();
    expect(mockEnrich).not.toHaveBeenCalled();
    expect(mockContextTokens).not.toHaveBeenCalled();
  });
});

describe('coach-local / buildLocalPrompt', () => {
  beforeEach(() => {
    mockEnrich.mockReset().mockResolvedValue('');
  });

  it('renders a Gemma prompt with start/end turn markers', async () => {
    const prompt = await buildLocalPrompt([{ role: 'user', content: 'hi' }]);
    expect(prompt).toContain('<start_of_turn>user\n');
    expect(prompt.endsWith('<start_of_turn>model\n')).toBe(true);
  });

  it('includes the history summary when enricher returns one', async () => {
    mockEnrich.mockResolvedValue('Last 1 workouts: Deadlift.');
    const prompt = await buildLocalPrompt(
      [{ role: 'user', content: 'what next' }],
      { focus: 'fitness_coach' }
    );
    expect(prompt).toContain('Recent training context');
    expect(prompt).toContain('Deadlift');
  });
});

describe('coach-local / finalizeOutput safety hook', () => {
  beforeEach(() => {
    mockSafetyReject.mockReset();
  });

  it('returns a clean assistant message on safe input', () => {
    const msg = finalizeOutput('Try 3 sets of 10 goblet squats.');
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('Try 3 sets of 10 goblet squats.');
    expect(mockSafetyReject).not.toHaveBeenCalled();
  });

  it('throws COACH_LOCAL_UNSAFE and records the reject metric', () => {
    expect(() => finalizeOutput('push through the injury')).toThrow();
    expect(mockSafetyReject).toHaveBeenCalledTimes(1);
    const [metric] = mockSafetyReject.mock.calls[0] as [string, string?];
    expect(metric).toBe('Safety/NoInjuryPushThrough');
  });
});
