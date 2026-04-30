import type {
  ExerciseHistoryEntry,
  ExercisePersonalRecords,
} from '@/lib/services/database/local-db';
import {
  buildProgressiveOverloadSuggestion,
  detectPR,
  getLastSessionWeight,
  getSuggestedWeight,
} from '@/lib/services/progressive-overload';

function makeHistoryRow(overrides: Partial<ExerciseHistoryEntry> = {}): ExerciseHistoryEntry {
  return {
    id: overrides.id ?? 'set-1',
    session_id: overrides.session_id ?? 'session-2',
    session_exercise_id: overrides.session_exercise_id ?? 'se-1',
    exercise_id: overrides.exercise_id ?? 'ex-bench',
    set_type: overrides.set_type ?? 'normal',
    planned_weight: overrides.planned_weight === undefined ? 185 : overrides.planned_weight,
    actual_weight: overrides.actual_weight === undefined ? 185 : overrides.actual_weight,
    actual_reps: overrides.actual_reps === undefined ? 5 : overrides.actual_reps,
    actual_seconds: overrides.actual_seconds === undefined ? null : overrides.actual_seconds,
    completed_at: overrides.completed_at ?? '2026-04-30T10:05:00.000Z',
    session_started_at: overrides.session_started_at ?? '2026-04-30T10:00:00.000Z',
    session_ended_at: overrides.session_ended_at ?? '2026-04-30T10:20:00.000Z',
  };
}

describe('progressive-overload', () => {
  describe('getLastSessionWeight', () => {
    it('returns the most recent session weight', () => {
      const history = [
        makeHistoryRow({ id: 'set-new', actual_weight: 185, completed_at: '2026-04-30T10:05:00.000Z' }),
        makeHistoryRow({ id: 'set-old', session_id: 'session-1', actual_weight: 165, completed_at: '2026-04-20T10:05:00.000Z' }),
      ];

      expect(getLastSessionWeight(history)).toBe(185);
    });

    it('falls back to planned weight when actual weight is null', () => {
      const history = [
        makeHistoryRow({ actual_weight: null, planned_weight: 135 }),
      ];

      expect(getLastSessionWeight(history)).toBe(135);
    });

    it('returns null when no load exists', () => {
      const history = [
        makeHistoryRow({ actual_weight: null, planned_weight: null, actual_reps: 12 }),
      ];

      expect(getLastSessionWeight(history)).toBeNull();
    });
  });

  describe('detectPR', () => {
    it('detects a load PR for weighted exercises', () => {
      const personalRecords: ExercisePersonalRecords = {
        maxWeight: 185,
        maxReps: 8,
        maxDurationSeconds: null,
      };

      expect(detectPR({
        exercise: { id: 'ex-bench', name: 'Bench Press', is_timed: false },
        personalRecords,
        currentWeight: 190,
        currentReps: 5,
      })).toBe(true);
    });

    it('detects a rep PR for bodyweight movements with null weight', () => {
      const personalRecords: ExercisePersonalRecords = {
        maxWeight: null,
        maxReps: 15,
        maxDurationSeconds: null,
      };

      expect(detectPR({
        exercise: { id: 'ex-pushup', name: 'Push-Up', is_timed: false },
        personalRecords,
        currentWeight: null,
        currentReps: 18,
      })).toBe(true);
    });

    it('detects a time PR for timed exercises', () => {
      const personalRecords: ExercisePersonalRecords = {
        maxWeight: null,
        maxReps: null,
        maxDurationSeconds: 60,
      };

      expect(detectPR({
        exercise: { id: 'ex-plank', name: 'Plank', is_timed: true },
        personalRecords,
        currentSeconds: 75,
      })).toBe(true);
    });
  });

  describe('getSuggestedWeight', () => {
    it('repeats the last session weight for weighted lifts', () => {
      expect(getSuggestedWeight({
        exercise: { id: 'ex-bench', name: 'Bench Press', is_timed: false },
        history: [makeHistoryRow({ actual_weight: 205 })],
      })).toBe(205);
    });

    it('returns null when there is no usable load history', () => {
      expect(getSuggestedWeight({
        exercise: { id: 'ex-pushup', name: 'Push-Up', is_timed: false },
        history: [makeHistoryRow({ actual_weight: null, planned_weight: null, actual_reps: 20 })],
      })).toBeNull();
    });

    it('returns null for timed exercises', () => {
      expect(getSuggestedWeight({
        exercise: { id: 'ex-plank', name: 'Plank', is_timed: true },
        history: [makeHistoryRow({ actual_weight: null, actual_seconds: 45 })],
      })).toBeNull();
    });
  });

  describe('buildProgressiveOverloadSuggestion', () => {
    it('personalizes helper text with the last session load', () => {
      const suggestion = buildProgressiveOverloadSuggestion({
        exercise: { id: 'ex-bench', name: 'Bench Press', is_timed: false },
        history: [makeHistoryRow({ actual_weight: 185 })],
        personalRecords: { maxWeight: 185, maxReps: 8, maxDurationSeconds: null },
        unit: 'lb',
      });

      expect(suggestion.lastSessionWeight).toBe(185);
      expect(suggestion.suggestedWeight).toBe(185);
      expect(suggestion.helperText).toContain('Last session topped out at 185 lb');
    });

    it('uses a bodyweight fallback when no load history exists', () => {
      const suggestion = buildProgressiveOverloadSuggestion({
        exercise: { id: 'ex-pushup', name: 'Push-Up', is_timed: false },
        history: [makeHistoryRow({ actual_weight: null, planned_weight: null, actual_reps: 20 })],
        personalRecords: { maxWeight: null, maxReps: 20, maxDurationSeconds: null },
      });

      expect(suggestion.isBodyweightLike).toBe(true);
      expect(suggestion.suggestedWeight).toBeNull();
      expect(suggestion.helperText).toContain('bodyweight');
    });
  });
});
