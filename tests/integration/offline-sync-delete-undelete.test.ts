/**
 * Integration test: delete-then-undelete with concurrent realtime INSERT.
 *
 * Scenario:
 *   1. A workout exists locally (synced=1).
 *   2. User soft-deletes it -> local row flips to deleted=1, synced=0, and a
 *      DELETE enters the sync queue.
 *   3. Sync drains the queue -> server DELETE succeeds.
 *   4. User "undeletes" by calling updateWorkout to restore the row
 *      (deleted=0, synced=0, updated_at=now).
 *   5. Concurrently, a realtime INSERT arrives from the same row id with an
 *      older updated_at (server-replayed ghost from the prior delete).
 *
 * Expected:
 *   - The local restore wins on updated_at (handleRealtimeWorkoutChange sees
 *     `synced === 0` on the local and skips the overwrite).
 *   - The realtime INSERT does not create a duplicate (no second row).
 *   - The sync queue ends with exactly ONE upsert for the restored row.
 */

// ---------------------------------------------------------------------------
// Supabase mock — chainable query-builder, records every call.
// ---------------------------------------------------------------------------

type SupabaseCall = {
  table: string;
  op: 'select' | 'upsert' | 'delete' | 'update' | 'insert';
  payload?: unknown;
  filter?: { column: string; value: unknown };
};

const supabaseCalls: SupabaseCall[] = [];
let pendingResolvedValue: { data?: unknown; error?: unknown } = { data: null, error: null };

function createQueryBuilder(table: string) {
  const state: { op?: SupabaseCall['op']; payload?: unknown; filter?: SupabaseCall['filter'] } = {};

  const builder: Record<string, unknown> = {};

  builder.select = jest.fn(() => {
    state.op = 'select';
    return builder;
  });
  builder.upsert = jest.fn((payload: unknown) => {
    state.op = 'upsert';
    state.payload = payload;
    supabaseCalls.push({ table, op: 'upsert', payload });
    return builder;
  });
  builder.insert = jest.fn((payload: unknown) => {
    state.op = 'insert';
    state.payload = payload;
    supabaseCalls.push({ table, op: 'insert', payload });
    return builder;
  });
  builder.update = jest.fn((payload: unknown) => {
    state.op = 'update';
    state.payload = payload;
    supabaseCalls.push({ table, op: 'update', payload });
    return builder;
  });
  builder.delete = jest.fn(() => {
    state.op = 'delete';
    return builder;
  });
  builder.eq = jest.fn((column: string, value: unknown) => {
    state.filter = { column, value };
    if (state.op === 'delete') {
      supabaseCalls.push({ table, op: 'delete', filter: state.filter });
    }
    return builder;
  });
  builder.single = jest.fn(() => builder);
  builder.then = (resolve: (v: unknown) => void) => resolve(pendingResolvedValue);

  return builder;
}

const mockGetUser = jest.fn().mockResolvedValue({
  data: { user: { id: 'user-dd-1' } },
});

const mockFrom = jest.fn((table: string) => createQueryBuilder(table));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    auth: {
      getUser: () => mockGetUser(),
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    })),
    removeChannel: jest.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// localDB mock — in-memory workouts + queue so we can simulate the full cycle.
// ---------------------------------------------------------------------------

interface FakeQueueItem {
  id: number;
  table_name: string;
  operation: 'upsert' | 'delete';
  record_id: string;
  data: string | null;
  created_at: string;
  retry_count: number;
  next_retry_at: string | null;
}

type LocalStore = {
  workouts: Map<string, Record<string, unknown>>;
  queue: FakeQueueItem[];
  nextQueueId: number;
};

(globalThis as unknown as { __ddSyncStore: LocalStore }).__ddSyncStore = {
  workouts: new Map(),
  queue: [],
  nextQueueId: 1,
};

function store(): LocalStore {
  return (globalThis as unknown as { __ddSyncStore: LocalStore }).__ddSyncStore;
}

jest.mock('@/lib/services/database/local-db', () => {
  const getStore = (): LocalStore =>
    (globalThis as unknown as { __ddSyncStore: LocalStore }).__ddSyncStore;

  const enqueue = (
    table: string,
    operation: 'upsert' | 'delete',
    record_id: string,
    data?: unknown,
  ) => {
    const s = getStore();
    s.queue.push({
      id: s.nextQueueId++,
      table_name: table,
      operation,
      record_id,
      data: data ? JSON.stringify(data) : null,
      created_at: new Date().toISOString(),
      retry_count: 0,
      next_retry_at: null,
    });
  };

  return {
    localDB: {
      // Writes
      insertWorkout: jest.fn(async (w: Record<string, unknown>) => {
        getStore().workouts.set(w.id as string, { ...w });
      }),
      updateWorkout: jest.fn(async (id: string, w: Record<string, unknown>) => {
        const existing = getStore().workouts.get(id) ?? {};
        getStore().workouts.set(id, { ...existing, ...w });
      }),
      hardDeleteWorkout: jest.fn(async (id: string) => {
        getStore().workouts.delete(id);
      }),
      // Queue
      getSyncQueue: jest.fn(async () => [...getStore().queue]),
      countSyncQueueItems: jest.fn(async () => getStore().queue.length),
      removeSyncQueueItem: jest.fn(async (id: number) => {
        const s = getStore();
        s.queue = s.queue.filter((q) => q.id !== id);
      }),
      incrementSyncQueueRetry: jest.fn(async () => {}),
      clearSyncQueue: jest.fn(async () => {
        getStore().queue = [];
      }),
      addToSyncQueue: jest.fn(async (
        table: string,
        operation: 'upsert' | 'delete',
        record_id: string,
        data: unknown,
      ) => {
        enqueue(table, operation, record_id, data);
      }),
      // Unsynced getters (not exercised but required to exist)
      getUnsyncedFoods: jest.fn(async () => []),
      getUnsyncedWorkouts: jest.fn(async () => []),
      getUnsyncedHealthMetrics: jest.fn(async () => []),
      getUnsyncedNutritionGoals: jest.fn(async () => []),
      updateFoodSyncStatus: jest.fn(async () => {}),
      updateWorkoutSyncStatus: jest.fn(async (id: string, synced: boolean) => {
        const existing = getStore().workouts.get(id);
        if (existing) {
          getStore().workouts.set(id, { ...existing, synced: synced ? 1 : 0 });
        }
      }),
      updateHealthMetricSyncStatus: jest.fn(async () => {}),
      updateNutritionGoalsSyncStatus: jest.fn(async () => {}),
      cleanupSyncedDeletes: jest.fn(async () => {}),
      hardDeleteFood: jest.fn(async () => {}),
      deleteHealthMetric: jest.fn(async () => {}),
      deleteNutritionGoals: jest.fn(async () => {}),
      // Record lookup (used by realtime conflict detection)
      getFoodById: jest.fn(async () => null),
      getWorkoutById: jest.fn(async (id: string) => {
        return getStore().workouts.get(id) ?? null;
      }),
      getHealthMetricById: jest.fn(async () => null),
      getNutritionGoalsById: jest.fn(async () => null),
      getAllFoodsWithDeleted: jest.fn(async () => []),
      getAllWorkoutsWithDeleted: jest.fn(async () => []),
      getNutritionGoals: jest.fn(async () => null),
      upsertNutritionGoals: jest.fn(async () => {}),
      insertHealthMetric: jest.fn(async () => {}),
      updateHealthMetric: jest.fn(async () => {}),
      insertFood: jest.fn(async () => {}),
      updateFood: jest.fn(async () => {}),
      withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    },
  };
});

jest.mock('@/lib/services/database/generic-sync', () => ({
  syncAllWorkoutTablesToSupabase: jest.fn().mockResolvedValue(undefined),
  downloadAllWorkoutTablesFromSupabase: jest.fn().mockResolvedValue(undefined),
  cleanupWorkoutSyncedDeletes: jest.fn().mockResolvedValue(undefined),
  WORKOUT_SYNC_CONFIGS: [],
  handleGenericRealtimeChange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn((domain: string, code: string, message: string) => ({
    domain,
    code,
    message,
    retryable: true,
    severity: 'error',
  })),
  logError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test — after all mocks are registered.
// ---------------------------------------------------------------------------

import { syncService } from '@/lib/services/database/sync-service';
import { localDB } from '@/lib/services/database/local-db';

type RealtimeHandler = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) => Promise<void> | void;

function resetSyncService() {
  (syncService as unknown as { syncPromise: unknown }).syncPromise = null;
  (syncService as unknown as { syncStatus: unknown }).syncStatus = {
    state: 'idle',
    queueSize: 0,
    lastError: null,
    lastErrorAt: null,
  };
}

function invokeRealtimeWorkoutChange(payload: Parameters<RealtimeHandler>[0]) {
  // handleRealtimeWorkoutChange is private; invoke via prototype to keep the
  // test a pure public-surface integration test as much as possible.
  const svc = syncService as unknown as { handleRealtimeWorkoutChange: RealtimeHandler };
  return svc.handleRealtimeWorkoutChange(payload);
}

describe('delete-then-undelete with concurrent remote update (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const s = store();
    s.workouts.clear();
    s.queue = [];
    s.nextQueueId = 1;
    supabaseCalls.length = 0;
    pendingResolvedValue = { data: null, error: null };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-dd-1' } } });
    mockFrom.mockImplementation((table: string) => createQueryBuilder(table));
    resetSyncService();
  });

  it('local restore wins on updated_at; realtime INSERT does not duplicate; queue drains to one upsert', async () => {
    const workoutId = 'workout-dd-1';
    const baseTs = '2026-04-20T10:00:00.000Z';
    const deleteTs = '2026-04-20T10:05:00.000Z';
    const restoreTs = '2026-04-20T10:10:00.000Z';

    // ---- Seed: a previously-synced workout exists locally ----
    await (localDB as unknown as {
      insertWorkout: (w: Record<string, unknown>) => Promise<void>;
    }).insertWorkout({
      id: workoutId,
      user_id: 'user-dd-1',
      exercise: 'squat',
      sets: 3,
      reps: 5,
      date: baseTs,
      synced: 1,
      deleted: 0,
      updated_at: baseTs,
    });
    expect(store().workouts.has(workoutId)).toBe(true);

    // ---- User soft-deletes locally: deleted=1, synced=0, enqueue DELETE ----
    await (localDB as unknown as {
      updateWorkout: (id: string, w: Record<string, unknown>) => Promise<void>;
    }).updateWorkout(workoutId, {
      deleted: 1,
      synced: 0,
      updated_at: deleteTs,
    });
    await (localDB as unknown as {
      addToSyncQueue: (
        t: string,
        op: 'upsert' | 'delete',
        rid: string,
        d: unknown,
      ) => Promise<void>;
    }).addToSyncQueue('workouts', 'delete', workoutId, { id: workoutId });

    expect(store().queue).toHaveLength(1);
    expect(store().queue[0].operation).toBe('delete');

    // ---- Sync drains queue -> server DELETE succeeds ----
    await syncService.syncToSupabase();

    expect(store().queue).toHaveLength(0);
    const deleteCall = supabaseCalls.find((c) => c.op === 'delete');
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.filter).toEqual({ column: 'id', value: workoutId });
    // Local row hard-deleted because of the DELETE sync path or left tombstoned;
    // our mock `syncToSupabase` path removes queue item only — the workout row
    // is still in the local map with deleted=1. That's fine for this scenario.

    // ---- User "undeletes" by restoring the row: deleted=0, synced=0, newer ts ----
    await (localDB as unknown as {
      updateWorkout: (id: string, w: Record<string, unknown>) => Promise<void>;
    }).updateWorkout(workoutId, {
      deleted: 0,
      synced: 0,
      updated_at: restoreTs,
    });
    await (localDB as unknown as {
      addToSyncQueue: (
        t: string,
        op: 'upsert' | 'delete',
        rid: string,
        d: unknown,
      ) => Promise<void>;
    }).addToSyncQueue('workouts', 'upsert', workoutId, {
      id: workoutId,
      user_id: 'user-dd-1',
      exercise: 'squat',
      sets: 3,
      reps: 5,
      date: baseTs,
      updated_at: restoreTs,
      synced: 0,
      deleted: 0,
    });

    expect(store().queue).toHaveLength(1);
    expect(store().queue[0].operation).toBe('upsert');

    // ---- Concurrently: realtime INSERT arrives from the server's replay
    // of the original pre-delete row (older ts). Since the local row has
    // synced=0 (unsaved local restore), the handler must skip the overwrite.
    await invokeRealtimeWorkoutChange({
      eventType: 'INSERT',
      new: {
        id: workoutId,
        user_id: 'user-dd-1',
        exercise: 'squat',
        sets: 3,
        reps: 5,
        date: baseTs,
        updated_at: baseTs, // older than the local restore
      },
      old: {},
    });

    // Local row must still reflect the restore (deleted=0, updated_at=restoreTs).
    const localAfterRealtime = store().workouts.get(workoutId)!;
    expect(localAfterRealtime.deleted).toBe(0);
    expect(localAfterRealtime.updated_at).toBe(restoreTs);
    expect(localAfterRealtime.synced).toBe(0); // still pending the restore upsert

    // Exactly one workout row in the local store (no duplicate from realtime).
    expect(store().workouts.size).toBe(1);

    // ---- Sync again: the pending upsert must drain cleanly ----
    await syncService.syncToSupabase();

    expect(store().queue).toHaveLength(0);
    const upsertCalls = supabaseCalls.filter((c) => c.op === 'upsert');
    expect(upsertCalls).toHaveLength(1);
    const upsertPayload = upsertCalls[0].payload as unknown[];
    const firstRow = upsertPayload[0] as Record<string, unknown>;
    expect(firstRow.id).toBe(workoutId);
    expect(firstRow.updated_at).toBe(restoreTs);
    // deleted/synced are local-only sentinels and stripped before upsert
    expect(firstRow.deleted).toBeUndefined();
    expect(firstRow.synced).toBeUndefined();
  });

  it('realtime DELETE that arrives after local undelete hard-deletes the row (server is authoritative on DELETE)', async () => {
    // WHY: this test documents the inverse of the primary scenario — when the
    // server DELETE reaches the client AFTER the user undeletes, the client's
    // handleRealtimeWorkoutChange currently calls hardDeleteWorkout unconditionally.
    // If the product expectation ever flips to "local restore wins over server
    // DELETE" this test catches the regression.
    const workoutId = 'workout-dd-2';
    const baseTs = '2026-04-20T10:00:00.000Z';
    const restoreTs = '2026-04-20T10:15:00.000Z';

    await (localDB as unknown as {
      insertWorkout: (w: Record<string, unknown>) => Promise<void>;
    }).insertWorkout({
      id: workoutId,
      user_id: 'user-dd-1',
      exercise: 'bench',
      sets: 3,
      reps: 8,
      date: baseTs,
      synced: 0, // pending restore
      deleted: 0,
      updated_at: restoreTs,
    });

    await invokeRealtimeWorkoutChange({
      eventType: 'DELETE',
      new: {},
      old: { id: workoutId },
    });

    expect(store().workouts.has(workoutId)).toBe(false);
  });
});
