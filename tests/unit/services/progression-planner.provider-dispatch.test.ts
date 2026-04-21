/**
 * Pipeline-v2 provider dispatch tests for progression-planner.
 * Verifies EXPO_PUBLIC_COACH_CLOUD_PROVIDER is honoured when the master
 * flag is on; legacy behavior (no opts) when the flag is off.
 */

import type { ExerciseHistorySummary } from '../../../lib/services/exercise-history-service';

const mockSendCoachPrompt = jest.fn();

jest.mock('../../../lib/services/coach-service', () => ({
  sendCoachPrompt: (...args: unknown[]) => mockSendCoachPrompt(...args),
}));

let generateProgressionPlan: typeof import('../../../lib/services/progression-planner')['generateProgressionPlan'];
let clearProgressionPlanCache: typeof import('../../../lib/services/progression-planner')['clearProgressionPlanCache'];

beforeAll(() => {
  ({ generateProgressionPlan, clearProgressionPlanCache } = require(
    '../../../lib/services/progression-planner',
  ));
});

const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const PROVIDER = 'EXPO_PUBLIC_COACH_CLOUD_PROVIDER';
const originalFlag = process.env[FLAG];
const originalProvider = process.env[PROVIDER];

function summary(): ExerciseHistorySummary {
  return {
    exercise: 'Bench Press',
    sets: [{ id: 's1', weight: 225, reps: 5, sets: 3, date: '2026-04-10' }],
    volumeTrend: { label: 'Volume', values: [3375], dates: ['2026-04-10'] },
    repTrend: { label: 'Reps', values: [5], dates: ['2026-04-10'] },
    lastSession: { id: 's1', weight: 225, reps: 5, sets: 3, date: '2026-04-10' },
    prData: [],
    estimatedOneRepMax: 260,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearProgressionPlanCache();
  mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: 'plan' });
});

afterEach(() => {
  for (const [k, v] of [
    [FLAG, originalFlag],
    [PROVIDER, originalProvider],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('progression-planner provider dispatch (pipeline-v2)', () => {
  it('forwards provider=gemma when flag is on and env=gemma', async () => {
    process.env[FLAG] = 'on';
    process.env[PROVIDER] = 'gemma';

    await generateProgressionPlan({
      userId: 'u1',
      exercise: 'Bench Press',
      summary: summary(),
    });

    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toEqual({ provider: 'gemma' });
  });

  it('forwards provider=openai when flag is on and env=openai', async () => {
    process.env[FLAG] = 'on';
    process.env[PROVIDER] = 'openai';

    await generateProgressionPlan({
      userId: 'u1',
      exercise: 'Bench Press',
      summary: summary(),
    });

    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toEqual({ provider: 'openai' });
  });

  it('omits provider opts when flag is off (legacy behavior)', async () => {
    delete process.env[FLAG];
    process.env[PROVIDER] = 'gemma';

    await generateProgressionPlan({
      userId: 'u1',
      exercise: 'Bench Press',
      summary: summary(),
    });

    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toBeUndefined();
  });
});
