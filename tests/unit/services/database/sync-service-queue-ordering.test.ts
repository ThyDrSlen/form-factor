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
 *   4. Mid-queue RLS failure: item purged, item 1+3 still process
 *   5. Max-retries mid-queue: item at retry_count=5 removed without blocking
 *   6. Clock drift: minRetryDelayMs floor (30_000ms) holds regardless of
 *      backward Date.now() jump
 */

// ---------------------------------------------------------------------------
// Mocks — localDB + supabase + logger + ErrorHandler
// ---------------------------------------------------------------------------

type SyncOp = 'upsert' | 'delete';

interface FakeQueueItem {
  id: number;
  table_name: 'foods' | 'workouts' | 'health_metrics' | 'nutrition_goals';
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
  removedIds: number[];
  retryIncrements: Array<{ id: number; nextRetryAt: string }>;
  transactionCalls: number;
  updateSyncStatusCalls: Array<{ fn: string; id: string; synced: boolean }>;
  hardDeleteCalls: Array<{ fn: string; id: string }>;
  supabaseCalls: Array<{ table: string; op: string; payload?: unknown; eqId?: string }>;
  nextSupabaseError: { table?: string; op?: string; code?: string; message?: string } | null;
  nextSupabaseErrorOnce: boolean;
};

(globalThis as unknown as { __syncTest: TestState }).__syncTest = {
  fakeQueue: [],
  removedIds: [],
  retryIncrements: [],
  transactionCalls: 0,
  updateSyncStatusCalls: [],
  hardDeleteCalls: [],
  supabaseCalls: [],
  nextSupabaseError: null,
  nextSupabaseErrorOnce: false,
};

jest.mock('@/lib/services/database/local-db', () => {
  const getState = () =>
    (globalThis as unknown as { __syncTest: Record<string, unknown> }).__syncTest as {
      fakeQueue: Array<{ id: number }>;
      removedIds: number[];
      retryIncrements: Array<{ id: number; nextRetryAt: string }>;
      transactionCalls: number;
      updateSyncStatusCalls: Array<{ fn: string; id: string; synced: boolean }>;
      hardDeleteCalls: Array<{ fn: string; id: string }>;
    };
  return {
    localDB: {
      getSyncQueue: jest.fn(async () => [...getState().fakeQueue]),
      removeSyncQueueItem: jest.fn(async (id: number) => {
        const s = getState();
        s.removedIds.push(id);
        s.fakeQueue = s.fakeQueue.filter((q) => q.id !== id);
      }),
      incrementSyncQueueRetry: jest.fn(async (id: number, nextRetryAt: string) => {
        getState().retryIncrements.push({ id, nextRetryAt });
      }),
      countSyncQueueItems: jest.fn(async () => getState().fakeQueue.length),
      withTransaction: jest.fn(async (fn: () => Promise<void>) => {
        getState().transactionCalls += 1;
        await fn();
      }),
      updateFoodSyncStatus: jest.fn(async (id: string, synced: boolean) => {
        getState().updateSyncStatusCalls.push({ fn: 'foods', id, synced });
      }),
      updateWorkoutSyncStatus: jest.fn(async (id: string, synced: boolean) => {
        getState().updateSyncStatusCalls.push({ fn: 'workouts', id, synced });
      }),
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
        delete: () => ({
          eq: (_key: string, value: string) => {
            getSupaState().supabaseCalls.push({ table, op: 'delete', eqId: value });
            return Promise.resolve(maybeError(table, 'delete'));
          },
        }),
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
  WORKOUT_SYNC_CONFIGS: [],
  handleGenericRealtimeChange: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import-under-test (after mocks)
// ---------------------------------------------------------------------------

import { syncService } from '@/lib/services/database/sync-service';

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
  state.removedIds = [];
  state.retryIncrements = [];
  state.transactionCalls = 0;
  state.supabaseCalls.length = 0;
  state.updateSyncStatusCalls.length = 0;
  state.hardDeleteCalls.length = 0;
  state.nextSupabaseError = null;
  state.nextSupabaseErrorOnce = false;
  jest.clearAllMocks();
}

describe('sync-service queue ordering + rollback (Gap 7)', () => {
  beforeEach(clearState);

  test('case 1: create \u2192 edit \u2192 delete same record \u2192 only DELETE reaches Supabase', async () => {
    // 3 queue items for workouts:A in chronological order — dedup keeps the
    // highest id (the DELETE at id=3); upsert items 1 and 2 are purged.
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
  });

  test('case 2: create \u2192 edit \u2192 UPSERT payload carries the LATEST data', async () => {
    enqueue([
      mkItem({ id: 1, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat', sets: 3 }) }),
      mkItem({ id: 2, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat', sets: 5 }) }),
    ]);

    await internals().processSyncQueue();

    const upserts = state.supabaseCalls.filter((c) => c.op === 'upsert' && c.table === 'workouts');
    expect(upserts).toHaveLength(1);
    const payload = (upserts[0].payload as Array<Record<string, unknown>>)[0];
    // Latest data (sets: 5) wins.
    expect(payload.sets).toBe(5);
    // Stale item 1 was purged before processing.
    expect(state.removedIds).toContain(1);
  });

  test('case 3: interleaved tables (foods[A], workouts[B], foods[A]) preserve correct final payload', async () => {
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
  });

  test('case 4: mid-queue RLS failure purges item 2, items 1 + 3 still process', async () => {
    enqueue([
      mkItem({ id: 1, table_name: 'foods', operation: 'upsert', record_id: 'A', data: JSON.stringify({ id: 'A', name: 'a' }) }),
      mkItem({ id: 2, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat' }) }),
      mkItem({ id: 3, table_name: 'foods', operation: 'upsert', record_id: 'C', data: JSON.stringify({ id: 'C', name: 'c' }) }),
    ]);
    // Error the workouts upsert with RLS code 42501.
    state.nextSupabaseError = { table: 'workouts', op: 'upsert', code: '42501', message: 'rls' };

    await internals().processSyncQueue();

    // foods:A and foods:C upserts succeeded.
    const foodCalls = state.supabaseCalls.filter((c) => c.table === 'foods' && c.op === 'upsert');
    expect(foodCalls).toHaveLength(2);
    // Item 2 (workouts) was removed AND local record hard-deleted (RLS purge).
    expect(state.removedIds).toContain(2);
    expect(state.hardDeleteCalls.some((c) => c.fn === 'workouts' && c.id === 'B')).toBe(true);
    // Items 1 + 3 also removed after success.
    expect(state.removedIds).toContain(1);
    expect(state.removedIds).toContain(3);
  });

  test('case 5: max-retries mid-queue does NOT block later items (item 2 at retry=5 removed, item 3 processes)', async () => {
    enqueue([
      mkItem({ id: 1, table_name: 'foods', operation: 'upsert', record_id: 'A', data: JSON.stringify({ id: 'A', name: 'a' }) }),
      mkItem({ id: 2, table_name: 'workouts', operation: 'upsert', record_id: 'B', data: JSON.stringify({ id: 'B', exercise: 'squat' }), retry_count: 5 }),
      mkItem({ id: 3, table_name: 'foods', operation: 'upsert', record_id: 'C', data: JSON.stringify({ id: 'C', name: 'c' }) }),
    ]);

    await internals().processSyncQueue();

    // Item 2 removed without ever hitting Supabase.
    expect(state.removedIds).toContain(2);
    const workoutCalls = state.supabaseCalls.filter((c) => c.table === 'workouts');
    expect(workoutCalls).toHaveLength(0);
    // Items 1 + 3 both reached Supabase.
    const foodCalls = state.supabaseCalls.filter((c) => c.table === 'foods' && c.op === 'upsert');
    expect(foodCalls).toHaveLength(2);
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
