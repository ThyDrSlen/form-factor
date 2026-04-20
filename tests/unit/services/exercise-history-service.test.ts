import { getExerciseHistorySummary } from '../../../lib/services/exercise-history-service';

const mockGetWorkoutsByExercise = jest.fn();

jest.mock('../../../lib/services/database/local-db', () => ({
  localDB: {
    getWorkoutsByExercise: (...args: unknown[]) => mockGetWorkoutsByExercise(...args),
  },
}));

function row(
  id: string,
  weight: number,
  reps: number,
  date: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    exercise: 'Bench Press',
    weight,
    reps,
    sets: 1,
    date,
    synced: 1,
    deleted: 0,
    updated_at: date,
    ...overrides,
  };
}

describe('exercise-history-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty summary when local-db has no rows', async () => {
    mockGetWorkoutsByExercise.mockResolvedValue([]);

    const summary = await getExerciseHistorySummary({
      userId: 'u1',
      exerciseNameOrId: 'Bench Press',
    });

    expect(summary.sets).toEqual([]);
    expect(summary.lastSession).toBeNull();
    expect(summary.prData).toEqual([]);
    expect(summary.estimatedOneRepMax).toBe(0);
    expect(summary.volumeTrend.values).toEqual([]);
    expect(summary.repTrend.values).toEqual([]);
  });

  it('forwards limit param to local-db with default of 50', async () => {
    mockGetWorkoutsByExercise.mockResolvedValue([]);

    await getExerciseHistorySummary({ userId: 'u1', exerciseNameOrId: 'Squat' });
    expect(mockGetWorkoutsByExercise).toHaveBeenCalledWith('u1', 'Squat', 50);

    await getExerciseHistorySummary({ userId: 'u1', exerciseNameOrId: 'Squat', limit: 10 });
    expect(mockGetWorkoutsByExercise).toHaveBeenLastCalledWith('u1', 'Squat', 10);
  });

  it('filters out invalid rows (missing weight / reps)', async () => {
    mockGetWorkoutsByExercise.mockResolvedValue([
      row('a', 225, 5, '2025-04-10'),
      row('b', 0, 5, '2025-04-05'),
      row('c', 225, 0, '2025-04-01'),
    ]);

    const summary = await getExerciseHistorySummary({
      userId: 'u1',
      exerciseNameOrId: 'Bench Press',
    });

    expect(summary.sets).toHaveLength(1);
    expect(summary.sets[0].id).toBe('a');
  });

  it('sets lastSession to the first row in (newest-first) response', async () => {
    mockGetWorkoutsByExercise.mockResolvedValue([
      row('newest', 230, 5, '2025-04-15'),
      row('middle', 225, 5, '2025-04-10'),
    ]);

    const summary = await getExerciseHistorySummary({
      userId: 'u1',
      exerciseNameOrId: 'Bench Press',
    });

    expect(summary.lastSession?.id).toBe('newest');
    expect(summary.lastSession?.weight).toBe(230);
  });

  it('builds a chronologically-ordered volume trend', async () => {
    mockGetWorkoutsByExercise.mockResolvedValue([
      row('c', 230, 5, '2025-04-15', { sets: 3 }),
      row('b', 225, 5, '2025-04-10', { sets: 3 }),
      row('a', 220, 5, '2025-04-05', { sets: 3 }),
    ]);

    const summary = await getExerciseHistorySummary({
      userId: 'u1',
      exerciseNameOrId: 'Bench Press',
    });

    // Expected volumes ascending = oldest first.
    expect(summary.volumeTrend.values).toEqual([
      Math.round(220 * 5 * 3),
      Math.round(225 * 5 * 3),
      Math.round(230 * 5 * 3),
    ]);
    expect(summary.volumeTrend.dates[0]).toBe('2025-04-05');
    expect(summary.volumeTrend.dates[2]).toBe('2025-04-15');
  });

  it('computes the best estimated 1RM across the window', async () => {
    mockGetWorkoutsByExercise.mockResolvedValue([
      row('a', 225, 3, '2025-04-15'), // big 1RM estimate
      row('b', 185, 10, '2025-04-10'),
    ]);

    const summary = await getExerciseHistorySummary({
      userId: 'u1',
      exerciseNameOrId: 'Bench Press',
    });

    expect(summary.estimatedOneRepMax).toBeGreaterThan(225);
  });

  it('treats a first-ever set as a PR across all categories', async () => {
    mockGetWorkoutsByExercise.mockResolvedValue([row('first', 135, 5, '2025-04-15')]);

    const summary = await getExerciseHistorySummary({
      userId: 'u1',
      exerciseNameOrId: 'Bench Press',
    });

    const prCategories = summary.prData.filter((p) => p.isPr).map((p) => p.category);
    expect(prCategories).toContain('one_rep_max');
    expect(prCategories).toContain('five_rep_max');
    expect(prCategories).toContain('volume');
    // 3RM requires a 3-rep set; this was 5 reps, so not triggered.
    expect(prCategories).not.toContain('three_rep_max');
  });

  it('compares latest set against prior history for PR data', async () => {
    mockGetWorkoutsByExercise.mockResolvedValue([
      row('latest', 230, 5, '2025-04-15'),
      row('prev', 225, 5, '2025-04-10'),
    ]);

    const summary = await getExerciseHistorySummary({
      userId: 'u1',
      exerciseNameOrId: 'Bench Press',
    });

    const fiveRm = summary.prData.find((p) => p.category === 'five_rep_max');
    expect(fiveRm?.isPr).toBe(true);
    expect(fiveRm?.previous).toBe(225);
    expect(fiveRm?.current).toBe(230);
  });
});
