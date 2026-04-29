import type { ExerciseHistorySummary } from '../../../lib/services/exercise-history-service';

const mockSendCoachPrompt = jest.fn();

jest.mock('../../../lib/services/coach-service', () => ({
  sendCoachPrompt: (...args: unknown[]) => mockSendCoachPrompt(...args),
}));

let buildProgressionPrompt: typeof import('../../../lib/services/progression-planner')['buildProgressionPrompt'];
let generateProgressionPlan: typeof import('../../../lib/services/progression-planner')['generateProgressionPlan'];
let clearProgressionPlanCache: typeof import('../../../lib/services/progression-planner')['clearProgressionPlanCache'];

beforeAll(() => {
  ({
    buildProgressionPrompt,
    generateProgressionPlan,
    clearProgressionPlanCache,
  } = require('../../../lib/services/progression-planner'));
});

function summaryFixture(overrides: Partial<ExerciseHistorySummary> = {}): ExerciseHistorySummary {
  const baseSet = {
    id: 's1',
    weight: 225,
    reps: 5,
    sets: 3,
    date: '2025-04-10',
  };
  return {
    exercise: 'Bench Press',
    sets: [baseSet],
    volumeTrend: { label: 'Volume', values: [3375], dates: ['2025-04-10'] },
    repTrend: { label: 'Reps per set', values: [5], dates: ['2025-04-10'] },
    lastSession: baseSet,
    prData: [
      {
        category: 'five_rep_max',
        previous: 220,
        current: 225,
        delta: 5,
        isPr: true,
        label: '5RM 225 vs prior 220',
      },
    ],
    estimatedOneRepMax: 265,
    ...overrides,
  };
}

describe('progression-planner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearProgressionPlanCache();
    mockSendCoachPrompt.mockResolvedValue({
      role: 'assistant',
      content: 'Week 1: 5x5 @ 230. Week 2: 5x5 @ 232.5. Week 3: 5x3 @ 240.',
    });
  });

  describe('buildProgressionPrompt', () => {
    it('includes exercise name and 1RM estimate', () => {
      const prompt = buildProgressionPrompt({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
      });
      expect(prompt).toMatch(/Exercise: Bench Press/);
      expect(prompt).toMatch(/Estimated 1RM: 265/);
    });

    it('includes the most recent sets in the prompt body', () => {
      const prompt = buildProgressionPrompt({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
      });
      expect(prompt).toMatch(/225lb × 5 reps \(3 sets\) on 2025-04-10/);
    });

    it('surfaces triggered PRs', () => {
      const prompt = buildProgressionPrompt({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
      });
      expect(prompt).toMatch(/5RM 225 vs prior 220/);
    });

    it('handles empty history gracefully', () => {
      const prompt = buildProgressionPrompt({
        userId: 'u1',
        exercise: 'Row',
        summary: summaryFixture({
          sets: [],
          lastSession: null,
          estimatedOneRepMax: 0,
          prData: [],
        }),
      });
      expect(prompt).toMatch(/Recent sets: no prior sets logged/);
      expect(prompt).toMatch(/Estimated 1RM: unknown/);
      expect(prompt).toMatch(/Recent PRs: no new PRs/);
    });

    it('honours a custom horizon', () => {
      const prompt = buildProgressionPrompt({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
        horizonWeeks: 6,
      });
      expect(prompt).toMatch(/6-week progressive overload plan/);
    });
  });

  describe('generateProgressionPlan', () => {
    it('calls sendCoachPrompt with a system + user message pair', async () => {
      await generateProgressionPlan({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
      });

      expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
      const [messages] = mockSendCoachPrompt.mock.calls[0];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toMatch(/Bench Press/);
    });

    it('forwards coach context for persistence', async () => {
      const context = {
        profile: { id: 'u1', name: 'Test' },
        sessionId: 'sess-1',
        focus: 'overload',
      };
      await generateProgressionPlan({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
        context,
      });

      expect(mockSendCoachPrompt.mock.calls[0][1]).toEqual(context);
    });

    it('caches plans by (user, exercise, horizon, lastSession)', async () => {
      const input = {
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
      };
      const first = await generateProgressionPlan(input);
      const second = await generateProgressionPlan(input);

      expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('re-runs the coach when the last session changes', async () => {
      await generateProgressionPlan({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
      });
      await generateProgressionPlan({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture({
          lastSession: {
            id: 's2',
            weight: 230,
            reps: 5,
            sets: 3,
            date: '2025-04-17',
          },
        }),
      });

      expect(mockSendCoachPrompt).toHaveBeenCalledTimes(2);
    });

    it('propagates coach failures to the caller', async () => {
      mockSendCoachPrompt.mockRejectedValueOnce(new Error('boom'));
      await expect(
        generateProgressionPlan({
          userId: 'u1',
          exercise: 'Bench Press',
          summary: summaryFixture(),
        }),
      ).rejects.toThrow('boom');
    });

    it('returns the coach content plus metadata', async () => {
      const plan = await generateProgressionPlan({
        userId: 'u1',
        exercise: 'Bench Press',
        summary: summaryFixture(),
      });
      expect(plan.text).toMatch(/Week 1/);
      expect(plan.promptPreview).toMatch(/Bench Press/);
      expect(plan.horizonWeeks).toBe(3);
      expect(plan.cacheKey).toMatch(/u1::Bench Press::3w::2025-04-10-225-5/);
      expect(plan.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });
});
