/**
 * Practice Session Store (Zustand)
 *
 * A dry-run, in-memory session state used for the "practice mode" surface
 * introduced by issue #479. It intentionally mirrors a thin slice of the
 * `session-runner` shape (phase / activeExerciseKey / repCount / currentFqi)
 * but has ZERO persistence wiring:
 *
 *   - No SQLite writes
 *   - No sync-queue entries
 *   - No Supabase mutations
 *   - No HealthKit or workouts context updates
 *   - No watch-bridge emit
 *
 * This lets new users experiment with camera framing, calibration, and
 * movement speed without polluting their workout history or HealthKit data.
 *
 * The store is deliberately tiny — it's a view model for the practice modal,
 * not an offline-first session manager.
 */

import { create } from 'zustand';
import type { DetectionMode } from '@/lib/workouts';

// =============================================================================
// Types
// =============================================================================

/** Phase buckets used by the practice badge + modal header. */
export type PracticePhase = 'idle' | 'running' | 'ended';

export interface PracticeSessionState {
  /** Current practice phase. */
  phase: PracticePhase;
  /** Currently selected exercise (detection mode id), or null before first pick. */
  activeExerciseKey: DetectionMode | null;
  /** Live rep count reported by the workout controller pipeline. */
  repCount: number;
  /** Most recent Form Quality Index (0-100) or null if unscored. */
  currentFqi: number | null;
  /** Timestamp (ms) when practice started, or null. */
  startedAtMs: number | null;
  /** Timestamp (ms) when practice ended, or null. */
  endedAtMs: number | null;

  // Actions
  start: (exerciseKey: DetectionMode) => void;
  end: () => void;
  reset: () => void;
  setActiveExercise: (exerciseKey: DetectionMode) => void;
  setRepCount: (repCount: number) => void;
  setCurrentFqi: (fqi: number | null) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function nowMs(): number {
  if (typeof globalThis.performance?.now === 'function') {
    return globalThis.performance.now();
  }
  return Date.now();
}

// =============================================================================
// Store
// =============================================================================

export const usePracticeSession = create<PracticeSessionState>((set, get) => ({
  phase: 'idle',
  activeExerciseKey: null,
  repCount: 0,
  currentFqi: null,
  startedAtMs: null,
  endedAtMs: null,

  /**
   * Begin a practice session for the given exercise. Safe to call when a
   * previous practice session was already ended — this clears counters.
   */
  start: (exerciseKey) => {
    set({
      phase: 'running',
      activeExerciseKey: exerciseKey,
      repCount: 0,
      currentFqi: null,
      startedAtMs: nowMs(),
      endedAtMs: null,
    });
  },

  /**
   * End the practice session. Counters are preserved for display until
   * `reset()` is called or a new `start()` is issued.
   */
  end: () => {
    const { phase } = get();
    if (phase !== 'running') return;
    set({
      phase: 'ended',
      endedAtMs: nowMs(),
    });
  },

  /**
   * Clear the store back to `idle` regardless of current phase.
   */
  reset: () => {
    set({
      phase: 'idle',
      activeExerciseKey: null,
      repCount: 0,
      currentFqi: null,
      startedAtMs: null,
      endedAtMs: null,
    });
  },

  /**
   * Change exercise without ending the session. Resets rep + FQI counters.
   */
  setActiveExercise: (exerciseKey) => {
    set({
      activeExerciseKey: exerciseKey,
      repCount: 0,
      currentFqi: null,
    });
  },

  setRepCount: (repCount) => {
    set({ repCount });
  },

  setCurrentFqi: (fqi) => {
    set({ currentFqi: fqi });
  },
}));

// =============================================================================
// Selectors (stable references so consumers can useShallow if needed)
// =============================================================================

export const practiceSelectors = {
  isRunning: (state: PracticeSessionState): boolean => state.phase === 'running',
  hasEnded: (state: PracticeSessionState): boolean => state.phase === 'ended',
  durationMs: (state: PracticeSessionState): number | null => {
    if (state.startedAtMs === null) return null;
    const end = state.endedAtMs ?? nowMs();
    return Math.max(0, end - state.startedAtMs);
  },
};
