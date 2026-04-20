/**
 * Workout Session Runner Store (Zustand)
 *
 * Manages the state machine for an active workout session:
 * - Start session (from template or ad-hoc)
 * - Add/remove exercises and sets
 * - Complete sets (triggers rest timer)
 * - Skip/extend rest
 * - Finish session
 *
 * All mutations persist to SQLite immediately (offline-first).
 */

import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { localDB } from '@/lib/services/database/local-db';
import {
  genericLocalUpsert,
  genericGetAll,
  genericSoftDelete,
} from '@/lib/services/database/generic-sync';
import {
  computeRestSeconds,
  scheduleRestNotification,
  cancelRestNotification,
  computeRemainingSeconds,
} from '@/lib/services/rest-timer';
import { estimateTut, timedSetTut } from '@/lib/services/tut-estimator';
import {
  getDefaultsForExercise,
  type FormTargets,
} from '@/lib/services/form-target-resolver';
import type {
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionSet,
  WorkoutSessionEvent,
  WorkoutTemplate,
  WorkoutTemplateExercise,
  GoalProfile,
  SetType,
  Exercise,
  SessionEventType,
} from '@/lib/types/workout-session';
import { logWithTs, errorWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export type PauseReason = 'user' | 'system';

export interface SessionRunnerState {
  // Session data
  activeSession: WorkoutSession | null;
  exercises: (WorkoutSessionExercise & { exercise?: Exercise })[];
  sets: Record<string, WorkoutSessionSet[]>; // keyed by session_exercise_id

  // Form-target slice (issue #447) — keyed by `exercise_id` (not session-exercise-id)
  // so consumers can resolve targets by the active scan exercise. Populated from
  // template overrides on startSession when a templateId is supplied; empty
  // for ad-hoc sessions. Callers should fall back to `getDefaultsForExercise`.
  formTargetsByExercise: Record<string, FormTargets>;

  // Timer state
  restTimer: {
    targetSeconds: number;
    startedAt: string;
    setId: string;
  } | null;
  restTimerCompletionTimeout: ReturnType<typeof setTimeout> | null;

  // Pause state — additive, never nullifies existing behavior
  isPaused: boolean;
  pausedAt: number | null;
  totalPausedMs: number;
  /**
   * Remembered rest-timer snapshot so we can resume with the exact remaining
   * seconds the user had when they paused (instead of the original duration).
   */
  pausedRestTimer: {
    targetSeconds: number;
    remainingSeconds: number;
    setId: string;
  } | null;

  // Status
  isLoading: boolean;
  isWorkoutInProgress: boolean;
  error: string | null;

  // Actions
  startSession: (opts?: {
    templateId?: string;
    name?: string;
    goalProfile?: GoalProfile;
    bodyweightLb?: number;
  }) => Promise<void>;
  addExercise: (exerciseId: string) => Promise<string>;
  removeExercise: (sessionExerciseId: string) => Promise<void>;
  swapExerciseByDetectionMode: (
    mode: string,
    action?: 'append' | 'replace',
  ) => Promise<string | null>;
  addSet: (sessionExerciseId: string, setType?: SetType) => Promise<string>;
  removeSet: (setId: string) => Promise<void>;
  updateSet: (setId: string, fields: Partial<WorkoutSessionSet>) => Promise<void>;
  completeSet: (setId: string) => Promise<void>;
  skipRest: () => Promise<void>;
  extendRest: (seconds: number) => void;
  pauseSession: (reason?: PauseReason) => void;
  resumeSession: () => void;
  finishSession: () => Promise<void>;
  loadActiveSession: () => Promise<void>;
  duplicateSet: (setId: string, count?: number) => Promise<void>;
  updateSetType: (setId: string, setType: SetType) => Promise<void>;
  duplicateExercise: (sessionExerciseId: string) => Promise<void>;
  /**
   * Resolve the active form targets for a given exerciseId.
   * Prefers template overrides threaded on startSession, falls back to
   * per-exercise defaults (`form-target-resolver.getDefaultsForExercise`).
   * Safe to call at any time — returns conservative defaults when no session.
   */
  getFormTargetsFor: (exerciseId: string) => FormTargets;
}

// =============================================================================
// Helpers
// =============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

async function findExerciseIdForMode(mode: string): Promise<string | null> {
  const db = localDB.db;
  if (!db) return null;
  const likeToken = `${mode.toLowerCase().replace(/[^a-z0-9]/g, '')}%`;
  try {
    const byId = await db.getAllAsync<{ id: string }>(
      'SELECT id FROM exercises WHERE LOWER(REPLACE(REPLACE(id, \'-\', \'\'), \'_\', \'\')) LIKE ? LIMIT 1',
      [likeToken],
    );
    if (byId[0]?.id) return byId[0].id;
    const byName = await db.getAllAsync<{ id: string }>(
      'SELECT id FROM exercises WHERE LOWER(REPLACE(REPLACE(name, \' \', \'\'), \'-\', \'\')) LIKE ? ORDER BY is_system DESC LIMIT 1',
      [likeToken],
    );
    return byName[0]?.id ?? null;
  } catch {
    return null;
  }
}

let restTimerHapticTimeout: ReturnType<typeof setTimeout> | null = null;

function clearRestTimerHapticTimeout(): void {
  if (restTimerHapticTimeout) {
    clearTimeout(restTimerHapticTimeout);
    restTimerHapticTimeout = null;
  }
}

function scheduleRestTimerCompletionHaptic(startedAt: string, targetSeconds: number): void {
  clearRestTimerHapticTimeout();

  const remainingMs = computeRemainingSeconds(startedAt, targetSeconds) * 1000;
  if (remainingMs <= 0) {
    return;
  }

  restTimerHapticTimeout = setTimeout(() => {
    restTimerHapticTimeout = null;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, remainingMs);
}

// =============================================================================
// Event Listener Registry (module-level, non-breaking fan-out)
// =============================================================================

export type SessionEventListener = (event: WorkoutSessionEvent) => void;

const sessionEventListeners = new Set<SessionEventListener>();

/**
 * Subscribe to session events as they are emitted (set_completed, rest_started,
 * rest_ended, session_completed, pr_detected, etc.). Returns an unsubscribe fn.
 *
 * This is a pure fan-out: listeners are invoked synchronously after the event
 * has been persisted to SQLite. Listener exceptions are caught so a buggy
 * subscriber cannot break session state. Safe to call multiple times; each
 * subscription is tracked independently.
 */
export function subscribeToEvents(listener: SessionEventListener): () => void {
  sessionEventListeners.add(listener);
  return () => {
    sessionEventListeners.delete(listener);
  };
}

/**
 * Test-only helper: clear all subscribers. Kept non-public-exported but usable
 * via the debug entry below when needed by unit tests.
 */
export function __resetSessionEventListenersForTests(): void {
  sessionEventListeners.clear();
}

function notifySessionEventListeners(event: WorkoutSessionEvent): void {
  if (sessionEventListeners.size === 0) return;
  for (const listener of sessionEventListeners) {
    try {
      listener(event);
    } catch (err) {
      errorWithTs('[SessionRunner] Listener threw:', err);
    }
  }
}

async function emitEvent(
  sessionId: string,
  type: SessionEventType,
  sessionExerciseId?: string | null,
  sessionSetId?: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const event: Record<string, unknown> = {
    id: Crypto.randomUUID(),
    session_id: sessionId,
    created_at: nowIso(),
    type,
    session_exercise_id: sessionExerciseId ?? null,
    session_set_id: sessionSetId ?? null,
    payload: JSON.stringify(payload),
    synced: 0,
  };
  await genericLocalUpsert('workout_session_events', 'id', event, 0);

  // Fan out to in-process listeners (watch bridge, analytics, etc.).
  // The stored payload is serialized JSON; subscribers receive the rich object.
  notifySessionEventListeners({
    id: event.id as string,
    session_id: sessionId,
    created_at: event.created_at as string,
    type,
    session_exercise_id: sessionExerciseId ?? null,
    session_set_id: sessionSetId ?? null,
    payload,
  });
}

async function getExerciseById(exerciseId: string): Promise<Exercise | null> {
  const db = localDB.db;
  if (!db) return null;
  const rows = await db.getAllAsync<Exercise>(
    'SELECT * FROM exercises WHERE id = ?',
    [exerciseId],
  );
  return rows[0] ?? null;
}

// =============================================================================
// Store
// =============================================================================

export const useSessionRunner = create<SessionRunnerState>((set, get) => {
  const clearRestTimerCompletionTimeout = () => {
    const timeout = get().restTimerCompletionTimeout;
    if (!timeout) return;

    clearTimeout(timeout);
    set({ restTimerCompletionTimeout: null });
  };

  const scheduleRestTimerCompletion = (restTimer: NonNullable<SessionRunnerState['restTimer']>) => {
    clearRestTimerCompletionTimeout();

    const remainingMilliseconds = Math.max(
      0,
      computeRemainingSeconds(restTimer.startedAt, restTimer.targetSeconds) * 1000,
    );

    const timeout = setTimeout(() => {
      const currentRestTimer = get().restTimer;
      if (!currentRestTimer || currentRestTimer.setId !== restTimer.setId) {
        return;
      }

      set({ restTimer: null, restTimerCompletionTimeout: null });
    }, remainingMilliseconds);

    set({ restTimerCompletionTimeout: timeout });
  };

  return {
  activeSession: null,
  exercises: [],
  sets: {},
  formTargetsByExercise: {},
  restTimer: null,
  restTimerCompletionTimeout: null,
  isPaused: false,
  pausedAt: null,
  totalPausedMs: 0,
  pausedRestTimer: null,
  isLoading: false,
  isWorkoutInProgress: false,
  error: null,

  // =========================================================================
  // Form Targets
  // =========================================================================
  getFormTargetsFor: (exerciseId: string): FormTargets => {
    const map = get().formTargetsByExercise;
    const override = map[exerciseId];
    if (override) return override;
    return getDefaultsForExercise(exerciseId);
  },

  // =========================================================================
  // Start Session
  // =========================================================================
  startSession: async (opts) => {
    set({ isLoading: true, error: null });
    try {
      const now = nowIso();
      const sessionId = Crypto.randomUUID();

      const session: Record<string, unknown> = {
        id: sessionId,
        template_id: opts?.templateId ?? null,
        name: opts?.name ?? null,
        goal_profile: opts?.goalProfile ?? 'hypertrophy',
        started_at: now,
        ended_at: null,
        timezone_offset_minutes: new Date().getTimezoneOffset(),
        bodyweight_lb: opts?.bodyweightLb ?? null,
        notes: null,
        synced: 0,
        deleted: 0,
        updated_at: now,
        created_at: now,
      };

      await genericLocalUpsert('workout_sessions', 'id', session, 0);
      await emitEvent(sessionId, 'session_started');

      // If created from template, materialize exercises + sets and collect
      // any per-exercise form-target overrides (issue #447).
      let formTargetsByExercise: Record<string, FormTargets> = {};
      if (opts?.templateId) {
        formTargetsByExercise = await materializeTemplate(sessionId, opts.templateId);
      }

      // Reload state
      const sessionObj = session as unknown as WorkoutSession;
      const exercises = await loadSessionExercises(sessionId);
      const sets = await loadSessionSets(exercises);

      set({
        activeSession: sessionObj,
        exercises,
        sets,
        formTargetsByExercise,
        restTimer: null,
        restTimerCompletionTimeout: null,
        isPaused: false,
        pausedAt: null,
        totalPausedMs: 0,
        pausedRestTimer: null,
        isWorkoutInProgress: true,
      });
      clearRestTimerCompletionTimeout();

      logWithTs(`[SessionRunner] Started session ${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start session';
      set({ error: message });
      errorWithTs('[SessionRunner] Failed to start session:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  // =========================================================================
  // Add Exercise
  // =========================================================================
  addExercise: async (exerciseId) => {
    const { activeSession, exercises } = get();
    if (!activeSession) throw new Error('No active session');

    const id = Crypto.randomUUID();
    const now = nowIso();
    const sortOrder = exercises.length;

    const row: Record<string, unknown> = {
      id,
      session_id: activeSession.id,
      exercise_id: exerciseId,
      sort_order: sortOrder,
      notes: null,
      synced: 0,
      deleted: 0,
      updated_at: now,
      created_at: now,
    };

    await genericLocalUpsert('workout_session_exercises', 'id', row, 0);
    await emitEvent(activeSession.id, 'exercise_started', id);

    const exercise = await getExerciseById(exerciseId);
    const newExercise = { ...row, exercise: exercise ?? undefined } as WorkoutSessionExercise & { exercise?: Exercise };

    set((state) => ({
      exercises: [...state.exercises, newExercise],
      sets: { ...state.sets, [id]: [] },
    }));

    // Auto-add first set
    await get().addSet(id);

    return id;
  },

  // =========================================================================
  // Remove Exercise
  // =========================================================================
  removeExercise: async (sessionExerciseId) => {
    const { activeSession } = get();
    if (!activeSession) return;

    await genericSoftDelete('workout_session_exercises', 'id', sessionExerciseId);

    // Also soft-delete all sets for this exercise
    const exerciseSets = get().sets[sessionExerciseId] ?? [];
    for (const s of exerciseSets) {
      await genericSoftDelete('workout_session_sets', 'id', s.id);
    }

    set((state) => {
      const newSets = { ...state.sets };
      delete newSets[sessionExerciseId];
      return {
        exercises: state.exercises.filter((e) => e.id !== sessionExerciseId),
        sets: newSets,
      };
    });
  },

  // =========================================================================
  // Swap Exercise By Detection Mode (#434)
  // =========================================================================
  swapExerciseByDetectionMode: async (mode, action = 'append') => {
    const { activeSession, exercises } = get();
    if (!activeSession) return null;
    if (!mode) return null;
    const matchId = await findExerciseIdForMode(mode);
    if (!matchId) return null;
    if (action === 'replace' && exercises.length > 0) {
      const last = exercises[exercises.length - 1];
      await get().removeExercise(last.id);
    }
    const newId = await get().addExercise(matchId);
    return newId;
  },

  // =========================================================================
  // Add Set
  // =========================================================================
  addSet: async (sessionExerciseId, setType = 'normal') => {
    const { activeSession, sets } = get();
    if (!activeSession) throw new Error('No active session');

    const id = Crypto.randomUUID();
    const now = nowIso();
    const existingSets = sets[sessionExerciseId] ?? [];
    const sortOrder = existingSets.length;

    // Copy weight/reps from previous set if available
    const prevSet = existingSets[existingSets.length - 1];

    const row: Record<string, unknown> = {
      id,
      session_exercise_id: sessionExerciseId,
      sort_order: sortOrder,
      set_type: setType,
      planned_reps: prevSet?.planned_reps ?? null,
      planned_seconds: prevSet?.planned_seconds ?? null,
      planned_weight: prevSet?.planned_weight ?? null,
      actual_reps: null,
      actual_seconds: null,
      actual_weight: prevSet?.actual_weight ?? prevSet?.planned_weight ?? null,
      started_at: null,
      completed_at: null,
      rest_target_seconds: null,
      rest_started_at: null,
      rest_completed_at: null,
      rest_skipped: 0,
      tut_ms: null,
      tut_source: 'unknown',
      perceived_rpe: null,
      notes: null,
      synced: 0,
      deleted: 0,
      updated_at: now,
      created_at: now,
    };

    await genericLocalUpsert('workout_session_sets', 'id', row, 0);

    const newSet = row as unknown as WorkoutSessionSet;

    set((state) => ({
      sets: {
        ...state.sets,
        [sessionExerciseId]: [...(state.sets[sessionExerciseId] ?? []), newSet],
      },
    }));

    return id;
  },

  // =========================================================================
  // Remove Set
  // =========================================================================
  removeSet: async (setId) => {
    await genericSoftDelete('workout_session_sets', 'id', setId);

    set((state) => {
      const newSets = { ...state.sets };
      for (const key of Object.keys(newSets)) {
        newSets[key] = newSets[key].filter((s) => s.id !== setId);
      }
      return { sets: newSets };
    });
  },

  // =========================================================================
  // Update Set
  // =========================================================================
  updateSet: async (setId, fields) => {
    const db = localDB.db;
    if (!db) return;

    const entries = Object.entries(fields).filter(([k]) => k !== 'id');
    if (entries.length === 0) return;

    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => (v === undefined ? null : v));
    values.push(setId);

    await db.runAsync(
      `UPDATE workout_session_sets SET ${setClauses}, synced = 0, updated_at = ? WHERE id = ?`,
      [...values.slice(0, -1), nowIso(), setId],
    );

    set((state) => {
      const newSets = { ...state.sets };
      for (const key of Object.keys(newSets)) {
        newSets[key] = newSets[key].map((s) =>
          s.id === setId ? { ...s, ...fields } : s,
        );
      }
      return { sets: newSets };
    });
  },

  // =========================================================================
  // Complete Set -> Triggers Rest Timer
  // =========================================================================
  completeSet: async (setId) => {
    const { activeSession, exercises, sets } = get();
    if (!activeSession) return;

    const now = nowIso();

    // Find the set and its parent exercise
    let parentExerciseId: string | null = null;
    let theSet: WorkoutSessionSet | null = null;
    let parentExercise: (WorkoutSessionExercise & { exercise?: Exercise }) | null = null;

    for (const [exId, exSets] of Object.entries(sets)) {
      const found = exSets.find((s) => s.id === setId);
      if (found) {
        theSet = found;
        parentExerciseId = exId;
        parentExercise = exercises.find((e) => e.id === exId) ?? null;
        break;
      }
    }

    if (!theSet || !parentExerciseId) return;

    // Compute TUT
    const exercise = parentExercise?.exercise;
    let tutResult = { tut_ms: null as number | null, tut_source: 'unknown' as const };
    if (exercise?.is_timed && theSet.actual_seconds) {
      const t = timedSetTut(theSet.actual_seconds);
      tutResult = { tut_ms: t.tut_ms, tut_source: t.tut_source as 'unknown' };
    } else if (theSet.actual_reps) {
      const t = estimateTut(theSet.actual_reps);
      tutResult = { tut_ms: t.tut_ms, tut_source: t.tut_source as 'unknown' };
    }

    // Compute rest target
    const restSeconds = computeRestSeconds({
      goalProfile: activeSession.goal_profile,
      isCompound: exercise?.is_compound ?? false,
      setType: theSet.set_type,
      perceivedRpe: theSet.perceived_rpe,
      overrideSeconds: theSet.rest_target_seconds,
    });

    // Update set in DB
    const db = localDB.db;
    if (!db) return;

    await db.runAsync(
      `UPDATE workout_session_sets SET
        completed_at = ?, rest_target_seconds = ?, rest_started_at = ?,
        tut_ms = ?, tut_source = ?, synced = 0, updated_at = ?
       WHERE id = ?`,
      [now, restSeconds, now, tutResult.tut_ms, tutResult.tut_source, now, setId],
    );

    await emitEvent(activeSession.id, 'set_completed', parentExerciseId, setId, {
      actual_reps: theSet.actual_reps,
      actual_weight: theSet.actual_weight,
    });
    await emitEvent(activeSession.id, 'rest_started', parentExerciseId, setId, {
      rest_target_seconds: restSeconds,
    });

    // Schedule notification
    const nextSetIdx = (sets[parentExerciseId] ?? []).findIndex((s) => s.id === setId) + 1;
    await scheduleRestNotification(
      restSeconds,
      exercise?.name,
      nextSetIdx + 1,
    );
    scheduleRestTimerCompletionHaptic(now, restSeconds);

    // Update in-memory state
    set((state) => {
      const newSets = { ...state.sets };
      for (const key of Object.keys(newSets)) {
        newSets[key] = newSets[key].map((s) =>
          s.id === setId
            ? {
                ...s,
                completed_at: now,
                rest_target_seconds: restSeconds,
                rest_started_at: now,
                tut_ms: tutResult.tut_ms,
                tut_source: tutResult.tut_source,
              }
            : s,
        );
      }
      return {
        sets: newSets,
        restTimer: {
          targetSeconds: restSeconds,
          startedAt: now,
          setId,
        },
      };
    });
    scheduleRestTimerCompletion({
      targetSeconds: restSeconds,
      startedAt: now,
      setId,
    });

    logWithTs(`[SessionRunner] Completed set ${setId}, rest: ${restSeconds}s`);
  },

  // =========================================================================
  // Skip Rest
  // =========================================================================
  skipRest: async () => {
    const { activeSession, restTimer } = get();
    if (!activeSession || !restTimer) return;

    const now = nowIso();

    clearRestTimerCompletionTimeout();
    clearRestTimerHapticTimeout();
    await cancelRestNotification();

    const db = localDB.db;
    if (!db) return;

    await db.runAsync(
      `UPDATE workout_session_sets SET
        rest_completed_at = ?, rest_skipped = 1, synced = 0, updated_at = ?
       WHERE id = ?`,
      [now, now, restTimer.setId],
    );

    await emitEvent(activeSession.id, 'rest_skipped', null, restTimer.setId);

    set((state) => {
      const newSets = { ...state.sets };
      for (const key of Object.keys(newSets)) {
        newSets[key] = newSets[key].map((s) =>
          s.id === restTimer.setId
            ? { ...s, rest_completed_at: now, rest_skipped: true }
            : s,
        );
      }
      return { sets: newSets, restTimer: null };
    });

    logWithTs('[SessionRunner] Rest skipped');
  },

  // =========================================================================
  // Extend Rest
  // =========================================================================
  extendRest: (seconds) => {
    const { restTimer } = get();
    if (!restTimer) return;

    const newTarget = restTimer.targetSeconds + seconds;
    const nextRestTimer = { ...restTimer, targetSeconds: newTarget };

    // Reschedule notification
    const remaining = computeRemainingSeconds(nextRestTimer.startedAt, nextRestTimer.targetSeconds);
    if (remaining > 0) {
      scheduleRestNotification(remaining).catch(() => {});
    }
    scheduleRestTimerCompletionHaptic(restTimer.startedAt, newTarget);

    // Update DB
    const db = localDB.db;
    if (db) {
      db.runAsync(
        'UPDATE workout_session_sets SET rest_target_seconds = ?, synced = 0, updated_at = ? WHERE id = ?',
        [newTarget, nowIso(), restTimer.setId],
      ).catch(() => {});
    }

    set({
      restTimer: nextRestTimer,
    });
    scheduleRestTimerCompletion(nextRestTimer);
  },

  // =========================================================================
  // Pause Session
  // =========================================================================
  pauseSession: (reason = 'user') => {
    const { activeSession, isPaused, restTimer } = get();
    if (!activeSession || isPaused) return;

    // Snapshot the rest timer so we can restore it with the same amount of
    // remaining time when the user resumes. The raw `restTimer.startedAt`
    // can't stay valid across the pause gap because it's a wall-clock stamp.
    let pausedRestTimer: SessionRunnerState['pausedRestTimer'] = null;
    if (restTimer) {
      const remaining = Math.max(
        0,
        computeRemainingSeconds(restTimer.startedAt, restTimer.targetSeconds),
      );
      pausedRestTimer = {
        targetSeconds: restTimer.targetSeconds,
        remainingSeconds: remaining,
        setId: restTimer.setId,
      };
    }

    clearRestTimerCompletionTimeout();
    // Fire-and-forget: we don't want to block UI on notification scheduling.
    void cancelRestNotification();

    set({
      isPaused: true,
      pausedAt: Date.now(),
      pausedRestTimer,
      restTimer: null,
    });

    logWithTs(`[SessionRunner] Paused session ${activeSession.id} (reason=${reason})`);
  },

  // =========================================================================
  // Resume Session
  // =========================================================================
  resumeSession: () => {
    const {
      activeSession,
      isPaused,
      pausedAt,
      totalPausedMs,
      pausedRestTimer,
    } = get();
    if (!activeSession || !isPaused || pausedAt == null) return;

    const pausedMsForThisSegment = Math.max(0, Date.now() - pausedAt);
    const nextTotalPausedMs = totalPausedMs + pausedMsForThisSegment;

    // Reconstruct the rest timer from the remaining-seconds snapshot so the
    // visible countdown continues from exactly where the user left it.
    let nextRestTimer: SessionRunnerState['restTimer'] = null;
    if (pausedRestTimer && pausedRestTimer.remainingSeconds > 0) {
      const resumedAt = new Date().toISOString();
      nextRestTimer = {
        targetSeconds: pausedRestTimer.remainingSeconds,
        startedAt: resumedAt,
        setId: pausedRestTimer.setId,
      };
    }

    set({
      isPaused: false,
      pausedAt: null,
      totalPausedMs: nextTotalPausedMs,
      pausedRestTimer: null,
      restTimer: nextRestTimer,
    });

    if (nextRestTimer) {
      // Reschedule the background notification + completion haptic for the
      // recomputed remaining window.
      scheduleRestNotification(nextRestTimer.targetSeconds).catch(() => {});
      scheduleRestTimerCompletionHaptic(nextRestTimer.startedAt, nextRestTimer.targetSeconds);
      scheduleRestTimerCompletion(nextRestTimer);
    }

    logWithTs(
      `[SessionRunner] Resumed session ${activeSession.id} (+${pausedMsForThisSegment}ms paused)`,
    );
  },

  // =========================================================================
  // Finish Session
  // =========================================================================
  finishSession: async () => {
    const { activeSession, isPaused, pausedAt, totalPausedMs } = get();
    if (!activeSession) return;

    const now = nowIso();

    // If we finish while paused, flush the in-flight pause segment into the
    // accumulator so elapsed-time consumers can subtract a complete total.
    const finalPausedMs = isPaused && pausedAt != null
      ? totalPausedMs + Math.max(0, Date.now() - pausedAt)
      : totalPausedMs;

    clearRestTimerCompletionTimeout();
    await cancelRestNotification();

    const db = localDB.db;
    if (!db) return;

    await db.runAsync(
      'UPDATE workout_sessions SET ended_at = ?, synced = 0, updated_at = ? WHERE id = ?',
      [now, now, activeSession.id],
    );

    await emitEvent(activeSession.id, 'session_completed', null, null, {
      paused_ms: finalPausedMs,
    });

    set({
      activeSession: null,
      exercises: [],
      sets: {},
      formTargetsByExercise: {},
      restTimer: null,
      restTimerCompletionTimeout: null,
      isPaused: false,
      pausedAt: null,
      totalPausedMs: 0,
      pausedRestTimer: null,
      isWorkoutInProgress: false,
    });

    logWithTs(
      `[SessionRunner] Finished session ${activeSession.id} (paused_ms=${finalPausedMs})`,
    );
  },

  // =========================================================================
  // Load Active Session (on app resume)
  // =========================================================================
  loadActiveSession: async () => {
    set({ isLoading: true, error: null });
    try {
      const db = localDB.db;
      if (!db) return;

      // Find any session without ended_at
      const rows = await db.getAllAsync<WorkoutSession>(
        'SELECT * FROM workout_sessions WHERE ended_at IS NULL AND deleted = 0 ORDER BY started_at DESC LIMIT 1',
      );

      if (rows.length === 0) {
        clearRestTimerCompletionTimeout();
        set({
          activeSession: null,
          exercises: [],
          sets: {},
          formTargetsByExercise: {},
          restTimer: null,
          restTimerCompletionTimeout: null,
          isPaused: false,
          pausedAt: null,
          totalPausedMs: 0,
          pausedRestTimer: null,
          isWorkoutInProgress: false,
        });
        return;
      }

      const session = rows[0];
      const exercises = await loadSessionExercises(session.id);
      const sets = await loadSessionSets(exercises);
      // Rehydrate form-target overrides from the originating template so
      // scan-arkit still sees per-exercise targets after an app resume.
      const formTargetsByExercise = session.template_id
        ? await loadFormTargetsForTemplate(session.template_id)
        : {};

      // Check if there's an active rest timer
      let restTimer: SessionRunnerState['restTimer'] = null;
      for (const [, exSets] of Object.entries(sets)) {
        for (const s of exSets) {
          if (s.rest_started_at && !s.rest_completed_at && !s.rest_skipped && s.rest_target_seconds) {
            const remaining = computeRemainingSeconds(s.rest_started_at, s.rest_target_seconds);
            if (remaining > 0) {
              restTimer = {
                targetSeconds: s.rest_target_seconds,
                startedAt: s.rest_started_at,
                setId: s.id,
              };
              scheduleRestTimerCompletionHaptic(s.rest_started_at, s.rest_target_seconds);
            }
          }
        }
      }

      set({
        activeSession: session,
        exercises,
        sets,
        formTargetsByExercise,
        restTimer,
        isPaused: false,
        pausedAt: null,
        totalPausedMs: 0,
        pausedRestTimer: null,
        isWorkoutInProgress: true,
      });
      if (restTimer) {
        scheduleRestTimerCompletion(restTimer);
      } else {
        clearRestTimerCompletionTimeout();
      }

      logWithTs(`[SessionRunner] Loaded active session ${session.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load session';
      set({ error: message });
      errorWithTs('[SessionRunner] Failed to load active session:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  // =========================================================================
  // Duplicate Set
  // =========================================================================
  duplicateSet: async (setId, count = 1) => {
    const { sets } = get();
    let sourceSet: WorkoutSessionSet | null = null;
    let parentExId: string | null = null;

    for (const [exId, exSets] of Object.entries(sets)) {
      const found = exSets.find((s) => s.id === setId);
      if (found) {
        sourceSet = found;
        parentExId = exId;
        break;
      }
    }

    if (!sourceSet || !parentExId) return;

    for (let i = 0; i < count; i++) {
      const id = Crypto.randomUUID();
      const now = nowIso();
      const existingSets = get().sets[parentExId] ?? [];

      const row: Record<string, unknown> = {
        id,
        session_exercise_id: parentExId,
        sort_order: existingSets.length,
        set_type: sourceSet.set_type,
        planned_reps: sourceSet.planned_reps,
        planned_seconds: sourceSet.planned_seconds,
        planned_weight: sourceSet.planned_weight,
        actual_reps: null,
        actual_seconds: null,
        actual_weight: sourceSet.actual_weight ?? sourceSet.planned_weight,
        started_at: null,
        completed_at: null,
        rest_target_seconds: null,
        rest_started_at: null,
        rest_completed_at: null,
        rest_skipped: 0,
        tut_ms: null,
        tut_source: 'unknown',
        perceived_rpe: null,
        notes: null,
        synced: 0,
        deleted: 0,
        updated_at: now,
        created_at: now,
      };

      await genericLocalUpsert('workout_session_sets', 'id', row, 0);

      set((state) => ({
        sets: {
          ...state.sets,
          [parentExId!]: [...(state.sets[parentExId!] ?? []), row as unknown as WorkoutSessionSet],
        },
      }));
    }
  },

  // =========================================================================
  // Update Set Type
  // =========================================================================
  updateSetType: async (setId, setType) => {
    await get().updateSet(setId, { set_type: setType });
  },

  // =========================================================================
  // Duplicate Exercise
  // =========================================================================
  duplicateExercise: async (sessionExerciseId) => {
    const { exercises, sets } = get();
    const source = exercises.find((e) => e.id === sessionExerciseId);
    if (!source) return;

    const newExId = await get().addExercise(source.exercise_id);

    // Duplicate sets (skip auto-added first set, add source sets)
    const sourceSets = sets[sessionExerciseId] ?? [];
    const newSets = get().sets[newExId] ?? [];

    // Remove the auto-added set if it exists
    if (newSets.length > 0) {
      await get().removeSet(newSets[0].id);
    }

    for (const s of sourceSets) {
      const id = Crypto.randomUUID();
      const now = nowIso();

      const row: Record<string, unknown> = {
        id,
        session_exercise_id: newExId,
        sort_order: (get().sets[newExId] ?? []).length,
        set_type: s.set_type,
        planned_reps: s.planned_reps,
        planned_seconds: s.planned_seconds,
        planned_weight: s.planned_weight,
        actual_reps: null,
        actual_seconds: null,
        actual_weight: s.actual_weight ?? s.planned_weight,
        started_at: null,
        completed_at: null,
        rest_target_seconds: null,
        rest_started_at: null,
        rest_completed_at: null,
        rest_skipped: 0,
        tut_ms: null,
        tut_source: 'unknown',
        perceived_rpe: null,
        notes: null,
        synced: 0,
        deleted: 0,
        updated_at: now,
        created_at: now,
      };

      await genericLocalUpsert('workout_session_sets', 'id', row, 0);

      set((state) => ({
        sets: {
          ...state.sets,
          [newExId]: [...(state.sets[newExId] ?? []), row as unknown as WorkoutSessionSet],
        },
      }));
    }
  },
  };
});

// =============================================================================
// Internal Helpers
// =============================================================================

async function loadSessionExercises(
  sessionId: string,
): Promise<(WorkoutSessionExercise & { exercise?: Exercise })[]> {
  const db = localDB.db;
  if (!db) return [];

  const rows = await db.getAllAsync<WorkoutSessionExercise>(
    'SELECT * FROM workout_session_exercises WHERE session_id = ? AND deleted = 0 ORDER BY sort_order ASC',
    [sessionId],
  );

  // Attach exercise metadata
  const result: (WorkoutSessionExercise & { exercise?: Exercise })[] = [];
  for (const row of rows) {
    const exercise = await getExerciseById(row.exercise_id);
    result.push({ ...row, exercise: exercise ?? undefined });
  }

  return result;
}

async function loadSessionSets(
  exercises: WorkoutSessionExercise[],
): Promise<Record<string, WorkoutSessionSet[]>> {
  const db = localDB.db;
  if (!db) return {};

  const sets: Record<string, WorkoutSessionSet[]> = {};
  for (const ex of exercises) {
    const rows = await db.getAllAsync<WorkoutSessionSet>(
      'SELECT * FROM workout_session_sets WHERE session_exercise_id = ? AND deleted = 0 ORDER BY sort_order ASC',
      [ex.id],
    );
    sets[ex.id] = rows;
  }

  return sets;
}

async function materializeTemplate(
  sessionId: string,
  templateId: string,
): Promise<Record<string, FormTargets>> {
  const db = localDB.db;
  if (!db) return {};

  const now = nowIso();
  // Collected form-target overrides keyed by exercise_id. Populated from any
  // template-exercise rows with `target_fqi_min`/`target_rom_min`/`target_rom_max`.
  const formTargetOverrides: Record<string, FormTargets> = {};

  // Get template exercises
  const templateExercises = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM workout_template_exercises WHERE template_id = ? AND deleted = 0 ORDER BY sort_order ASC',
    [templateId],
  );

  for (const tEx of templateExercises) {
    const seId = Crypto.randomUUID();

    // Create session exercise
    const seRow: Record<string, unknown> = {
      id: seId,
      session_id: sessionId,
      exercise_id: tEx.exercise_id,
      sort_order: tEx.sort_order,
      notes: tEx.notes,
      synced: 0,
      deleted: 0,
      updated_at: now,
      created_at: now,
    };
    await genericLocalUpsert('workout_session_exercises', 'id', seRow, 0);

    // Collect any form-target override for this exercise. The template table
    // may not yet physically host `target_fqi_min`/etc. columns (schema change
    // is deferred — see issue #447 "Deferred" section); we read defensively
    // and only record an override when at least one numeric value is present.
    const exerciseId = typeof tEx.exercise_id === 'string' ? tEx.exercise_id : null;
    if (exerciseId) {
      const override = extractFormTargetOverride(tEx);
      if (override) {
        formTargetOverrides[exerciseId] = override;
      }
    }

    // Get template sets for this exercise
    const templateSets = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM workout_template_sets WHERE template_exercise_id = ? AND deleted = 0 ORDER BY sort_order ASC',
      [String(tEx.id)],
    );

    for (const tSet of templateSets) {
      const ssId = Crypto.randomUUID();
      const ssRow: Record<string, unknown> = {
        id: ssId,
        session_exercise_id: seId,
        sort_order: tSet.sort_order,
        set_type: tSet.set_type ?? 'normal',
        // Map target_* -> planned_*
        planned_reps: tSet.target_reps,
        planned_seconds: tSet.target_seconds,
        planned_weight: tSet.target_weight,
        actual_reps: null,
        actual_seconds: null,
        actual_weight: tSet.target_weight, // Pre-fill actual_weight for convenience
        started_at: null,
        completed_at: null,
        rest_target_seconds: tSet.rest_seconds_override ?? null,
        rest_started_at: null,
        rest_completed_at: null,
        rest_skipped: 0,
        tut_ms: null,
        tut_source: 'unknown',
        perceived_rpe: null,
        notes: tSet.notes,
        synced: 0,
        deleted: 0,
        updated_at: now,
        created_at: now,
      };
      await genericLocalUpsert('workout_session_sets', 'id', ssRow, 0);
    }
  }

  return formTargetOverrides;
}

/**
 * Extract a `FormTargets` override from a raw template-exercise row, pulling
 * the merged defaults for the exercise and overlaying any present numeric
 * `target_*` columns. Returns `null` when no override fields are set so the
 * caller can skip recording the exerciseId.
 */
function extractFormTargetOverride(row: Record<string, unknown>): FormTargets | null {
  const fqi = asFiniteNumber(row.target_fqi_min);
  const romMin = asFiniteNumber(row.target_rom_min);
  const romMax = asFiniteNumber(row.target_rom_max);
  if (fqi === null && romMin === null && romMax === null) return null;

  const exerciseId = typeof row.exercise_id === 'string' ? row.exercise_id : '';
  const base = getDefaultsForExercise(exerciseId);
  return {
    fqiMin: fqi ?? base.fqiMin,
    romMin: romMin ?? base.romMin,
    romMax: romMax ?? base.romMax,
  };
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v !== 'number') return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

/**
 * Re-read the form-target overrides for all exercises of a template from the
 * local DB. Used on `loadActiveSession` to rehydrate the scan context after
 * an app resume. Returns an empty map on error or when the template rows
 * don't carry override columns yet.
 */
async function loadFormTargetsForTemplate(
  templateId: string,
): Promise<Record<string, FormTargets>> {
  const db = localDB.db;
  if (!db) return {};
  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM workout_template_exercises WHERE template_id = ? AND deleted = 0 ORDER BY sort_order ASC',
      [templateId],
    );
    const map: Record<string, FormTargets> = {};
    for (const row of rows) {
      const exerciseId = typeof row.exercise_id === 'string' ? row.exercise_id : null;
      if (!exerciseId) continue;
      const override = extractFormTargetOverride(row);
      if (override) map[exerciseId] = override;
    }
    return map;
  } catch (error) {
    errorWithTs('[SessionRunner] Failed to load form-target overrides', error);
    return {};
  }
}

// Re-export types so callers using session-runner don't need to import two
// modules when they want both the store hook and FormTargets type.
export type { FormTargets } from '@/lib/services/form-target-resolver';
export type { WorkoutTemplate, WorkoutTemplateExercise };
