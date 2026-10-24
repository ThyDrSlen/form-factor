/**
 * use-practice-session
 *
 * Thin hook that drives the practice-mode surface from issue #479.
 *
 * It reads/writes the `usePracticeSession` Zustand store and exposes an
 * imperative API (`start`, `end`, `reset`, `handleRep`) wired up so that
 * persistence is ALWAYS short-circuited. Specifically, this hook:
 *
 *   - Does NOT call `upsertSessionMetrics` (cue-logger → Supabase).
 *   - Does NOT call `createWorkout` / `addWorkout` (Workouts context).
 *   - Does NOT emit `watchBridge` / watch-connectivity messages.
 *   - Does NOT touch `session-runner.startSession` (which would write to SQLite).
 *
 * Callers rendering inside the practice modal should plumb the pose-tracking
 * results into `handleRep()` / `setRepCount()` / `setCurrentFqi()` — this
 * hook's job is to surface state for the UI, not to wire tracking.
 */

import { useCallback, useEffect } from 'react';
import {
  usePracticeSession,
  practiceSelectors,
  type PracticeSessionState,
} from '@/lib/stores/practice-session-store';
import type { DetectionMode } from '@/lib/workouts';

export interface UsePracticeSessionValue {
  /** Current practice phase. */
  phase: PracticeSessionState['phase'];
  /** Active detection-mode id, or null if none chosen yet. */
  activeExerciseKey: DetectionMode | null;
  /** Running rep count. */
  repCount: number;
  /** Latest Form Quality Index, or null. */
  currentFqi: number | null;
  /** True when `phase === 'running'`. */
  isRunning: boolean;
  /** True when `phase === 'ended'`. */
  hasEnded: boolean;
  /** Milliseconds elapsed since start (live during run, frozen after end). */
  durationMs: number | null;
  /** Begin practice for the given exercise. */
  start: (exerciseKey: DetectionMode) => void;
  /** End practice. */
  end: () => void;
  /** Clear the store. */
  reset: () => void;
  /** Change exercise mid-practice. */
  setActiveExercise: (exerciseKey: DetectionMode) => void;
  /** Convenience — increment rep count by one. */
  handleRep: () => void;
  /** Direct rep count setter (for controller-driven updates). */
  setRepCount: (repCount: number) => void;
  /** Direct FQI setter. */
  setCurrentFqi: (fqi: number | null) => void;
}

/**
 * Hook wrapper around the practice-session store.
 *
 * Optional `autoResetOnUnmount` cleans up when the caller screen leaves —
 * useful for the practice modal where abandoning the modal should discard
 * the session silently (matches the "nothing to save" UX pledge).
 */
export function usePracticeSessionHook(
  options: { autoResetOnUnmount?: boolean } = {}
): UsePracticeSessionValue {
  const autoResetOnUnmount = options.autoResetOnUnmount ?? false;

  const phase = usePracticeSession((s) => s.phase);
  const activeExerciseKey = usePracticeSession((s) => s.activeExerciseKey);
  const repCount = usePracticeSession((s) => s.repCount);
  const currentFqi = usePracticeSession((s) => s.currentFqi);
  const startedAtMs = usePracticeSession((s) => s.startedAtMs);
  const endedAtMs = usePracticeSession((s) => s.endedAtMs);
  const startAction = usePracticeSession((s) => s.start);
  const endAction = usePracticeSession((s) => s.end);
  const resetAction = usePracticeSession((s) => s.reset);
  const setActiveExerciseAction = usePracticeSession((s) => s.setActiveExercise);
  const setRepCountAction = usePracticeSession((s) => s.setRepCount);
  const setCurrentFqiAction = usePracticeSession((s) => s.setCurrentFqi);

  // Compute derived values using the shared selectors to keep the logic in
  // one place (mirrors `practice-session-store.ts` exports).
  const snapshot: PracticeSessionState = {
    phase,
    activeExerciseKey,
    repCount,
    currentFqi,
    startedAtMs,
    endedAtMs,
    start: startAction,
    end: endAction,
    reset: resetAction,
    setActiveExercise: setActiveExerciseAction,
    setRepCount: setRepCountAction,
    setCurrentFqi: setCurrentFqiAction,
  };

  const isRunning = practiceSelectors.isRunning(snapshot);
  const hasEnded = practiceSelectors.hasEnded(snapshot);
  const durationMs = practiceSelectors.durationMs(snapshot);

  // IMPORTANT: None of these callbacks route to persistence services.
  // This is the invariant that unit tests at
  // tests/unit/hooks/use-practice-session.test.ts enforce.

  const start = useCallback<UsePracticeSessionValue['start']>(
    (exerciseKey) => {
      startAction(exerciseKey);
    },
    [startAction]
  );

  const end = useCallback<UsePracticeSessionValue['end']>(() => {
    endAction();
  }, [endAction]);

  const reset = useCallback<UsePracticeSessionValue['reset']>(() => {
    resetAction();
  }, [resetAction]);

  const setActiveExercise = useCallback<UsePracticeSessionValue['setActiveExercise']>(
    (exerciseKey) => {
      setActiveExerciseAction(exerciseKey);
    },
    [setActiveExerciseAction]
  );

  const handleRep = useCallback<UsePracticeSessionValue['handleRep']>(() => {
    const current = usePracticeSession.getState().repCount;
    setRepCountAction(current + 1);
  }, [setRepCountAction]);

  const setRepCount = useCallback<UsePracticeSessionValue['setRepCount']>(
    (nextCount) => {
      setRepCountAction(nextCount);
    },
    [setRepCountAction]
  );

  const setCurrentFqi = useCallback<UsePracticeSessionValue['setCurrentFqi']>(
    (fqi) => {
      setCurrentFqiAction(fqi);
    },
    [setCurrentFqiAction]
  );

  useEffect(() => {
    if (!autoResetOnUnmount) return;
    return () => {
      resetAction();
    };
  }, [autoResetOnUnmount, resetAction]);

  return {
    phase,
    activeExerciseKey,
    repCount,
    currentFqi,
    isRunning,
    hasEnded,
    durationMs,
    start,
    end,
    reset,
    setActiveExercise,
    handleRep,
    setRepCount,
    setCurrentFqi,
  };
}

export { usePracticeSession } from '@/lib/stores/practice-session-store';
