/**
 * Unit tests for the Session Runner Zustand store.
 *
 * Tests every public action in lib/stores/session-runner.ts by calling
 * useSessionRunner.getState() directly (no React rendering needed).
 */

// ---------------------------------------------------------------------------
// Mocks — jest.mock calls are hoisted, so factory functions must not
// reference outer `const` variables (TDZ). We define mock fns inside
// each factory, then access them via require() in tests.
// ---------------------------------------------------------------------------

let mockUuidCounter = 0;

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `uuid-${++mockUuidCounter}`),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
    Rigid: 'rigid',
    Soft: 'soft',
  },
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  warnWithTs: jest.fn(),
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    db: {
      runAsync: jest.fn().mockResolvedValue(undefined),
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock('@/lib/services/database/generic-sync', () => ({
  genericLocalUpsert: jest.fn().mockResolvedValue(undefined),
  genericGetAll: jest.fn().mockResolvedValue([]),
  genericSoftDelete: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/services/rest-timer', () => ({
  computeRestSeconds: jest.fn().mockReturnValue(90),
  scheduleRestNotification: jest.fn().mockResolvedValue('notif-1'),
  cancelRestNotification: jest.fn().mockResolvedValue(undefined),
  computeRemainingSeconds: jest.fn().mockReturnValue(90),
}));

jest.mock('@/lib/services/tut-estimator', () => ({
  estimateTut: jest.fn().mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' }),
  timedSetTut: jest.fn().mockReturnValue({ tut_ms: 30000, tut_source: 'estimated' }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are declared
// ---------------------------------------------------------------------------

import { useSessionRunner } from '@/lib/stores/session-runner';
import { localDB } from '@/lib/services/database/local-db';
import {
  genericLocalUpsert,
  genericSoftDelete,
} from '@/lib/services/database/generic-sync';
import {
  computeRestSeconds,
  scheduleRestNotification,
  cancelRestNotification,
  computeRemainingSeconds,
} from '@/lib/services/rest-timer';
import { estimateTut, timedSetTut } from '@/lib/services/tut-estimator';

// Cast mocked imports to jest.Mock for type-safe assertions
const mockGenericLocalUpsert = genericLocalUpsert as jest.Mock;
const mockGenericSoftDelete = genericSoftDelete as jest.Mock;
const mockScheduleRestNotification = scheduleRestNotification as jest.Mock;
const mockCancelRestNotification = cancelRestNotification as jest.Mock;
const mockComputeRemainingSeconds = computeRemainingSeconds as jest.Mock;
const mockEstimateTut = estimateTut as jest.Mock;
const mockTimedSetTut = timedSetTut as jest.Mock;
const mockDb = localDB.db as unknown as {
  runAsync: jest.Mock;
  getAllAsync: jest.Mock;
  getFirstAsync: jest.Mock;
};
const mockRunAsync = mockDb.runAsync;
const mockGetAllAsync = mockDb.getAllAsync;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const state = () => useSessionRunner.getState();

function resetStore() {
  useSessionRunner.setState({
    activeSession: null,
    exercises: [],
    sets: {},
    restTimer: null,
    restTimerCompletionTimeout: null,
    isLoading: false,
    isWorkoutInProgress: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockUuidCounter = 0;
  resetStore();
  // Re-set default return values cleared by clearAllMocks
  mockGenericLocalUpsert.mockResolvedValue(undefined);
  mockGenericSoftDelete.mockResolvedValue(undefined);
  mockScheduleRestNotification.mockResolvedValue('notif-1');
  mockCancelRestNotification.mockResolvedValue(undefined);
  mockComputeRemainingSeconds.mockReturnValue(90);
  (computeRestSeconds as jest.Mock).mockReturnValue(90);
  mockEstimateTut.mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' });
  mockTimedSetTut.mockReturnValue({ tut_ms: 30000, tut_source: 'estimated' });
  mockRunAsync.mockResolvedValue(undefined);
  mockGetAllAsync.mockResolvedValue([]);
  mockDb.getFirstAsync.mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

// ===========================================================================
// 1. startSession
// ===========================================================================

describe('startSession', () => {
  it('creates a fresh session with correct defaults', async () => {
    await state().startSession();

    const s = state();
    expect(s.activeSession).not.toBeNull();
    expect(s.activeSession!.id).toBe('uuid-1');
    expect(s.activeSession!.goal_profile).toBe('hypertrophy');
    expect(s.activeSession!.template_id).toBeNull();
    expect(s.activeSession!.ended_at).toBeNull();
    expect(s.exercises).toEqual([]);
    expect(s.sets).toEqual({});
    expect(s.restTimer).toBeNull();
    expect(s.isWorkoutInProgress).toBe(true);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('persists session via genericLocalUpsert', async () => {
    await state().startSession({ name: 'Leg Day' });

    expect(mockGenericLocalUpsert).toHaveBeenCalledWith(
      'workout_sessions',
      'id',
      expect.objectContaining({
        id: 'uuid-1',
        name: 'Leg Day',
        synced: 0,
        deleted: 0,
      }),
      0,
    );
  });

  it('emits session_started event', async () => {
    await state().startSession();

    expect(mockGenericLocalUpsert).toHaveBeenCalledWith(
      'workout_session_events',
      'id',
      expect.objectContaining({
        session_id: 'uuid-1',
        type: 'session_started',
      }),
      0,
    );
  });

  it('passes goalProfile and bodyweightLb through to session row', async () => {
    await state().startSession({ goalProfile: 'strength', bodyweightLb: 185 });

    expect(mockGenericLocalUpsert).toHaveBeenCalledWith(
      'workout_sessions',
      'id',
      expect.objectContaining({
        goal_profile: 'strength',
        bodyweight_lb: 185,
      }),
      0,
    );
  });

  it('materializes template when templateId is provided', async () => {
    mockGetAllAsync.mockImplementation((sql: string) => {
      if (sql.includes('workout_template_exercises')) {
        return Promise.resolve([
          {
            id: 'te-1',
            template_id: 'tpl-1',
            exercise_id: 'ex-1',
            sort_order: 0,
            notes: null,
          },
        ]);
      }
      if (sql.includes('workout_template_sets')) {
        return Promise.resolve([
          {
            id: 'ts-1',
            template_exercise_id: 'te-1',
            sort_order: 0,
            set_type: 'normal',
            target_reps: 10,
            target_seconds: null,
            target_weight: 135,
            rest_seconds_override: null,
            notes: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await state().startSession({ templateId: 'tpl-1' });

    const upsertCalls = mockGenericLocalUpsert.mock.calls;
    const sessionExerciseUpsert = upsertCalls.find(
      (c: any[]) => c[0] === 'workout_session_exercises',
    );
    expect(sessionExerciseUpsert).toBeDefined();
    expect(sessionExerciseUpsert![2]).toMatchObject({
      exercise_id: 'ex-1',
      sort_order: 0,
    });

    const sessionSetUpsert = upsertCalls.find(
      (c: any[]) => c[0] === 'workout_session_sets',
    );
    expect(sessionSetUpsert).toBeDefined();
    expect(sessionSetUpsert![2]).toMatchObject({
      planned_reps: 10,
      planned_weight: 135,
      actual_weight: 135,
      set_type: 'normal',
    });
  });

  it('sets error on failure and clears isLoading', async () => {
    mockGenericLocalUpsert.mockRejectedValueOnce(new Error('DB write failed'));

    await state().startSession();

    const s = state();
    expect(s.error).toBe('DB write failed');
    expect(s.isLoading).toBe(false);
    expect(s.activeSession).toBeNull();
  });
});

// ===========================================================================
// 2. addExercise
// ===========================================================================

describe('addExercise', () => {
  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 10;
    // Restore defaults after clearAllMocks
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);
  });

  it('adds exercise + auto-creates first set', async () => {
    const seId = await state().addExercise('ex-push');

    expect(seId).toBe('uuid-11');
    const s = state();
    expect(s.exercises).toHaveLength(1);
    expect(s.exercises[0].exercise_id).toBe('ex-push');
    expect(s.exercises[0].sort_order).toBe(0);

    // Auto-created first set
    expect(s.sets['uuid-11']).toBeDefined();
    expect(s.sets['uuid-11']).toHaveLength(1);
  });

  it('persists exercise via genericLocalUpsert', async () => {
    await state().addExercise('ex-push');

    expect(mockGenericLocalUpsert).toHaveBeenCalledWith(
      'workout_session_exercises',
      'id',
      expect.objectContaining({
        id: 'uuid-11',
        exercise_id: 'ex-push',
        session_id: 'uuid-1',
        synced: 0,
      }),
      0,
    );
  });

  it('emits exercise_started event', async () => {
    const seId = await state().addExercise('ex-push');

    expect(mockGenericLocalUpsert).toHaveBeenCalledWith(
      'workout_session_events',
      'id',
      expect.objectContaining({
        type: 'exercise_started',
        session_exercise_id: seId,
      }),
      0,
    );
  });

  it('throws when no active session', async () => {
    resetStore();
    await expect(state().addExercise('ex-push')).rejects.toThrow('No active session');
  });

  it('attaches exercise metadata when found in DB', async () => {
    mockGetAllAsync.mockImplementation((sql: string) => {
      if (sql.includes('FROM exercises')) {
        return Promise.resolve([{ id: 'ex-push', name: 'Push Up', is_compound: true, is_timed: false }]);
      }
      return Promise.resolve([]);
    });

    await state().addExercise('ex-push');

    const s = state();
    expect(s.exercises[0].exercise).toMatchObject({ name: 'Push Up' });
  });
});

// ===========================================================================
// 3. removeExercise
// ===========================================================================

describe('removeExercise', () => {
  let exId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 10;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGenericSoftDelete.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);

    exId = await state().addExercise('ex-1');
  });

  it('removes exercise and its sets from state', async () => {
    await state().removeExercise(exId);

    const s = state();
    expect(s.exercises).toHaveLength(0);
    expect(s.sets[exId]).toBeUndefined();
  });

  it('calls genericSoftDelete for exercise and each set', async () => {
    const setId = state().sets[exId][0].id;

    await state().removeExercise(exId);

    expect(mockGenericSoftDelete).toHaveBeenCalledWith(
      'workout_session_exercises',
      'id',
      exId,
    );
    expect(mockGenericSoftDelete).toHaveBeenCalledWith(
      'workout_session_sets',
      'id',
      setId,
    );
  });

  it('does nothing when no active session', async () => {
    resetStore();
    jest.clearAllMocks();
    await state().removeExercise('nonexistent');
    expect(mockGenericSoftDelete).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. addSet
// ===========================================================================

describe('addSet', () => {
  let exerciseId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);

    exerciseId = await state().addExercise('ex-1');
  });

  it('creates a new set for the exercise', async () => {
    jest.clearAllMocks();
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockUuidCounter = 30;

    const setId = await state().addSet(exerciseId);

    expect(setId).toBe('uuid-31');
    const sets = state().sets[exerciseId];
    expect(sets).toHaveLength(2); // auto-created + new one
  });

  it('inherits planned values from the previous set', async () => {
    const firstSetId = state().sets[exerciseId][0].id;
    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) =>
        s.id === firstSetId
          ? { ...s, planned_weight: 100, planned_reps: 8, planned_seconds: null }
          : s,
      );
      return { sets: newSets };
    });

    mockUuidCounter = 30;
    await state().addSet(exerciseId);

    const sets = state().sets[exerciseId];
    const newSet = sets[sets.length - 1];
    expect(newSet.planned_weight).toBe(100);
    expect(newSet.planned_reps).toBe(8);
  });

  it('inherits actual_weight from previous set when available', async () => {
    const firstSetId = state().sets[exerciseId][0].id;
    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) =>
        s.id === firstSetId
          ? { ...s, actual_weight: 135, planned_weight: 130 }
          : s,
      );
      return { sets: newSets };
    });

    mockUuidCounter = 30;
    await state().addSet(exerciseId);

    const sets = state().sets[exerciseId];
    const newSet = sets[sets.length - 1];
    expect(newSet.actual_weight).toBe(135);
  });

  it('uses default set_type of "normal"', async () => {
    mockUuidCounter = 30;
    await state().addSet(exerciseId);

    const sets = state().sets[exerciseId];
    const newSet = sets[sets.length - 1];
    expect(newSet.set_type).toBe('normal');
  });

  it('accepts custom set_type', async () => {
    mockUuidCounter = 30;
    await state().addSet(exerciseId, 'warmup');

    const sets = state().sets[exerciseId];
    const newSet = sets[sets.length - 1];
    expect(newSet.set_type).toBe('warmup');
  });

  it('persists set via genericLocalUpsert', async () => {
    jest.clearAllMocks();
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockUuidCounter = 30;

    await state().addSet(exerciseId);

    expect(mockGenericLocalUpsert).toHaveBeenCalledWith(
      'workout_session_sets',
      'id',
      expect.objectContaining({
        id: 'uuid-31',
        session_exercise_id: exerciseId,
        synced: 0,
      }),
      0,
    );
  });

  it('throws when no active session', async () => {
    resetStore();
    await expect(state().addSet('some-ex-id')).rejects.toThrow('No active session');
  });
});

// ===========================================================================
// 5. removeSet
// ===========================================================================

describe('removeSet', () => {
  let exerciseId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGenericSoftDelete.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);

    exerciseId = await state().addExercise('ex-1');
    mockUuidCounter = 30;
    await state().addSet(exerciseId);
  });

  it('removes set from state', async () => {
    const sets = state().sets[exerciseId];
    expect(sets).toHaveLength(2);

    const setToRemove = sets[1].id;
    await state().removeSet(setToRemove);

    expect(state().sets[exerciseId]).toHaveLength(1);
  });

  it('calls genericSoftDelete', async () => {
    const setId = state().sets[exerciseId][0].id;
    jest.clearAllMocks();
    mockGenericSoftDelete.mockResolvedValue(undefined);

    await state().removeSet(setId);

    expect(mockGenericSoftDelete).toHaveBeenCalledWith(
      'workout_session_sets',
      'id',
      setId,
    );
  });
});

// ===========================================================================
// 6. updateSet
// ===========================================================================

describe('updateSet', () => {
  let exerciseId: string;
  let setId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);

    exerciseId = await state().addExercise('ex-1');
    setId = state().sets[exerciseId][0].id;
  });

  it('updates set fields in state', async () => {
    await state().updateSet(setId, { actual_reps: 10, actual_weight: 135 });

    const sets = state().sets[exerciseId];
    const updated = sets.find((s) => s.id === setId);
    expect(updated!.actual_reps).toBe(10);
    expect(updated!.actual_weight).toBe(135);
  });

  it('runs UPDATE SQL on the database', async () => {
    await state().updateSet(setId, { actual_reps: 10 });

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workout_session_sets SET'),
      expect.arrayContaining([10]),
    );
  });

  it('does nothing when fields are empty', async () => {
    jest.clearAllMocks();
    await state().updateSet(setId, {});

    expect(mockRunAsync).not.toHaveBeenCalled();
  });

  it('strips id field from updates', async () => {
    await state().updateSet(setId, { id: 'hacked', actual_reps: 5 } as any);

    const sql = mockRunAsync.mock.calls[0]?.[0] as string;
    // The SET clause should not contain "id = ?", only the WHERE clause should
    const setClause = sql.split('SET ')[1]?.split(' WHERE')[0] ?? '';
    expect(setClause).not.toContain('id = ?');
    expect(setClause).toContain('actual_reps = ?');
  });
});

// ===========================================================================
// 7. completeSet
// ===========================================================================

describe('completeSet', () => {
  let exerciseId: string;
  let setId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);
    mockScheduleRestNotification.mockResolvedValue('notif-1');
    mockCancelRestNotification.mockResolvedValue(undefined);
    (computeRestSeconds as jest.Mock).mockReturnValue(90);
    mockComputeRemainingSeconds.mockReturnValue(90);
    mockEstimateTut.mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' });

    exerciseId = await state().addExercise('ex-1');
    setId = state().sets[exerciseId][0].id;

    // Put actual values on the set so TUT can be computed
    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) =>
        s.id === setId ? { ...s, actual_reps: 10, actual_weight: 135 } : s,
      );
      return { sets: newSets };
    });
    jest.clearAllMocks();
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockRunAsync.mockResolvedValue(undefined);
    mockScheduleRestNotification.mockResolvedValue('notif-1');
    (computeRestSeconds as jest.Mock).mockReturnValue(90);
    mockComputeRemainingSeconds.mockReturnValue(90);
    mockEstimateTut.mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' });
    mockTimedSetTut.mockReturnValue({ tut_ms: 30000, tut_source: 'estimated' });
  });

  it('marks set completed_at and starts rest timer', async () => {
    await state().completeSet(setId);

    const s = state();
    const completedSet = s.sets[exerciseId].find((x) => x.id === setId);
    expect(completedSet!.completed_at).toBeTruthy();
    expect(completedSet!.rest_started_at).toBeTruthy();
    expect(completedSet!.rest_target_seconds).toBe(90);

    expect(s.restTimer).not.toBeNull();
    expect(s.restTimer!.targetSeconds).toBe(90);
    expect(s.restTimer!.setId).toBe(setId);
  });

  it('persists completion to DB', async () => {
    await state().completeSet(setId);

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workout_session_sets SET'),
      expect.arrayContaining([90]),
    );
  });

  it('emits set_completed and rest_started events', async () => {
    await state().completeSet(setId);

    const eventCalls = mockGenericLocalUpsert.mock.calls.filter(
      (c: any[]) => c[0] === 'workout_session_events',
    );
    const eventTypes = eventCalls.map((c: any[]) => c[2].type);
    expect(eventTypes).toContain('set_completed');
    expect(eventTypes).toContain('rest_started');
  });

  it('schedules rest notification', async () => {
    await state().completeSet(setId);

    expect(mockScheduleRestNotification).toHaveBeenCalledWith(
      90,
      undefined, // exercise.name when exercise not found in metadata
      expect.any(Number),
    );
  });

  it('computes TUT via estimateTut for rep-based sets', async () => {
    await state().completeSet(setId);

    expect(mockEstimateTut).toHaveBeenCalledWith(10);

    const completedSet = state().sets[exerciseId].find((x) => x.id === setId);
    expect(completedSet!.tut_ms).toBe(8000);
    expect(completedSet!.tut_source).toBe('estimated');
  });

  it('computes TUT via timedSetTut for timed exercises', async () => {
    // Mark exercise as timed
    useSessionRunner.setState((prev) => ({
      exercises: prev.exercises.map((e) =>
        e.id === exerciseId
          ? { ...e, exercise: { id: 'ex-1', name: 'Plank', is_timed: true, is_compound: false } as any }
          : e,
      ),
    }));
    // Set actual_seconds instead of actual_reps
    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) =>
        s.id === setId ? { ...s, actual_reps: null, actual_seconds: 30 } : s,
      );
      return { sets: newSets };
    });

    await state().completeSet(setId);

    expect(mockTimedSetTut).toHaveBeenCalledWith(30);
  });

  it('does nothing when no active session', async () => {
    resetStore();
    jest.clearAllMocks();
    await state().completeSet('nonexistent');

    expect(mockRunAsync).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 8. skipRest
// ===========================================================================

describe('skipRest', () => {
  let exerciseId: string;
  let setId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);
    mockScheduleRestNotification.mockResolvedValue('notif-1');
    mockCancelRestNotification.mockResolvedValue(undefined);
    (computeRestSeconds as jest.Mock).mockReturnValue(90);
    mockComputeRemainingSeconds.mockReturnValue(90);
    mockEstimateTut.mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' });

    exerciseId = await state().addExercise('ex-1');
    setId = state().sets[exerciseId][0].id;

    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) =>
        s.id === setId ? { ...s, actual_reps: 10, actual_weight: 135 } : s,
      );
      return { sets: newSets };
    });
    await state().completeSet(setId);
    jest.clearAllMocks();
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockRunAsync.mockResolvedValue(undefined);
    mockCancelRestNotification.mockResolvedValue(undefined);
  });

  it('clears restTimer to null', async () => {
    expect(state().restTimer).not.toBeNull();

    await state().skipRest();

    expect(state().restTimer).toBeNull();
  });

  it('marks set rest_skipped in DB', async () => {
    await state().skipRest();

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('rest_skipped = 1'),
      expect.any(Array),
    );
  });

  it('updates set in state with rest_completed_at and rest_skipped', async () => {
    await state().skipRest();

    const set = state().sets[exerciseId].find((s) => s.id === setId);
    expect(set!.rest_completed_at).toBeTruthy();
    expect(set!.rest_skipped).toBe(true);
  });

  it('emits rest_skipped event', async () => {
    await state().skipRest();

    expect(mockGenericLocalUpsert).toHaveBeenCalledWith(
      'workout_session_events',
      'id',
      expect.objectContaining({ type: 'rest_skipped' }),
      0,
    );
  });

  it('cancels rest notification', async () => {
    await state().skipRest();

    expect(mockCancelRestNotification).toHaveBeenCalled();
  });

  it('does nothing when no rest timer is active', async () => {
    await state().skipRest();
    jest.clearAllMocks();
    mockRunAsync.mockResolvedValue(undefined);

    await state().skipRest();
    expect(mockRunAsync).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 9. extendRest
// ===========================================================================

describe('extendRest', () => {
  let exerciseId: string;
  let setId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);
    mockScheduleRestNotification.mockResolvedValue('notif-1');
    mockCancelRestNotification.mockResolvedValue(undefined);
    (computeRestSeconds as jest.Mock).mockReturnValue(90);
    mockComputeRemainingSeconds.mockReturnValue(90);
    mockEstimateTut.mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' });

    exerciseId = await state().addExercise('ex-1');
    setId = state().sets[exerciseId][0].id;

    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) =>
        s.id === setId ? { ...s, actual_reps: 10, actual_weight: 135 } : s,
      );
      return { sets: newSets };
    });
    await state().completeSet(setId);
    jest.clearAllMocks();
    mockRunAsync.mockResolvedValue(undefined);
    mockScheduleRestNotification.mockResolvedValue('notif-1');
    mockComputeRemainingSeconds.mockReturnValue(60);
  });

  it('increases targetSeconds on restTimer', () => {
    const originalTarget = state().restTimer!.targetSeconds;

    state().extendRest(30);

    expect(state().restTimer!.targetSeconds).toBe(originalTarget + 30);
  });

  it('reschedules notification with remaining seconds', () => {
    state().extendRest(30);

    expect(mockScheduleRestNotification).toHaveBeenCalledWith(60);
  });

  it('updates rest_target_seconds in DB', () => {
    state().extendRest(30);

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('rest_target_seconds = ?'),
      expect.any(Array),
    );
  });

  it('does nothing when no rest timer', () => {
    resetStore();
    jest.clearAllMocks();

    state().extendRest(30);

    expect(mockScheduleRestNotification).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 10. finishSession
// ===========================================================================

describe('finishSession', () => {
  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockRunAsync.mockResolvedValue(undefined);
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockCancelRestNotification.mockResolvedValue(undefined);
  });

  it('clears all session state', async () => {
    await state().finishSession();

    const s = state();
    expect(s.activeSession).toBeNull();
    expect(s.exercises).toEqual([]);
    expect(s.sets).toEqual({});
    expect(s.restTimer).toBeNull();
    expect(s.isWorkoutInProgress).toBe(false);
  });

  it('sets ended_at in the database', async () => {
    await state().finishSession();

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workout_sessions SET ended_at'),
      expect.any(Array),
    );
  });

  it('emits session_completed event', async () => {
    await state().finishSession();

    expect(mockGenericLocalUpsert).toHaveBeenCalledWith(
      'workout_session_events',
      'id',
      expect.objectContaining({ type: 'session_completed' }),
      0,
    );
  });

  it('cancels rest notification', async () => {
    await state().finishSession();

    expect(mockCancelRestNotification).toHaveBeenCalled();
  });

  it('is a no-op when no active session', async () => {
    resetStore();
    jest.clearAllMocks();

    await state().finishSession();

    expect(mockRunAsync).not.toHaveBeenCalled();
    expect(mockGenericLocalUpsert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 10b. onSessionFinished subscription fan-out
// ===========================================================================

describe('onSessionFinished', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- after jest.mock hoists
  const {
    onSessionFinished,
    __resetSessionFinishedListenersForTests,
  } = require('@/lib/stores/session-runner') as typeof import('@/lib/stores/session-runner');

  beforeEach(async () => {
    __resetSessionFinishedListenersForTests();
    await state().startSession();
    jest.clearAllMocks();
    mockRunAsync.mockResolvedValue(undefined);
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockCancelRestNotification.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __resetSessionFinishedListenersForTests();
  });

  it('invokes subscribed listeners with the finished session metadata', async () => {
    const listener = jest.fn();
    onSessionFinished(listener);

    const sessionId = state().activeSession!.id;
    const startedAt = state().activeSession!.started_at;

    await state().finishSession();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        startedAt,
        endedAt: expect.any(String),
        goalProfile: 'hypertrophy',
      }),
    );
  });

  it('supports multiple listeners (fan-out)', async () => {
    const a = jest.fn();
    const b = jest.fn();
    onSessionFinished(a);
    onSessionFinished(b);

    await state().finishSession();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further invocations', async () => {
    const listener = jest.fn();
    const unsubscribe = onSessionFinished(listener);
    unsubscribe();

    await state().finishSession();

    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates listener errors (one failure does not affect others)', async () => {
    const throwing = jest.fn(() => {
      throw new Error('listener boom');
    });
    const ok = jest.fn();
    onSessionFinished(throwing);
    onSessionFinished(ok);

    await expect(state().finishSession()).resolves.toBeUndefined();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('awaits async listeners before finishSession returns', async () => {
    let resolved = false;
    onSessionFinished(async () => {
      // Microtask-only delay so fake timers don't block the assertion.
      await Promise.resolve();
      resolved = true;
    });

    await state().finishSession();
    expect(resolved).toBe(true);
  });
});

// ===========================================================================
// 11. loadActiveSession
// ===========================================================================

describe('loadActiveSession', () => {
  it('restores session from DB when one exists', async () => {
    const mockSession = {
      id: 'sess-existing',
      goal_profile: 'hypertrophy',
      started_at: new Date().toISOString(),
      ended_at: null,
      deleted: 0,
    };

    mockGetAllAsync.mockImplementation((sql: string) => {
      if (sql.includes('workout_sessions')) {
        return Promise.resolve([mockSession]);
      }
      if (sql.includes('workout_session_exercises')) {
        return Promise.resolve([
          {
            id: 'se-1',
            session_id: 'sess-existing',
            exercise_id: 'ex-1',
            sort_order: 0,
          },
        ]);
      }
      if (sql.includes('workout_session_sets')) {
        return Promise.resolve([
          {
            id: 'ss-1',
            session_exercise_id: 'se-1',
            sort_order: 0,
            set_type: 'normal',
            planned_reps: 10,
            rest_started_at: null,
            rest_completed_at: null,
            rest_skipped: false,
          },
        ]);
      }
      if (sql.includes('FROM exercises')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    await state().loadActiveSession();

    const s = state();
    expect(s.activeSession).not.toBeNull();
    expect(s.activeSession!.id).toBe('sess-existing');
    expect(s.exercises).toHaveLength(1);
    expect(s.sets['se-1']).toHaveLength(1);
    expect(s.isWorkoutInProgress).toBe(true);
    expect(s.isLoading).toBe(false);
  });

  it('clears state when no active session found', async () => {
    // First start a session so there is state to clear
    await state().startSession();
    jest.clearAllMocks();
    mockGetAllAsync.mockResolvedValue([]);

    await state().loadActiveSession();

    const s = state();
    expect(s.activeSession).toBeNull();
    expect(s.exercises).toEqual([]);
    expect(s.sets).toEqual({});
    expect(s.isWorkoutInProgress).toBe(false);
  });

  it('restores rest timer when a set has active rest', async () => {
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    mockComputeRemainingSeconds.mockReturnValue(60);

    mockGetAllAsync.mockImplementation((sql: string) => {
      if (sql.includes('workout_sessions')) {
        return Promise.resolve([
          { id: 'sess-1', goal_profile: 'hypertrophy', started_at: startedAt, ended_at: null, deleted: 0 },
        ]);
      }
      if (sql.includes('workout_session_exercises')) {
        return Promise.resolve([
          { id: 'se-1', session_id: 'sess-1', exercise_id: 'ex-1', sort_order: 0 },
        ]);
      }
      if (sql.includes('workout_session_sets')) {
        return Promise.resolve([
          {
            id: 'ss-active',
            session_exercise_id: 'se-1',
            sort_order: 0,
            rest_started_at: startedAt,
            rest_completed_at: null,
            rest_skipped: false,
            rest_target_seconds: 90,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await state().loadActiveSession();

    const s = state();
    expect(s.restTimer).not.toBeNull();
    expect(s.restTimer!.setId).toBe('ss-active');
    expect(s.restTimer!.targetSeconds).toBe(90);
  });

  it('sets error on failure', async () => {
    mockGetAllAsync.mockRejectedValue(new Error('DB read failed'));

    await state().loadActiveSession();

    expect(state().error).toBe('DB read failed');
    expect(state().isLoading).toBe(false);
  });
});

// ===========================================================================
// 12. duplicateSet
// ===========================================================================

describe('duplicateSet', () => {
  let exerciseId: string;
  let firstSetId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);

    exerciseId = await state().addExercise('ex-1');
    firstSetId = state().sets[exerciseId][0].id;

    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) =>
        s.id === firstSetId
          ? {
              ...s,
              planned_reps: 10,
              planned_weight: 135,
              actual_weight: 140,
              set_type: 'normal' as const,
            }
          : s,
      );
      return { sets: newSets };
    });
    jest.clearAllMocks();
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockUuidCounter = 40;
  });

  it('creates N new sets with same planned values and null actuals', async () => {
    await state().duplicateSet(firstSetId, 2);

    const sets = state().sets[exerciseId];
    expect(sets).toHaveLength(3); // original + 2 duplicates

    const dup1 = sets[1];
    const dup2 = sets[2];

    expect(dup1.planned_reps).toBe(10);
    expect(dup1.planned_weight).toBe(135);
    expect(dup2.planned_reps).toBe(10);
    expect(dup2.planned_weight).toBe(135);
    expect(dup1.actual_weight).toBe(140);
    expect(dup1.actual_reps).toBeNull();
    expect(dup1.completed_at).toBeNull();
  });

  it('defaults to count=1', async () => {
    await state().duplicateSet(firstSetId);

    expect(state().sets[exerciseId]).toHaveLength(2);
  });

  it('persists each duplicate via genericLocalUpsert', async () => {
    await state().duplicateSet(firstSetId, 2);

    const upsertCalls = mockGenericLocalUpsert.mock.calls.filter(
      (c: any[]) => c[0] === 'workout_session_sets',
    );
    expect(upsertCalls).toHaveLength(2);
  });

  it('is a no-op when set not found', async () => {
    await state().duplicateSet('nonexistent-set');

    expect(mockGenericLocalUpsert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 13. updateSetType
// ===========================================================================

describe('updateSetType', () => {
  let exerciseId: string;
  let setId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);

    exerciseId = await state().addExercise('ex-1');
    setId = state().sets[exerciseId][0].id;
  });

  it('changes set_type in state', async () => {
    await state().updateSetType(setId, 'warmup');

    const set = state().sets[exerciseId].find((s) => s.id === setId);
    expect(set!.set_type).toBe('warmup');
  });

  it('delegates to updateSet', async () => {
    await state().updateSetType(setId, 'dropset');

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('set_type = ?'),
      expect.arrayContaining(['dropset']),
    );
  });
});

// ===========================================================================
// 14. duplicateExercise
// ===========================================================================

describe('duplicateExercise', () => {
  let exerciseId: string;

  beforeEach(async () => {
    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 20;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGenericSoftDelete.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);

    exerciseId = await state().addExercise('ex-bench');

    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) => ({
        ...s,
        planned_reps: 8,
        planned_weight: 185,
        actual_weight: 185,
        set_type: 'normal' as const,
      }));
      return { sets: newSets };
    });
    jest.clearAllMocks();
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGenericSoftDelete.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);
    mockUuidCounter = 40;
  });

  it('creates a new exercise with the same exercise_id', async () => {
    await state().duplicateExercise(exerciseId);

    const exercises = state().exercises;
    expect(exercises).toHaveLength(2);
    expect(exercises[0].exercise_id).toBe('ex-bench');
    expect(exercises[1].exercise_id).toBe('ex-bench');
    expect(exercises[0].id).not.toBe(exercises[1].id);
  });

  it('duplicates sets from the source exercise', async () => {
    await state().duplicateExercise(exerciseId);

    const newExId = state().exercises[1].id;
    const newSets = state().sets[newExId];

    expect(newSets).toBeDefined();
    expect(newSets.length).toBeGreaterThanOrEqual(1);
    expect(newSets[0].planned_reps).toBe(8);
    expect(newSets[0].planned_weight).toBe(185);
    expect(newSets[0].actual_reps).toBeNull();
  });

  it('is a no-op when exercise not found', async () => {
    jest.clearAllMocks();

    await state().duplicateExercise('nonexistent');

    expect(mockGenericLocalUpsert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// swapExerciseByDetectionMode
// ===========================================================================

describe('swapExerciseByDetectionMode', () => {
  beforeEach(async () => {
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
  });

  it('returns null when no session is active', async () => {
    const result = await state().swapExerciseByDetectionMode('pullup');
    expect(result).toBeNull();
  });

  it('returns null when the local db cannot resolve an exercise for the mode', async () => {
    await state().startSession();
    mockGetAllAsync.mockResolvedValue([]);

    const result = await state().swapExerciseByDetectionMode('pullup');
    expect(result).toBeNull();
  });

  it('appends a new session exercise when a mode match exists', async () => {
    await state().startSession();

    // First call: find by id (returns the matched exercise id).
    // Subsequent getAllAsync calls are for loadSessionExercises etc.
    mockGetAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM exercises WHERE LOWER')) {
        return [{ id: 'ex-pullup-system' }];
      }
      if (sql.includes('FROM exercises WHERE id')) {
        return [{ id: 'ex-pullup-system', name: 'Pull-Up', is_compound: 1, is_timed: 0, is_system: 1 }];
      }
      return [];
    });

    const existingCount = state().exercises.length;
    const newSeId = await state().swapExerciseByDetectionMode('pullup', 'append');
    expect(newSeId).toBeTruthy();
    expect(state().exercises.length).toBe(existingCount + 1);
    expect(state().exercises[state().exercises.length - 1].exercise_id).toBe('ex-pullup-system');
  });

  it('removes the current exercise then adds the new one on replace', async () => {
    await state().startSession();

    // Seed an existing exercise
    mockGetAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM exercises WHERE LOWER')) {
        return [{ id: 'ex-squat' }];
      }
      if (sql.includes('FROM exercises WHERE id')) {
        return [{ id: 'ex-squat', name: 'Squat', is_compound: 1, is_timed: 0, is_system: 1 }];
      }
      return [];
    });
    await state().addExercise('ex-first');

    const beforeLen = state().exercises.length;
    const firstId = state().exercises[beforeLen - 1].id;

    const newSeId = await state().swapExerciseByDetectionMode('squat', 'replace');
    expect(newSeId).toBeTruthy();
    // removeExercise + addExercise: net 0 change, but id differs
    expect(state().exercises.length).toBe(beforeLen);
    expect(state().exercises.some((e) => e.id === firstId)).toBe(false);
    expect(mockGenericSoftDelete).toHaveBeenCalledWith('workout_session_exercises', 'id', firstId);
  });
});

// ===========================================================================
// Integration: Full Session Lifecycle
// ===========================================================================

describe('full session lifecycle', () => {
  it('start -> add exercise -> add set -> complete set -> skip rest -> finish', async () => {
    // Ensure mocks are active throughout
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockScheduleRestNotification.mockResolvedValue('notif-1');
    mockCancelRestNotification.mockResolvedValue(undefined);
    (computeRestSeconds as jest.Mock).mockReturnValue(90);
    mockComputeRemainingSeconds.mockReturnValue(90);
    mockEstimateTut.mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' });
    mockRunAsync.mockResolvedValue(undefined);

    // 1. Start
    await state().startSession({ name: 'Integration Test', goalProfile: 'strength' });
    expect(state().isWorkoutInProgress).toBe(true);

    // 2. Add exercise
    mockUuidCounter = 100;
    const exId = await state().addExercise('ex-squat');
    expect(state().exercises).toHaveLength(1);

    const autoSetId = state().sets[exId][0].id;

    // 3. Update set with actual values
    await state().updateSet(autoSetId, { actual_reps: 5, actual_weight: 315 });
    expect(state().sets[exId][0].actual_reps).toBe(5);
    expect(state().sets[exId][0].actual_weight).toBe(315);

    // 4. Complete set -> rest timer starts
    await state().completeSet(autoSetId);
    expect(state().restTimer).not.toBeNull();
    expect(state().sets[exId][0].completed_at).toBeTruthy();

    // 5. Skip rest
    await state().skipRest();
    expect(state().restTimer).toBeNull();
    expect(state().sets[exId][0].rest_skipped).toBe(true);

    // 6. Add another set
    mockUuidCounter = 200;
    await state().addSet(exId);
    expect(state().sets[exId]).toHaveLength(2);

    // Second set should inherit weight
    const secondSet = state().sets[exId][1];
    expect(secondSet.actual_weight).toBe(315);

    // 7. Finish
    await state().finishSession();
    expect(state().activeSession).toBeNull();
    expect(state().isWorkoutInProgress).toBe(false);
  });
});

// ===========================================================================
// Rest Timer — Unified Zustand Ownership (issue #418)
// ===========================================================================

describe('rest timer — unified ownership', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Haptics = require('expo-haptics') as {
    notificationAsync: jest.Mock;
  };

  beforeEach(() => {
    Haptics.notificationAsync.mockClear();
    Haptics.notificationAsync.mockResolvedValue(undefined);
  });

  it('fires a single completion haptic when the rest timer elapses', async () => {
    await state().startSession();
    mockUuidCounter = 10;
    const exId = await state().addExercise('ex');
    const setId = state().sets[exId][0].id;
    await state().updateSet(setId, { actual_reps: 5 });

    mockComputeRemainingSeconds.mockReturnValue(2);
    await state().completeSet(setId);

    // Before timeout expires — no haptic yet.
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(state().restTimer).not.toBeNull();

    // Advance past 2s rest.
    jest.advanceTimersByTime(2001);

    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(state().restTimer).toBeNull();
    expect(state().restTimerCompletionTimeout).toBeNull();
  });

  it('suppresses completion haptic when the rest is skipped first', async () => {
    await state().startSession();
    mockUuidCounter = 20;
    const exId = await state().addExercise('ex');
    const setId = state().sets[exId][0].id;
    await state().updateSet(setId, { actual_reps: 5 });

    mockComputeRemainingSeconds.mockReturnValue(2);
    await state().completeSet(setId);

    await state().skipRest();

    jest.advanceTimersByTime(5000);

    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(state().restTimer).toBeNull();
    expect(state().restTimerCompletionTimeout).toBeNull();
  });

  it('does not leak timeouts across repeated completeSet calls', async () => {
    await state().startSession();
    mockUuidCounter = 30;
    const exId = await state().addExercise('ex');
    const setId = state().sets[exId][0].id;
    await state().updateSet(setId, { actual_reps: 5 });

    mockComputeRemainingSeconds.mockReturnValue(5);
    await state().completeSet(setId);
    const firstTimeout = state().restTimerCompletionTimeout;
    expect(firstTimeout).not.toBeNull();

    // Extending rest should cancel the previous timeout and install a new one.
    state().extendRest(10);
    const secondTimeout = state().restTimerCompletionTimeout;
    expect(secondTimeout).not.toBeNull();
    expect(secondTimeout).not.toBe(firstTimeout);

    // Only the newer timeout fires.
    jest.advanceTimersByTime(20_000);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 15. subscribeToEvents (named event listener API)
// ===========================================================================

import {
  subscribeToEvents,
  __resetSessionEventListenersForTests,
} from '@/lib/stores/session-runner';

describe('subscribeToEvents', () => {
  beforeEach(() => {
    __resetSessionEventListenersForTests();
  });

  afterEach(() => {
    __resetSessionEventListenersForTests();
  });

  it('invokes a subscribed listener when events are emitted through the store', async () => {
    const listener = jest.fn();
    subscribeToEvents(listener);

    await state().startSession();

    expect(listener).toHaveBeenCalled();
    const eventArg = listener.mock.calls[0][0];
    expect(eventArg).toMatchObject({
      type: 'session_started',
      session_id: expect.any(String),
    });
    // Payload is the rich object, not a JSON string
    expect(typeof eventArg.payload).toBe('object');
  });

  it('unsubscribe stops further fires', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToEvents(listener);

    await state().startSession();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    mockUuidCounter = 200;
    await state().addExercise('ex-1');
    // addExercise emits exercise_started; listener should NOT see it after unsubscribe
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('multiple listeners each receive independent fires', async () => {
    const listenerA = jest.fn();
    const listenerB = jest.fn();
    subscribeToEvents(listenerA);
    subscribeToEvents(listenerB);

    await state().startSession();

    expect(listenerA).toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalled();
    expect(listenerA.mock.calls.length).toBe(listenerB.mock.calls.length);
  });

  it('existing emitEvent path (no subscribers) still writes the event row unchanged', async () => {
    // No subscribers attached. emitEvent path must still persist to DB.
    expect(mockGenericLocalUpsert).not.toHaveBeenCalledWith(
      'workout_session_events',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    await state().startSession();

    const eventUpsert = mockGenericLocalUpsert.mock.calls.find(
      (c: any[]) => c[0] === 'workout_session_events',
    );
    expect(eventUpsert).toBeDefined();
    expect(eventUpsert![2]).toMatchObject({
      type: 'session_started',
      synced: 0,
    });
    // Payload on the DB row is still the serialized JSON string
    expect(typeof eventUpsert![2].payload).toBe('string');
  });

  it('a listener that throws does not break subsequent listeners or the session flow', async () => {
    const bad = jest.fn(() => {
      throw new Error('listener boom');
    });
    const good = jest.fn();
    subscribeToEvents(bad);
    subscribeToEvents(good);

    // Should not reject — emitEvent catches listener errors
    await expect(state().startSession()).resolves.toBeUndefined();
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
    expect(state().isWorkoutInProgress).toBe(true);
  });
});

// ===========================================================================
// Rest-timer race: skip/extend during completeSet persistence
// ===========================================================================

describe('rest-timer race with completeSet', () => {
  let exerciseId: string;
  let setId: string;

  beforeEach(async () => {
    // These tests interleave real microtasks around slow-resolving notification
    // mocks. Fake timers (set globally in the outer beforeEach) serialize
    // setTimeout callbacks through the jest scheduler, which prevents the
    // completeSet `await scheduleRestNotification` from yielding naturally.
    // Swap to real timers for this suite (outer afterEach restores real,
    // outer beforeEach resets to fake — so we force real again here).
    jest.useRealTimers();

    await state().startSession();
    jest.clearAllMocks();
    mockUuidCounter = 500;
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockGetAllAsync.mockResolvedValue([]);
    mockRunAsync.mockResolvedValue(undefined);
    mockScheduleRestNotification.mockResolvedValue('notif-race');
    mockCancelRestNotification.mockResolvedValue(undefined);
    (computeRestSeconds as jest.Mock).mockReturnValue(120);
    mockComputeRemainingSeconds.mockReturnValue(120);
    mockEstimateTut.mockReturnValue({ tut_ms: 9000, tut_source: 'estimated' });

    exerciseId = await state().addExercise('ex-race');
    setId = state().sets[exerciseId][0].id;

    useSessionRunner.setState((prev) => {
      const newSets = { ...prev.sets };
      newSets[exerciseId] = newSets[exerciseId].map((s) =>
        s.id === setId ? { ...s, actual_reps: 8, actual_weight: 175 } : s,
      );
      return { sets: newSets };
    });
    jest.clearAllMocks();
    mockGenericLocalUpsert.mockResolvedValue(undefined);
    mockRunAsync.mockResolvedValue(undefined);
    mockScheduleRestNotification.mockResolvedValue('notif-race');
    mockCancelRestNotification.mockResolvedValue(undefined);
    (computeRestSeconds as jest.Mock).mockReturnValue(120);
    mockComputeRemainingSeconds.mockReturnValue(120);
    mockEstimateTut.mockReturnValue({ tut_ms: 9000, tut_source: 'estimated' });
  });

  it('cancels the scheduled rest when skipRest fires before completeSet persistence resolves', async () => {
    // Arrange: make the schedule call resolve slowly so we can fire skipRest
    // while completeSet is still awaiting notification scheduling.
    let resolveSchedule: (id: string) => void = () => {};
    mockScheduleRestNotification.mockImplementationOnce(
      () => new Promise<string>((r) => {
        resolveSchedule = r;
      }),
    );

    // Act: kick off completeSet but do NOT await it yet.
    const completePromise = state().completeSet(setId);

    // Flush microtasks in a loop so completeSet parks on the pending
    // scheduleRestNotification promise regardless of how many awaits it has.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(mockScheduleRestNotification).toHaveBeenCalledTimes(1);

    // Now resolve the slow schedule call and allow completeSet to finish.
    resolveSchedule('notif-race');
    await completePromise;

    expect(state().restTimer).not.toBeNull();

    // Immediately skip. This should cancel the just-scheduled notification
    // even though persistence has only just finished.
    await state().skipRest();

    expect(mockCancelRestNotification).toHaveBeenCalledTimes(1);
    expect(state().restTimer).toBeNull();
    // No duplicate schedule — we did not re-arm the timer after skipping.
    expect(mockScheduleRestNotification).toHaveBeenCalledTimes(1);
  });

  it('extends the scheduled rest and avoids duplicate notifications when extendRest fires mid-persistence', async () => {
    // Arrange: slow schedule on the initial completeSet call.
    let resolveSchedule: (id: string) => void = () => {};
    mockScheduleRestNotification.mockImplementationOnce(
      () => new Promise<string>((r) => {
        resolveSchedule = r;
      }),
    );

    const completePromise = state().completeSet(setId);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(mockScheduleRestNotification).toHaveBeenCalledTimes(1);

    resolveSchedule('notif-race');
    await completePromise;

    const initialTarget = state().restTimer!.targetSeconds;

    mockComputeRemainingSeconds.mockReturnValue(90);
    // The second schedule (from extendRest) is fire-and-forget; resolve fast.
    mockScheduleRestNotification.mockResolvedValueOnce('notif-race-ext');

    // Act: extend mid-persistence flow.
    state().extendRest(45);

    expect(state().restTimer!.targetSeconds).toBe(initialTarget + 45);
    // extendRest should reschedule exactly once (not duplicate).
    expect(mockScheduleRestNotification).toHaveBeenCalledTimes(2);
    expect(mockScheduleRestNotification).toHaveBeenLastCalledWith(90);
    // No notification cancellations along the extend path — it reuses the slot.
    expect(mockCancelRestNotification).not.toHaveBeenCalled();
  });

  it('cleans up notification IDs when skipRest is called on a set that finished between persist start and end', async () => {
    // Arrange: make the schedule call race and the skip happen concurrently
    // (skip arrives *after* completeSet kicked off but before it resolved).
    let resolveSchedule: (id: string) => void = () => {};
    mockScheduleRestNotification.mockImplementationOnce(
      () => new Promise<string>((r) => {
        resolveSchedule = r;
      }),
    );

    const completePromise = state().completeSet(setId);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(mockScheduleRestNotification).toHaveBeenCalledTimes(1);

    // Finish scheduling, then immediately skip — emulates a user tap between
    // persistence completing and UI hearing about it.
    resolveSchedule('notif-from-race');
    await completePromise;
    await state().skipRest();

    // cancelRestNotification should be invoked exactly once; repeated skip on
    // an empty timer must be a no-op (no extra cancellations).
    expect(mockCancelRestNotification).toHaveBeenCalledTimes(1);

    await state().skipRest();
    expect(mockCancelRestNotification).toHaveBeenCalledTimes(1);
    expect(state().restTimer).toBeNull();
    expect(state().restTimerCompletionTimeout).toBeNull();
  });
});
