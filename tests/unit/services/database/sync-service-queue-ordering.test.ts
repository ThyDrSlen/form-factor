/**
 * @jest-environment node
 *
 * sync-service queue ordering + rollback regression tests (Issue #430 Gap 7).
 *
 * Targets `SyncService.processSyncQueue` (private). Covers the 6 cases
 * from the issue:
 *   1. Create \u2192 edit \u2192 delete same record: only DELETE reaches Supabase
 *      (older upserts dedupe'd by removeStaleQueueDuplicates)
 *   2. Create \u2192 edit: upsert payload contains LATEST data
 *   3. Interleaved tables (foods[A], workouts[B], foods[A]) preserve order
 *   4. Mid-queue RLS failure: item retained, item 1+3 still process
 *   5. Max-retries mid-queue: item at retry_count=5 retried without blocking
 *   6. Clock drift: minRetryDelayMs floor (30_000ms) holds regardless of
 *      backward Date.now() jump
 */

// ---------------------------------------------------------------------------
// Mocks — localDB + supabase + logger + ErrorHandler
// ---------------------------------------------------------------------------

type SyncOp = 'upsert' | 'delete';
type LegacyRow = LocalFood | LocalWorkout;

interface FakeQueueItem {
  id: number;
  table_name: string;
  operation: SyncOp;
  record_id: string;
  data: string | null;
  created_at: string;
  retry_count: number;
  next_retry_at: string | null;
}

// All mutable state lives on globalThis so jest.mock factories (which are hoisted
// above `let` declarations) can reference them safely.
type TestState = {
  fakeQueue: FakeQueueItem[];
  persistedRows: Map<string, LegacyRow>;
  removedIds: number[];
  retryIncrements: Array<{ id: number; nextRetryAt: string }>;
  transactionCalls: number;
  reconciliationCalls: Array<{ table: string; incoming: LegacyRow; expected: LegacyRow; isCurrent?: () => boolean }>;
  updateSyncStatusCalls: Array<{ fn: string; id: string; synced: boolean; captured?: Partial<LegacyRow> }>;
  hardDeleteCalls: Array<{ fn: string; id: string }>;
  supabaseCalls: Array<{ table: string; op: string; payload?: unknown; eqId?: string }>;
  nextSupabaseError: { table?: string; op?: string; code?: string; message?: string } | null;
  nextSupabaseErrorOnce: boolean;
};

(globalThis as unknown as { __syncTest: TestState }).__syncTest = {
  fakeQueue: [],
  persistedRows: new Map(),
  removedIds: [],
  retryIncrements: [],
  transactionCalls: 0,
  reconciliationCalls: [],
  updateSyncStatusCalls: [],
  hardDeleteCalls: [],
  supabaseCalls: [],
  nextSupabaseError: null,
  nextSupabaseErrorOnce: false,
};

jest.mock('@/lib/services/database/local-db', () => {
  const getState = () =>
    (globalThis as unknown as { __syncTest: TestState }).__syncTest;
  const getRow = async (table: string, id: string) => {
    const current = getState().persistedRows.get(`${table}:${id}`);
    return current ? { ...current } : null;
  };
  const reconcile = async (table: string, incoming: LegacyRow, expected: LegacyRow, isCurrent?: () => boolean) => {
    const s = getState();
    s.reconciliationCalls.push({ table, incoming, expected, isCurrent });
    const current = s.persistedRows.get(`${table}:${expected.id}`);
    if (!current || incoming.id !== expected.id || (isCurrent && !isCurrent()) ||
        !Object.entries(expected).every(([key, value]) => Reflect.get(current, key) === value)) return false;
    s.persistedRows.set(`${table}:${expected.id}`, { ...incoming, synced: 1 });
    return true;
  };
  return {
    localDB: {
      db: {
        getAllAsync: jest.fn().mockResolvedValue([]), runAsync: jest.fn().mockResolvedValue(undefined),
        async prepareAsync(sql: string) {
          const db = this;
          return {
            executeAsync: async (args: unknown[]) => db.runAsync(sql, args),
            finalizeAsync: async () => {},
          };
        },
      },
      getSyncQueue: jest.fn(async () => [...getState().fakeQueue]),
      getFoodById: jest.fn((id: string) => getRow('foods', id)),
      getWorkoutById: jest.fn((id: string) => getRow('workouts', id)),
      removeSyncQueueItem: jest.fn(async (id: number) => {
        const s = getState();
        s.removedIds.push(id);
        s.fakeQueue = s.fakeQueue.filter((q) => q.id !== id);
      }),
      incrementSyncQueueRetry: jest.fn(async (id: number, nextRetryAt: string) => {
        const s = getState();
        s.retryIncrements.push({ id, nextRetryAt });
        s.fakeQueue = s.fakeQueue.map(item => item.id === id
          ? { ...item, retry_count: item.retry_count + 1, next_retry_at: nextRetryAt } : item);
      }),
      countSyncQueueItems: jest.fn(async () => getState().fakeQueue.length),
      withTransaction: jest.fn(async (fn: () => Promise<void>) => {
        const s = getState();
        s.transactionCalls += 1;
        const rowsBefore = new Map(s.persistedRows);
        const queueBefore = [...s.fakeQueue];
        const removedBefore = [...s.removedIds];
        try {
          await fn();
        } catch (error) {
          s.persistedRows = rowsBefore;
          s.fakeQueue = queueBefore;
          s.removedIds = removedBefore;
          throw error;
        }
      }),
      reconcileFood: jest.fn((incoming: LocalFood, expected: LocalFood, isCurrent?: () => boolean) => reconcile('foods', incoming, expected, isCurrent)),
      reconcileWorkout: jest.fn((incoming: LocalWorkout, expected: LocalWorkout, isCurrent?: () => boolean) => reconcile('workouts', incoming, expected, isCurrent)),
      updateHealthMetricSyncStatus: jest.fn(async (id: string, synced: boolean) => {
        getState().updateSyncStatusCalls.push({ fn: 'health_metrics', id, synced });
      }),
      updateNutritionGoalsSyncStatus: jest.fn(async (id: string, synced: boolean) => {
        getState().updateSyncStatusCalls.push({ fn: 'nutrition_goals', id, synced });
      }),
      hardDeleteFood: jest.fn(async (id: string) => {
        getState().hardDeleteCalls.push({ fn: 'foods', id });
      }),
      hardDeleteWorkout: jest.fn(async (id: string) => {
        getState().hardDeleteCalls.push({ fn: 'workouts', id });
      }),
      deleteHealthMetric: jest.fn(async () => undefined),
      deleteNutritionGoals: jest.fn(async () => undefined),
      cleanupSyncedDeletes: jest.fn(async () => undefined),
    },
  };
});

jest.mock('@/lib/supabase', () => {
  const getSupaState = () =>
    (globalThis as unknown as { __syncTest: Record<string, unknown> }).__syncTest as {
      supabaseCalls: Array<{ table: string; op: string; payload?: unknown; eqId?: string }>;
      nextSupabaseError: { table?: string; op?: string; code?: string; message?: string } | null;
      nextSupabaseErrorOnce: boolean;
    };
  const maybeError = (table: string, op: string): { error: unknown | null } => {
    const s = getSupaState();
    const err = s.nextSupabaseError;
    if (err && (!err.table || err.table === table) && (!err.op || err.op === op)) {
      const resolved = { code: err.code, message: err.message ?? 'err' };
      if (s.nextSupabaseErrorOnce) {
        s.nextSupabaseError = null;
        s.nextSupabaseErrorOnce = false;
      }
      return { error: resolved };
    }
    return { error: null };
  };
  return {
    supabase: {
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
      },
      from: (table: string) => ({
        select: () => {
          const query = {
            eq: () => query,
            single: async () => ({ data: null, error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
          };
          return query;
        },
        delete: () => {
          let eqId: string | undefined;
          const query = {
            eq: (key: string, value: string) => {
              if (key === 'id') eqId = value;
              return query;
            },
            then: (resolve: (result: { error: unknown }) => unknown) => {
              getSupaState().supabaseCalls.push({ table, op: 'delete', eqId });
              return Promise.resolve(maybeError(table, 'delete')).then(resolve);
            },
          };
          return query;
        },
        upsert: (payload: unknown, _opts?: unknown) => {
          getSupaState().supabaseCalls.push({ table, op: 'upsert', payload });
          return Promise.resolve(maybeError(table, 'upsert'));
        },
      }),
    },
  };
});

// Short alias to access mutable state in tests.
const state = (globalThis as unknown as { __syncTest: TestState }).__syncTest;

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn(() => ({ domain: 'sync', code: 'test' })),
  logError: jest.fn(),
}));

jest.mock('@/lib/services/database/generic-sync', () => ({
  syncAllWorkoutTablesToSupabase: jest.fn(async () => undefined),
  downloadAllWorkoutTablesFromSupabase: jest.fn(async () => undefined),
  cleanupWorkoutSyncedDeletes: jest.fn(async () => undefined),
  WORKOUT_SYNC_CONFIGS: jest.requireActual('@/lib/services/database/generic-sync').WORKOUT_SYNC_CONFIGS,
  genericGetById: jest.requireActual('@/lib/services/database/generic-sync').genericGetById,
  syncWorkoutRowToSupabase: jest.requireActual('@/lib/services/database/generic-sync').syncWorkoutRowToSupabase,
  handleGenericRealtimeChange: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import-under-test (after mocks)
// ---------------------------------------------------------------------------

import { syncService } from '@/lib/services/database/sync-service';
import { localDB } from '@/lib/services/database/local-db';
import type { LocalFood, LocalWorkout } from '@/lib/services/database/local-db';

type SyncServiceInternals = {
  processSyncQueue: () => Promise<boolean>;
  minRetryDelayMs: number;
  getNextRetryIso: (item: FakeQueueItem) => string;
};

function internals(): SyncServiceInternals {
  return syncService as unknown as SyncServiceInternals;
}

function enqueue(items: FakeQueueItem[]): void {
  state.fakeQueue = items;
}

const revision = '2026-04-16T12:00:00.000Z';
function persistFood(id: string, overrides: Partial<LocalFood> = {}): LocalFood {
  const row: LocalFood = { id, name: 'apple', calories: 95, date: revision, updated_at: revision, synced: 0, deleted: 0, ...overrides };
  state.persistedRows.set(`foods:${id}`, row);
  return row;
}
function persistWorkout(id: string, overrides: Partial<LocalWorkout> = {}): LocalWorkout {
  const row: LocalWorkout = { id, exercise: 'squat', sets: 3, reps: 10, date: revision, updated_at: revision, synced: 0, deleted: 0, ...overrides };
  state.persistedRows.set(`workouts:${id}`, row);
  return row;
}

/** Model only this persisted row and its session owner, never queued ownership. */
function persistOwnedSessionRow(table: string, row: Record<string, unknown>, userId: string): void {
  const ownerQueries: Record<string, string> = {
    workout_sessions: 'SELECT ws.user_id FROM workout_sessions ws WHERE ws.id = ?',
    workout_session_exercises: 'SELECT ws.user_id FROM workout_session_exercises child JOIN workout_sessions ws ON ws.id = child.session_id WHERE child.id = ?',
    workout_session_sets: 'SELECT ws.user_id FROM workout_session_sets child JOIN workout_session_exercises ex ON ex.id = child.session_exercise_id JOIN workout_sessions ws ON ws.id = ex.session_id WHERE child.id = ?',
    workout_session_events: 'SELECT ws.user_id FROM workout_session_events child JOIN workout_sessions ws ON ws.id = child.session_id WHERE child.id = ?',
  };
  if (!ownerQueries[table]) return;
  (localDB.db!.getAllAsync as jest.Mock).mockImplementation(async (sql: string, params?: string[]) => {
    if (params?.length !== 1 || params[0] !== row.id) return [];
    if (sql === `SELECT * FROM ${table} WHERE id = ?`) {
      return [table === 'workout_sessions' ? { ...row, user_id: userId } : row];
    }
    if (sql === ownerQueries[table]) return [{ user_id: userId }];
    return [];
  });
}

function mkItem(partial: Partial<FakeQueueItem> & Pick<FakeQueueItem, 'id' | 'table_name' | 'operation' | 'record_id'>): FakeQueueItem {
  return {
    data: null,
    created_at: '2026-04-16T00:00:00.000Z',
    retry_count: 0,
    next_retry_at: null,
    ...partial,
  };
}

function clearState(): void {
  state.fakeQueue = [];
  state.persistedRows.clear();
  state.removedIds = [];
  state.retryIncrements = [];
  state.transactionCalls = 0;
  state.reconciliationCalls = [];
  state.supabaseCalls.length = 0;
  state.updateSyncStatusCalls.length = 0;
  state.hardDeleteCalls.length = 0;
  state.nextSupabaseError = null;
  state.nextSupabaseErrorOnce = false;
  jest.clearAllMocks();
  (localDB.db!.getAllAsync as jest.Mock).mockReset().mockResolvedValue([]);
}

describe('sync-service queue ordering + rollback (Gap 7)', () => {
  beforeEach(clearState);

  test('case 1: create \u2192 edit \u2192 delete same record \u2192 only DELETE reaches Supabase', async () => {
    // 3 queue items for workouts:A in chronological order — dedup keeps the
    // highest id (the DELETE at id=3); upsert items 1 and 2 are purged.
    const current = persistWorkout('A', { sets: 5, deleted: 1 });
    enqueue([
      mkItem({ id: 1, table_name: 'workouts', operation: 'upsert', record_id: 'A', data: JSON.stringify({ id: 'A', user_id: 'user-1', exercise: 'squat', sets: 3 }) }),
      mkItem({ id: 2, table_name: 'workouts', operation: 'upsert', record_id: 'A', data: JSON.stringify({ id: 'A', user_id: 'user-1', exercise: 'squat', sets: 5 }) }),
      mkItem({ id: 3, table_name: 'workouts', operation: 'delete', record_id: 'A' }),
    ]);

    await internals().processSyncQueue();
    // Only one Supabase op — DELETE.
    const ops = state.supabaseCalls.filter((c) => c.table === 'workouts');
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('delete');
    expect(ops[0].eqId).toBe('A');
    // Stale duplicates (ids 1 + 2) were purged via removeSyncQueueItem.
    expect(state.removedIds).toContain(1);
    expect(state.removedIds).toContain(2);
    // And the delete item itself was also removed after success.
    expect(state.removedIds).toContain(3);
    expect(state.reconciliationCalls).toEqual([{ table: 'workouts', incoming: current, expected: current, isCurrent: expect.any(Function) }]);
    expect(await localDB.getWorkoutById('A')).toEqual({ ...current, synced: 1 });
    expect(state.fakeQueue).toEqual([]);
  });

  test('case 2: create \u2192 edit \u2192 UPSERT payload carries the LATEST data', async () => {
    const current = persistWorkout('B', { sets: 7 });
    enqueue([
      mkItem({ id: 1, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat', sets: 3 }) }),
      mkItem({ id: 2, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat', sets: 5 }) }),
    ]);

    await internals().processSyncQueue();

    const upserts = state.supabaseCalls.filter((c) => c.op === 'upsert' && c.table === 'workouts');
    expect(upserts).toHaveLength(1);
    const payload = (upserts[0].payload as Array<Record<string, unknown>>)[0];
    // A later persisted edit wins even over the newest queue snapshot (sets: 5).
    expect(payload.sets).toBe(7);
    expect(payload.updated_at).toBe(current.updated_at);
    expect(payload).not.toHaveProperty('synced');
    expect(payload).not.toHaveProperty('deleted');
    // Stale item 1 was purged before processing.
    expect(state.removedIds).toContain(1);
    expect(state.removedIds).toContain(2);
    expect(state.reconciliationCalls).toEqual([{ table: 'workouts', incoming: current, expected: current, isCurrent: expect.any(Function) }]);
    expect(await localDB.getWorkoutById('B')).toEqual({ ...current, synced: 1 });
  });

  test('case 3: interleaved tables (foods[A], workouts[B], foods[A]) preserve correct final payload', async () => {
    persistFood('A');
    persistWorkout('B');
    enqueue([
      mkItem({ id: 1, table_name: 'foods', operation: 'upsert', record_id: 'A', data: JSON.stringify({ id: 'A', name: 'apple', calories: 50 }) }),
      mkItem({ id: 2, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat', sets: 3 }) }),
      mkItem({ id: 3, table_name: 'foods', operation: 'upsert', record_id: 'A', data: JSON.stringify({ id: 'A', name: 'apple', calories: 95 }) }),
    ]);

    await internals().processSyncQueue();

    // Exactly 2 upserts — one for foods:A (latest, calories 95) and one for workouts:B.
    const foodUpserts = state.supabaseCalls.filter((c) => c.table === 'foods' && c.op === 'upsert');
    const workoutUpserts = state.supabaseCalls.filter((c) => c.table === 'workouts' && c.op === 'upsert');
    expect(foodUpserts).toHaveLength(1);
    expect(workoutUpserts).toHaveLength(1);
    const foodPayload = (foodUpserts[0].payload as Array<Record<string, unknown>>)[0];
    expect(foodPayload.calories).toBe(95);
    expect(state.supabaseCalls.map(call => call.table)).toEqual(['workouts', 'foods']);
    expect(state.removedIds).toEqual([1, 2, 3]);
    expect(state.fakeQueue).toEqual([]);
  });

  test('case 4: mid-queue RLS failure retains item 2, items 1 + 3 still process', async () => {
    persistFood('A', { name: 'a' });
    const current = persistWorkout('B');
    persistFood('C', { name: 'c' });
    enqueue([
      mkItem({ id: 1, table_name: 'foods', operation: 'upsert', record_id: 'A', data: JSON.stringify({ id: 'A', name: 'a' }) }),
      mkItem({ id: 2, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat' }) }),
      mkItem({ id: 3, table_name: 'foods', operation: 'upsert', record_id: 'C', data: JSON.stringify({ id: 'C', name: 'c' }) }),
    ]);
    // Error the workouts upsert with RLS code 42501.
    state.nextSupabaseError = { table: 'workouts', op: 'upsert', code: '42501', message: 'rls' };

    expect(await internals().processSyncQueue()).toBe(true);

    // foods:A and foods:C upserts succeeded.
    const foodCalls = state.supabaseCalls.filter((c) => c.table === 'foods' && c.op === 'upsert');
    expect(foodCalls).toHaveLength(2);
    // A permission error must not erase the workout or its retry.
    expect(state.removedIds).not.toContain(2);
    expect(state.hardDeleteCalls).toEqual([]);
    expect(state.retryIncrements).toHaveLength(1);
    expect(state.retryIncrements[0]).toEqual({ id: 2, nextRetryAt: expect.any(String) });
    expect(state.supabaseCalls.map(call => call.table)).toEqual(['foods', 'workouts', 'foods']);
    expect(syncService.getSyncStatus().lastError).toBe('rls');
    expect(await localDB.getWorkoutById('B')).toEqual(current);
    expect(state.fakeQueue).toEqual([expect.objectContaining({ id: 2, retry_count: 1, next_retry_at: expect.any(String) })]);
    // Items 1 + 3 also removed after success.
    expect(state.removedIds).toContain(1);
    expect(state.removedIds).toContain(3);
  });

  test('case 5: max-retries mid-queue does NOT block later items (item 2 at retry=5 retries, item 3 processes)', async () => {
    persistFood('A', { name: 'a' });
    persistWorkout('B');
    persistFood('C', { name: 'c' });
    enqueue([
      mkItem({ id: 1, table_name: 'foods', operation: 'upsert', record_id: 'A', data: JSON.stringify({ id: 'A', name: 'a' }) }),
      mkItem({ id: 2, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat' }), retry_count: 5 }),
      mkItem({ id: 3, table_name: 'foods', operation: 'upsert', record_id: 'C', data: JSON.stringify({ id: 'C', name: 'c' }) }),
    ]);

    await internals().processSyncQueue();

    // Previously failed data gets another chance after the backoff expires.
    expect(state.removedIds).toContain(2);
    const workoutCalls = state.supabaseCalls.filter((c) => c.table === 'workouts');
    expect(workoutCalls).toHaveLength(1);
    // Items 1 + 3 both reached Supabase.
    const foodCalls = state.supabaseCalls.filter((c) => c.table === 'foods' && c.op === 'upsert');
    expect(foodCalls).toHaveLength(2);
    expect(state.supabaseCalls.map(call => call.table)).toEqual(['foods', 'workouts', 'foods']);
    expect(state.removedIds).toEqual([1, 2, 3]);
    expect(state.fakeQueue).toEqual([]);
  });

  test.each(['foods', 'workouts'] as const)('%s CAS miss retains a same-timestamp edit and its exact retry', async table => {
    const current = table === 'foods' ? persistFood('A') : persistWorkout('A');
    const edited = table === 'foods' ? { ...current, calories: 200 } : { ...current, reps: 20 };
    const queued = mkItem({ id: 1, table_name: table, operation: 'upsert', record_id: 'A', data: JSON.stringify(current) });
    enqueue([queued]);
    const transaction = jest.mocked(localDB.withTransaction).getMockImplementation()!;
    jest.mocked(localDB.withTransaction).mockImplementationOnce(async task => {
      // An edit lands after network success but before the atomic local CAS.
      state.persistedRows.set(`${table}:A`, edited);
      return transaction(task);
    });

    expect(await internals().processSyncQueue()).toBe(false);

    expect(state.supabaseCalls).toEqual([expect.objectContaining({ table, op: 'upsert' })]);
    const reconcile = table === 'foods' ? localDB.reconcileFood : localDB.reconcileWorkout;
    await expect(jest.mocked(reconcile).mock.results[0].value).resolves.toBe(false);
    expect(state.reconciliationCalls).toEqual([{ table, incoming: current, expected: current, isCurrent: expect.any(Function) }]);
    expect(state.persistedRows.get(`${table}:A`)).toEqual(edited);
    expect(state.fakeQueue).toEqual([queued]);
    expect(state.removedIds).toEqual([]);
    expect(state.retryIncrements).toEqual([]);
  });

  test('queue removal failure rolls back the captured acknowledgement and retains a dirty retry', async () => {
    const current = persistFood('A');
    const queued = mkItem({ id: 1, table_name: 'foods', operation: 'upsert', record_id: 'A', data: JSON.stringify(current) });
    enqueue([queued]);
    jest.mocked(localDB.removeSyncQueueItem).mockRejectedValueOnce(new Error('queue removal failed'));

    expect(await internals().processSyncQueue()).toBe(true);

    expect(state.supabaseCalls).toEqual([expect.objectContaining({ table: 'foods', op: 'upsert' })]);
    expect(state.transactionCalls).toBe(1);
    expect(state.reconciliationCalls).toEqual([{ table: 'foods', incoming: current, expected: current, isCurrent: expect.any(Function) }]);
    expect(await localDB.getFoodById('A')).toEqual(current);
    expect(state.removedIds).toEqual([]);
    expect(state.fakeQueue).toEqual([{ ...queued, retry_count: 1, next_retry_at: expect.any(String) }]);
    expect(syncService.getSyncStatus().lastError).toBe('queue removal failed');
  });

  test('case 6: clock-drift minRetryDelayMs floor prevents infinite loop on backward Date.now jump', async () => {
    // minRetryDelayMs = 30_000. For retry_count=0 the naive backoff is 1_000ms,
    // so getNextRetryIso must return at least Date.now() + 30_000ms.
    const originalNow = Date.now;
    const frozenNow = 1_700_000_000_000;
    Date.now = () => frozenNow;
    try {
      const item = mkItem({
        id: 99,
        table_name: 'foods',
        operation: 'upsert',
        record_id: 'Z',
        retry_count: 0,
      });
      const iso = internals().getNextRetryIso(item);
      const parsed = new Date(iso).getTime();
      expect(parsed - frozenNow).toBeGreaterThanOrEqual(30_000);
      expect(internals().minRetryDelayMs).toBe(30_000);
    } finally {
      Date.now = originalNow;
    }
  });
});


describe('queued workout schema serialization', () => {
  beforeEach(clearState);

  test.each([
    ['exercises', { name: 'Pull-up', created_by: 'user-1', is_system: false }],
    ['workout_template_exercises', { template_id: 'template-1', exercise_id: 'exercise-1' }],
    ['workout_template_sets', { template_exercise_id: 'exercise-1', target_reps: 8 }],
    ['workout_session_exercises', { session_id: 'session-1', exercise_id: 'exercise-1' }],
    ['workout_session_sets', { session_exercise_id: 'exercise-1', actual_reps: 8 }],
  ])('%s uploads only its remote columns', async (table, fields) => {
    persistOwnedSessionRow(table, { id: 'row-1', ...fields, synced: 0, deleted: 0, local_extra: 'ignore' }, 'user-1');
    enqueue([mkItem({ id: 1, table_name: table, operation: 'upsert', record_id: 'row-1',
      data: JSON.stringify({ id: 'row-1', ...fields, synced: 0, deleted: 0, local_extra: 'ignore' }) })]);
    expect(await internals().processSyncQueue()).toBe(false);
    expect(state.supabaseCalls[0].payload).toEqual([{ id: 'row-1', ...fields }]);
  });

  test.each(['workout_templates', 'workout_sessions'])('%s includes the authenticated owner', async (table) => {
    persistOwnedSessionRow(table, { id: 'row-1', name: 'Strength', synced: 0 }, 'user-1');
    enqueue([mkItem({ id: 1, table_name: table, operation: 'upsert', record_id: 'row-1', data: JSON.stringify({ id: 'row-1', name: 'Strength' }) })]);
    await internals().processSyncQueue();
    expect(state.supabaseCalls[0].payload).toEqual([{ id: 'row-1', name: 'Strength', user_id: 'user-1' }]);
  });

  test('events decode local JSON and omit unsupported updated_at and user_id', async () => {
    persistOwnedSessionRow('workout_session_events', {
      id: 'event-1', session_id: 'session-1', payload: '{"reps":4}', created_at: '2026-09-18', updated_at: '2026-09-18',
    }, 'user-1');
    enqueue([mkItem({ id: 1, table_name: 'workout_session_events', operation: 'upsert', record_id: 'event-1',
      data: JSON.stringify({ id: 'event-1', session_id: 'session-1', payload: '{"reps":4}', created_at: '2026-09-18', updated_at: '2026-09-18' }) })]);
    await internals().processSyncQueue();
    expect(state.supabaseCalls[0].payload).toEqual([{ id: 'event-1', session_id: 'session-1', payload: { reps: 4 }, created_at: '2026-09-18' }]);
  });

  test('schema failures retain queued data even after five attempts', async () => {
    enqueue([mkItem({ id: 1, table_name: 'exercises', operation: 'upsert', record_id: 'row-1', retry_count: 5, data: JSON.stringify({ id: 'row-1', name: 'Pull-up' }) })]);
    state.nextSupabaseError = { code: 'PGRST204', message: 'Missing column in schema cache' };
    expect(await internals().processSyncQueue()).toBe(true);
    expect(state.removedIds).toEqual([]);
    expect(state.fakeQueue).toHaveLength(1);
    expect(state.retryIncrements).toHaveLength(1);
    expect(syncService.getSyncStatus().lastError).toBe('Missing column in schema cache');
  });
});


describe('queued workout freshness', () => {
  beforeEach(clearState);
  test('does not replay a snapshot after the current row was already synced', async () => {
    persistOwnedSessionRow('workout_sessions', { id: 'row-1', synced: 1, name: 'Latest' }, 'user-1');
    enqueue([mkItem({ id: 1, table_name: 'workout_sessions', operation: 'upsert', record_id: 'row-1', data: JSON.stringify({ id: 'row-1', name: 'Stale' }) })]);
    await internals().processSyncQueue();
    expect(state.supabaseCalls).toEqual([]);
    expect(state.removedIds).toEqual([1]);
  });
  test('uploads the current local edit instead of a stale queued snapshot', async () => {
    persistOwnedSessionRow('workout_sessions', { id: 'row-1', synced: 0, name: 'Latest' }, 'user-1');
    enqueue([mkItem({ id: 1, table_name: 'workout_sessions', operation: 'upsert', record_id: 'row-1', data: JSON.stringify({ id: 'row-1', name: 'Stale' }) })]);
    await internals().processSyncQueue();
    expect(state.supabaseCalls[0].payload).toEqual([{ id: 'row-1', name: 'Latest', user_id: 'user-1' }]);
  });
});
