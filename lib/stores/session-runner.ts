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
import type {
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionSet,
  WorkoutSessionEvent,
  GoalProfile,
  SetType,
  Exercise,
  SessionEventType,
} from '@/lib/types/workout-session';
import { logWithTs, errorWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export interface SessionRunnerState {
  // Session data
  activeSession: WorkoutSession | null;
  exercises: (WorkoutSessionExercise & { exercise?: Exercise })[];
  sets: Record<string, WorkoutSessionSet[]>; // keyed by session_exercise_id

  // Timer state
  restTimer: {
    targetSeconds: number;
    startedAt: string;
    setId: string;
  } | null;

  // Status
  isLoading: boolean;
  isWorkoutInProgress: boolean;

  // Actions
  startSession: (opts?: {
    templateId?: string;
    name?: string;
    goalProfile?: GoalProfile;
    bodyweightLb?: number;
  }) => Promise<void>;
  addExercise: (exerciseId: string) => Promise<string>;
  removeExercise: (sessionExerciseId: string) => Promise<void>;
  addSet: (sessionExerciseId: string, setType?: SetType) => Promise<string>;
  removeSet: (setId: string) => Promise<void>;
  updateSet: (setId: string, fields: Partial<WorkoutSessionSet>) => Promise<void>;
  completeSet: (setId: string) => Promise<void>;
  skipRest: () => Promise<void>;
  extendRest: (seconds: number) => void;
  finishSession: () => Promise<void>;
  loadActiveSession: () => Promise<void>;
  duplicateSet: (setId: string, count?: number) => Promise<void>;
  updateSetType: (setId: string, setType: SetType) => Promise<void>;
  duplicateExercise: (sessionExerciseId: string) => Promise<void>;
}

// =============================================================================
// Helpers
// =============================================================================

function nowIso(): string {
  return new Date().toISOString();
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

export const useSessionRunner = create<SessionRunnerState>((set, get) => ({
  activeSession: null,
  exercises: [],
  sets: {},
  restTimer: null,
  isLoading: false,
  isWorkoutInProgress: false,

  // =========================================================================
  // Start Session
  // =========================================================================
  startSession: async (opts) => {
    set({ isLoading: true });
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

      // If created from template, materialize exercises + sets
      if (opts?.templateId) {
        await materializeTemplate(sessionId, opts.templateId);
      }

      // Reload state
      const sessionObj = session as unknown as WorkoutSession;
      const exercises = await loadSessionExercises(sessionId);
      const sets = await loadSessionSets(exercises);

      set({
        activeSession: sessionObj,
        exercises,
        sets,
        restTimer: null,
        isWorkoutInProgress: true,
      });

      logWithTs(`[SessionRunner] Started session ${sessionId}`);
    } catch (error) {
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

    logWithTs(`[SessionRunner] Completed set ${setId}, rest: ${restSeconds}s`);
  },

  // =========================================================================
  // Skip Rest
  // =========================================================================
  skipRest: async () => {
    const { activeSession, restTimer } = get();
    if (!activeSession || !restTimer) return;

    const now = nowIso();

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

    // Reschedule notification
    const remaining = computeRemainingSeconds(restTimer.startedAt, newTarget);
    if (remaining > 0) {
      scheduleRestNotification(remaining).catch(() => {});
    }

    // Update DB
    const db = localDB.db;
    if (db) {
      db.runAsync(
        'UPDATE workout_session_sets SET rest_target_seconds = ?, synced = 0, updated_at = ? WHERE id = ?',
        [newTarget, nowIso(), restTimer.setId],
      ).catch(() => {});
    }

    set({
      restTimer: { ...restTimer, targetSeconds: newTarget },
    });
  },

  // =========================================================================
  // Finish Session
  // =========================================================================
  finishSession: async () => {
    const { activeSession } = get();
    if (!activeSession) return;

    const now = nowIso();

    await cancelRestNotification();

    const db = localDB.db;
    if (!db) return;

    await db.runAsync(
      'UPDATE workout_sessions SET ended_at = ?, synced = 0, updated_at = ? WHERE id = ?',
      [now, now, activeSession.id],
    );

    await emitEvent(activeSession.id, 'session_completed');

    set({
      activeSession: null,
      exercises: [],
      sets: {},
      restTimer: null,
      isWorkoutInProgress: false,
    });

    logWithTs(`[SessionRunner] Finished session ${activeSession.id}`);
  },

  // =========================================================================
  // Load Active Session (on app resume)
  // =========================================================================
  loadActiveSession: async () => {
    set({ isLoading: true });
    try {
      const db = localDB.db;
      if (!db) return;

      // Find any session without ended_at
      const rows = await db.getAllAsync<WorkoutSession>(
        'SELECT * FROM workout_sessions WHERE ended_at IS NULL AND deleted = 0 ORDER BY started_at DESC LIMIT 1',
      );

      if (rows.length === 0) {
        set({ activeSession: null, exercises: [], sets: {}, restTimer: null, isWorkoutInProgress: false });
        return;
      }

      const session = rows[0];
      const exercises = await loadSessionExercises(session.id);
      const sets = await loadSessionSets(exercises);

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
            }
          }
        }
      }

      set({
        activeSession: session,
        exercises,
        sets,
        restTimer,
        isWorkoutInProgress: true,
      });

      logWithTs(`[SessionRunner] Loaded active session ${session.id}`);
    } catch (error) {
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
}));

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
): Promise<void> {
  const db = localDB.db;
  if (!db) return;

  const now = nowIso();

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
}
