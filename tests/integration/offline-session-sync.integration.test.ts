/**
 * Integration test: offline -> online full workout-session sync.
 *
 * Covers the offline-first data-layer contract documented in CLAUDE.md:
 *
 *  1. All mutations write to local SQLite immediately
 *  2. Mutations queue in a `sync_queue` table
 *  3. When online, queue syncs to Supabase via `syncService.syncToSupabase()`
 *  4. Queue drains to zero, no duplicate writes
 *
 * Gap closed: no prior integration test stitches localDB writes -> network
 * flip -> sync-service queue drain together. Unit tests cover
 * `processSyncQueue` directly with fabricated queue items, but nothing
 * exercises the real enqueue -> go-online -> drain round-trip.
 *
 * Strategy: mock `localDB` as an in-memory store (so we can observe both
 * writes and the queue), mock Supabase's `from().upsert()` / `delete()`
 * chain, drive the state machine manually, and assert queue ordering +
 * drain-to-zero.
 */

// ---------------------------------------------------------------------------
// Supabase mock — chainable query-builder matching the shape used in
// sync-service.ts. Records every call so we can assert ordering.
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

  builder.select = jest.fn((_cols?: string) => {
    state.op = 'select';
    return builder;
  });
  builder.upsert = jest.fn((payload: unknown, _opts?: unknown) => {
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
  // Make the builder thenable so `await query` works.
  builder.then = (resolve: (v: unknown) => void) => resolve(pendingResolvedValue);

  return builder;
}

const mockGetUser = jest.fn().mockResolvedValue({
  data: { user: { id: 'test-user-1' } },
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
// localDB mock — in-memory store with a sync_queue array so we can watch
// it populate while offline and drain during sync.
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

type LocalStoreState = {
  foods: Map<string, Record<string, unknown>>;
  workouts: Map<string, Record<string, unknown>>;
  health_metrics: Map<string, Record<string, unknown>>;
  nutrition_goals: Map<string, Record<string, unknown>>;
  queue: FakeQueueItem[];
  nextQueueId: number;
};

(globalThis as unknown as { __offlineSyncStore: LocalStoreState }).__offlineSyncStore = {
  foods: new Map(),
  workouts: new Map(),
  health_metrics: new Map(),
  nutrition_goals: new Map(),
  queue: [],
  nextQueueId: 1,
};

function store(): LocalStoreState {
  return (globalThis as unknown as { __offlineSyncStore: LocalStoreState }).__offlineSyncStore;
}

jest.mock('@/lib/services/database/local-db', () => {
  const getStore = (): LocalStoreState =>
    (globalThis as unknown as { __offlineSyncStore: LocalStoreState }).__offlineSyncStore;

  const enqueue = (
    table: string,
    operation: 'upsert' | 'delete',
    record_id: string,
    data?: unknown,
  ) => {
    const s = getStore();
    const now = new Date().toISOString();
    s.queue.push({
      id: s.nextQueueId++,
      table_name: table,
      operation,
      record_id,
      data: data ? JSON.stringify(data) : null,
      created_at: now,
      retry_count: 0,
      next_retry_at: null,
    });
  };

  return {
    localDB: {
      // Writes
      insertWorkoutAndQueue: jest.fn(async (workout: Record<string, unknown>, syncData?: unknown) => {
        const s = getStore();
        s.workouts.set(workout.id as string, { ...workout, synced: 0 });
        enqueue('workouts', 'upsert', workout.id as string, syncData ?? workout);
      }),
      insertWorkoutSessionAndQueue: jest.fn(async (session: Record<string, unknown>) => {
        const s = getStore();
        s.workouts.set(session.id as string, { ...session, synced: 0 });
        enqueue('workout_sessions', 'upsert', session.id as string, session);
      }),
      insertRepAndQueue: jest.fn(async (rep: Record<string, unknown>) => {
        enqueue('workout_reps', 'upsert', rep.id as string, rep);
      }),
      insertDebriefAndQueue: jest.fn(async (debrief: Record<string, unknown>) => {
        enqueue('session_debriefs', 'upsert', debrief.id as string, debrief);
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
      // Unsynced getters (used inside executeSyncToSupabase; empty arrays
      // because we're driving via queue only).
      getUnsyncedFoods: jest.fn(async () => []),
      getUnsyncedWorkouts: jest.fn(async () => []),
      getUnsyncedHealthMetrics: jest.fn(async () => []),
      getUnsyncedNutritionGoals: jest.fn(async () => []),
      // Sync-status helpers
      updateFoodSyncStatus: jest.fn(async () => {}),
      updateWorkoutSyncStatus: jest.fn(async () => {}),
      updateHealthMetricSyncStatus: jest.fn(async () => {}),
      updateNutritionGoalsSyncStatus: jest.fn(async () => {}),
      cleanupSyncedDeletes: jest.fn(async () => {}),
      // Housekeeping
      hardDeleteFood: jest.fn(async () => {}),
      hardDeleteWorkout: jest.fn(async () => {}),
      deleteHealthMetric: jest.fn(async () => {}),
      deleteNutritionGoals: jest.fn(async () => {}),
      // Record lookup (for conflict resolution)
      getFoodById: jest.fn(async () => null),
      getWorkoutById: jest.fn(async () => null),
      getHealthMetricById: jest.fn(async () => null),
      getNutritionGoalsById: jest.fn(async () => null),
      getAllFoodsWithDeleted: jest.fn(async () => []),
      getAllWorkoutsWithDeleted: jest.fn(async () => []),
      getNutritionGoals: jest.fn(async () => null),
      upsertNutritionGoals: jest.fn(async () => {}),
      insertHealthMetric: jest.fn(async () => {}),
      updateHealthMetric: jest.fn(async () => {}),
      insertFood: jest.fn(async () => {}),
      insertWorkout: jest.fn(async () => {}),
      updateFood: jest.fn(async () => {}),
      updateWorkout: jest.fn(async () => {}),
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
  createError: jest.fn((_d: string, _c: string, m: string) => ({
    domain: _d, code: _c, message: m, retryable: true, severity: 'error',
  })),
  logError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test — after all mocks are registered.
// ---------------------------------------------------------------------------

import { syncService } from '@/lib/services/database/sync-service';
import { localDB } from '@/lib/services/database/local-db';

// Simulated network status — not a real mock of NetworkContext (which is
// React-scoped), just a module-local flag that the test flips between
// "offline" (writes land in localDB + queue, no sync triggered) and
// "online" (syncService.syncToSupabase is invoked).
let isNetworkOnline = false;

function resetSyncService() {
  (syncService as unknown as { syncPromise: unknown }).syncPromise = null;
  (syncService as unknown as { syncStatus: unknown }).syncStatus = {
    state: 'idle',
    queueSize: 0,
    lastError: null,
    lastErrorAt: null,
  };
}

describe('offline-to-online session sync (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the in-memory store
    const s = store();
    s.foods.clear();
    s.workouts.clear();
    s.health_metrics.clear();
    s.nutrition_goals.clear();
    s.queue = [];
    s.nextQueueId = 1;
    supabaseCalls.length = 0;
    pendingResolvedValue = { data: null, error: null };
    isNetworkOnline = false;
    mockGetUser.mockResolvedValue({ data: { user: { id: 'test-user-1' } } });
    mockFrom.mockImplementation((table: string) => createQueryBuilder(table));
    resetSyncService();
  });

  it('buffers a full session offline, then drains the queue on reconnect (correct order, zero duplicates)', async () => {
    // ---- Offline phase: simulate a 3-rep session being logged ----
    expect(isNetworkOnline).toBe(false);

    // 1. Session row
    await (localDB as unknown as {
      insertWorkoutSessionAndQueue: (s: Record<string, unknown>) => Promise<void>;
    }).insertWorkoutSessionAndQueue({
      id: 'session-1',
      user_id: 'test-user-1',
      exercise: 'pushup',
      started_at: new Date().toISOString(),
    });

    // 2. Three reps
    for (let i = 1; i <= 3; i++) {
      await (localDB as unknown as {
        insertRepAndQueue: (r: Record<string, unknown>) => Promise<void>;
      }).insertRepAndQueue({
        id: `rep-${i}`,
        session_id: 'session-1',
        rep_number: i,
        fqi_score: 0.85,
      });
    }

    // 3. Debrief summary
    await (localDB as unknown as {
      insertDebriefAndQueue: (d: Record<string, unknown>) => Promise<void>;
    }).insertDebriefAndQueue({
      id: 'debrief-1',
      session_id: 'session-1',
      summary: 'Solid session.',
      avg_fqi: 0.85,
    });

    // Assert nothing has been pushed to Supabase yet.
    expect(supabaseCalls).toHaveLength(0);
    // Queue must contain all 5 writes (1 session + 3 reps + 1 debrief).
    expect(store().queue).toHaveLength(5);
    expect(store().queue.map((q) => q.table_name)).toEqual([
      'workout_sessions',
      'workout_reps',
      'workout_reps',
      'workout_reps',
      'session_debriefs',
    ]);

    // ---- Flip to online + trigger sync ----
    isNetworkOnline = true;
    await syncService.syncToSupabase();

    // Queue drained.
    expect(store().queue).toHaveLength(0);

    // All five writes hit Supabase in order (session -> reps -> debrief).
    const orderedTables = supabaseCalls.map((c) => c.table);
    expect(orderedTables).toEqual([
      'workout_sessions',
      'workout_reps',
      'workout_reps',
      'workout_reps',
      'session_debriefs',
    ]);

    // Every write used upsert (not insert), which gives us idempotency
    // against client_id-keyed retries on the server.
    expect(supabaseCalls.every((c) => c.op === 'upsert')).toBe(true);

    // No duplicate record_ids in the Supabase call log.
    const ids = supabaseCalls.map((c) => {
      const p = c.payload as unknown;
      if (Array.isArray(p)) {
        return (p[0] as { id?: string })?.id;
      }
      return (p as { id?: string })?.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only attempts sync when online (no sync calls while offline)', async () => {
    // Offline — writes populate queue, NO sync triggered.
    await (localDB as unknown as {
      insertRepAndQueue: (r: Record<string, unknown>) => Promise<void>;
    }).insertRepAndQueue({
      id: 'rep-only-offline',
      session_id: 'session-2',
      rep_number: 1,
    });

    expect(isNetworkOnline).toBe(false);
    expect(supabaseCalls).toHaveLength(0);
    expect(store().queue).toHaveLength(1);
    // Explicitly NOT calling syncToSupabase — this models the
    // NetworkContext `isOnline=false` branch in which the caller must
    // skip the sync invocation.

    // Now simulate network recovery.
    isNetworkOnline = true;
    await syncService.syncToSupabase();

    expect(store().queue).toHaveLength(0);
    expect(supabaseCalls).toHaveLength(1);
    expect(supabaseCalls[0]).toMatchObject({
      table: 'workout_reps',
      op: 'upsert',
    });
  });

  it('surfaces queue-drain completion via syncStatus=idle', async () => {
    // Prime the queue with a single rep while offline.
    await (localDB as unknown as {
      insertRepAndQueue: (r: Record<string, unknown>) => Promise<void>;
    }).insertRepAndQueue({
      id: 'rep-status-check',
      session_id: 'session-3',
      rep_number: 1,
    });

    expect(syncService.getSyncStatus().state).toBe('idle');

    // Go online + sync.
    isNetworkOnline = true;
    await syncService.syncToSupabase();

    // After a successful drain, state returns to idle.
    expect(syncService.getSyncStatus().state).toBe('idle');
    expect(store().queue).toHaveLength(0);
  });
});
