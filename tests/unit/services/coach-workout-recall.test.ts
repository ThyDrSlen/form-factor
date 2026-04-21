/**
 * coach-workout-recall unit tests.
 *
 * Covers the context assembly (db hit/miss, form-history hit/miss) and
 * the prompt shape (found vs. fallback, optional stats collapsed).
 */

const mockGetAllAsync = jest.fn();
const mockGetFormSessionHistory = jest.fn();
const mockResolveExerciseKey = jest.fn();

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    get db() {
      return { getAllAsync: mockGetAllAsync };
    },
  },
}));

jest.mock('@/lib/services/form-session-history', () => ({
  getFormSessionHistory: (...args: unknown[]) => mockGetFormSessionHistory(...args),
}));

jest.mock('@/lib/services/form-session-history-lookup', () => ({
  resolveExerciseKey: (...args: unknown[]) => mockResolveExerciseKey(...args),
}));

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  logWithTs: jest.fn(),
}));

import {
  buildWorkoutRecallContext,
  buildWorkoutRecallPrompt,
} from '@/lib/services/coach-workout-recall';

describe('coach-workout-recall', () => {
  beforeEach(() => {
    mockGetAllAsync.mockReset();
    mockGetFormSessionHistory.mockReset();
    mockResolveExerciseKey.mockReset();
    mockResolveExerciseKey.mockReturnValue('pullup');
    mockGetFormSessionHistory.mockResolvedValue([]);
  });

  describe('buildWorkoutRecallContext', () => {
    it('returns empty context when workoutId is empty', async () => {
      const ctx = await buildWorkoutRecallContext('');
      expect(ctx.found).toBe(false);
      expect(ctx.exerciseName).toBeNull();
      expect(mockGetAllAsync).not.toHaveBeenCalled();
    });

    it('returns empty context when workout row is not found', async () => {
      mockGetAllAsync.mockResolvedValueOnce([]);
      const ctx = await buildWorkoutRecallContext('missing-id');
      expect(ctx.found).toBe(false);
      expect(ctx.workoutId).toBe('missing-id');
      expect(ctx.exerciseName).toBeNull();
    });

    it('returns empty context when db query throws', async () => {
      mockGetAllAsync.mockRejectedValueOnce(new Error('db err'));
      const ctx = await buildWorkoutRecallContext('id-x');
      expect(ctx.found).toBe(false);
    });

    it('assembles structured context when workout row exists', async () => {
      mockGetAllAsync.mockResolvedValueOnce([
        {
          id: 'w-1',
          exercise: 'Pull-Up',
          sets: 5,
          reps: 8,
          weight: 0,
          duration: null,
          date: '2026-04-15T10:00:00.000Z',
        },
      ]);
      mockGetFormSessionHistory.mockResolvedValueOnce([
        { exerciseKey: 'pullup', avgFqi: 82.4, endedAt: '2026-04-14T12:00:00.000Z' },
        { exerciseKey: 'pullup', avgFqi: 74, endedAt: '2026-04-07T12:00:00.000Z' },
      ]);

      const ctx = await buildWorkoutRecallContext('w-1');
      expect(ctx.found).toBe(true);
      expect(ctx.exerciseName).toBe('Pull-Up');
      expect(ctx.sets).toBe(5);
      expect(ctx.reps).toBe(8);
      expect(ctx.dateIso).toBe('2026-04-15T10:00:00.000Z');
      expect(ctx.latestFormEntry?.avgFqi).toBe(82.4);
    });

    it('leaves latestFormEntry null when no exercise key resolves', async () => {
      mockGetAllAsync.mockResolvedValueOnce([
        { id: 'w-2', exercise: 'Weird Exotic Lift', sets: 3, reps: 5, weight: null, duration: null, date: '2026-04-15' },
      ]);
      mockResolveExerciseKey.mockReturnValueOnce(null);

      const ctx = await buildWorkoutRecallContext('w-2');
      expect(ctx.found).toBe(true);
      expect(ctx.latestFormEntry).toBeNull();
      expect(mockGetFormSessionHistory).not.toHaveBeenCalled();
    });

    it('leaves latestFormEntry null when form-history lookup throws', async () => {
      mockGetAllAsync.mockResolvedValueOnce([
        { id: 'w-3', exercise: 'Pull-Up', sets: 2, reps: 10, weight: null, duration: null, date: '2026-04-15' },
      ]);
      mockGetFormSessionHistory.mockRejectedValueOnce(new Error('storage err'));

      const ctx = await buildWorkoutRecallContext('w-3');
      expect(ctx.found).toBe(true);
      expect(ctx.latestFormEntry).toBeNull();
    });

    it('defaults sets to 0 when the db returns NaN / missing', async () => {
      mockGetAllAsync.mockResolvedValueOnce([
        { id: 'w-4', exercise: 'Pull-Up', sets: Number.NaN, reps: null, weight: null, duration: null, date: '2026-04-15' },
      ]);
      const ctx = await buildWorkoutRecallContext('w-4');
      expect(ctx.sets).toBe(0);
    });
  });

  describe('buildWorkoutRecallPrompt', () => {
    it('emits a fallback prompt when context was not found', () => {
      const prompt = buildWorkoutRecallPrompt({
        workoutId: 'missing',
        found: false,
        exerciseName: null,
        dateIso: null,
        sets: 0,
        reps: null,
        weight: null,
        durationMinutes: null,
        latestFormEntry: null,
      });
      expect(prompt).toMatch(/can't find it/i);
      expect(prompt).toMatch(/what i remember/i);
    });

    it('includes exercise, sets, reps, weight, and FQI when present', () => {
      const prompt = buildWorkoutRecallPrompt({
        workoutId: 'w-1',
        found: true,
        exerciseName: 'Pull-Up',
        dateIso: '2026-04-15T10:00:00.000Z',
        sets: 5,
        reps: 8,
        weight: 25,
        durationMinutes: null,
        latestFormEntry: {
          exerciseKey: 'pullup',
          avgFqi: 82.4,
          endedAt: '2026-04-14T12:00:00.000Z',
        },
      });
      expect(prompt).toContain('Pull-Up');
      expect(prompt).toContain('5 sets');
      expect(prompt).toContain('8 reps each');
      expect(prompt).toContain('25 lb');
      expect(prompt).toContain('82');
    });

    it('collapses missing optional stats cleanly', () => {
      const prompt = buildWorkoutRecallPrompt({
        workoutId: 'w-1',
        found: true,
        exerciseName: 'Pull-Up',
        dateIso: '2026-04-15T10:00:00.000Z',
        sets: 3,
        reps: null,
        weight: null,
        durationMinutes: null,
        latestFormEntry: null,
      });
      expect(prompt).toContain('Pull-Up');
      expect(prompt).toContain('3 sets');
      expect(prompt).not.toMatch(/\blb\b/);
      expect(prompt).not.toMatch(/reps each/);
      expect(prompt).toMatch(/no tracked form-quality data/i);
    });

    it('uses singular "set" for sets=1', () => {
      const prompt = buildWorkoutRecallPrompt({
        workoutId: 'w-1',
        found: true,
        exerciseName: 'Pull-Up',
        dateIso: '2026-04-15T10:00:00.000Z',
        sets: 1,
        reps: null,
        weight: null,
        durationMinutes: null,
        latestFormEntry: null,
      });
      expect(prompt).toContain('1 set.');
      expect(prompt).not.toContain('1 sets');
    });

    it('falls back to "an earlier day" when dateIso is null or invalid', () => {
      const prompt = buildWorkoutRecallPrompt({
        workoutId: 'w-1',
        found: true,
        exerciseName: 'Pull-Up',
        dateIso: null,
        sets: 3,
        reps: null,
        weight: null,
        durationMinutes: null,
        latestFormEntry: null,
      });
      expect(prompt).toContain('an earlier day');
    });

    it('ends with an explicit ask', () => {
      const prompt = buildWorkoutRecallPrompt({
        workoutId: 'w-1',
        found: true,
        exerciseName: 'Pull-Up',
        dateIso: '2026-04-15',
        sets: 3,
        reps: 8,
        weight: null,
        durationMinutes: null,
        latestFormEntry: null,
      });
      expect(prompt).toMatch(/debrief|what to work on next/i);
    });
  });
});
