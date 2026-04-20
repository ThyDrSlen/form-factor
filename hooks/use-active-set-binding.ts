/**
 * useActiveSetBinding
 *
 * Bridges the ARKit scan overlay to the live workout session. Given the
 * current `detectionMode` (e.g., 'pullup'), it finds the matching
 * session exercise in useSessionRunner and exposes the active set +
 * `commitReps(repCount)` writer.
 *
 * Matching rules (loose, offline-safe):
 *   1. exercise.name startsWith mode's displayName (case-insensitive)
 *   2. exercise.id contains mode (e.g., 'pullup-bodyweight')
 *   3. fallback: first session_exercise when no match found
 */
import { useCallback, useMemo } from 'react';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { getWorkoutByMode, type DetectionMode } from '@/lib/workouts';
import type {
  WorkoutSessionExercise,
  WorkoutSessionSet,
  Exercise,
} from '@/lib/types/workout-session';

export interface ActiveSetBinding {
  /** True when the scan overlay has an active session + matching exercise + unfinished set. */
  isBound: boolean;
  /** The matched session-exercise row (null if nothing to bind to). */
  sessionExercise: (WorkoutSessionExercise & { exercise?: Exercise }) | null;
  /** The next pending set (first set without completed_at). */
  activeSet: WorkoutSessionSet | null;
  /** 1-indexed position of the active set within the exercise (e.g., 2 of 4). */
  activeSetIndex: number;
  /** Total number of sets planned for the bound exercise. */
  totalSets: number;
  /** Human-readable label for the active set, e.g. "Set 2 of 4". */
  setLabel: string;
  /**
   * Write `repCount` to `active_set.actual_reps` and complete the set.
   * No-op when nothing is bound. Returns the setId on success, null on miss.
   */
  commitReps: (repCount: number) => Promise<string | null>;
}

export function useActiveSetBinding(detectionMode: DetectionMode | null | undefined): ActiveSetBinding {
  const activeSession = useSessionRunner((s) => s.activeSession);
  const exercises = useSessionRunner((s) => s.exercises);
  const sets = useSessionRunner((s) => s.sets);
  const updateSet = useSessionRunner((s) => s.updateSet);
  const completeSet = useSessionRunner((s) => s.completeSet);

  const matchInfo = useMemo(() => {
    if (!activeSession || !detectionMode) {
      return { sessionExercise: null, activeSet: null, activeSetIndex: 0, totalSets: 0 };
    }
    const def = getWorkoutByMode(detectionMode);
    const modeId = detectionMode.toLowerCase();
    const modeName = def.displayName.toLowerCase();

    const matched = findExerciseForMode(exercises, modeId, modeName);
    if (!matched) {
      return { sessionExercise: null, activeSet: null, activeSetIndex: 0, totalSets: 0 };
    }

    const exSets = sets[matched.id] ?? [];
    const totalSets = exSets.length;
    const pendingIndex = exSets.findIndex((s) => !s.completed_at);
    if (pendingIndex === -1) {
      return { sessionExercise: matched, activeSet: null, activeSetIndex: totalSets, totalSets };
    }
    return {
      sessionExercise: matched,
      activeSet: exSets[pendingIndex],
      activeSetIndex: pendingIndex + 1,
      totalSets,
    };
  }, [activeSession, detectionMode, exercises, sets]);

  const commitReps = useCallback(
    async (repCount: number): Promise<string | null> => {
      const set = matchInfo.activeSet;
      if (!set) return null;
      const safeReps = Math.max(0, Math.round(repCount));
      await updateSet(set.id, { actual_reps: safeReps });
      await completeSet(set.id);
      return set.id;
    },
    [matchInfo.activeSet, updateSet, completeSet],
  );

  const setLabel = matchInfo.sessionExercise && matchInfo.totalSets > 0
    ? `Set ${Math.max(1, matchInfo.activeSetIndex)} of ${matchInfo.totalSets}`
    : '';

  return {
    isBound: matchInfo.sessionExercise != null && matchInfo.activeSet != null,
    sessionExercise: matchInfo.sessionExercise,
    activeSet: matchInfo.activeSet,
    activeSetIndex: matchInfo.activeSetIndex,
    totalSets: matchInfo.totalSets,
    setLabel,
    commitReps,
  };
}

function findExerciseForMode(
  exercises: (WorkoutSessionExercise & { exercise?: Exercise })[],
  modeId: string,
  modeName: string,
): (WorkoutSessionExercise & { exercise?: Exercise }) | null {
  if (exercises.length === 0) return null;

  const normalizedModeName = modeName.replace(/[\s\-_]/g, '').toLowerCase();

  for (const ex of exercises) {
    const name = (ex.exercise?.name ?? '').toLowerCase();
    const normalizedName = name.replace(/[\s\-_]/g, '');
    if (normalizedName.startsWith(normalizedModeName) && normalizedModeName.length > 0) {
      return ex;
    }
  }
  for (const ex of exercises) {
    const id = (ex.exercise_id ?? '').toLowerCase();
    if (id.includes(modeId)) return ex;
  }
  return null;
}
