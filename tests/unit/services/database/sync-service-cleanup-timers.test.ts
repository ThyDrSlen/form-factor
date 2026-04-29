/**
 * @jest-environment node
 *
 * Regression coverage for #557 finding B3 — `cleanupRealtimeSync` must clear
 * `realtimeResyncTimer` and `conflictSyncTimer` at the top of the method so
 * a background sync doesn't fire after subscriptions are torn down.
 *
 * This targets the `SyncService.cleanupRealtimeSync` path specifically:
 *   1. Schedule both timers via the private scheduling helpers.
 *   2. Assert they hold a non-null handle.
 *   3. Call `cleanupRealtimeSync()` and assert both are nulled out before
 *      the wall-clock delay (proving they were cleared, not just fired).
 */
jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    getSyncQueue: jest.fn(async () => []),
    removeSyncQueueItem: jest.fn(async () => undefined),
    incrementSyncQueueRetry: jest.fn(async () => undefined),
    countSyncQueueItems: jest.fn(async () => 0),
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    cleanupSyncedDeletes: jest.fn(async () => undefined),
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    removeChannel: jest.fn(async () => undefined),
    from: () => ({
      upsert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

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

/**
 * Minimal structural view into the SyncService singleton so the test can
 * poke at the two private timer handles without coupling to its public API.
 */
type SyncInternals = {
  conflictSyncTimer: ReturnType<typeof setTimeout> | null;
  realtimeResyncTimer: ReturnType<typeof setTimeout> | null;
  scheduleConflictReconcile: (reason: string) => void;
  scheduleResyncAfterRealtimeError: (table: string) => void;
  cleanupRealtimeSync: () => Promise<void>;
  syncPromise: Promise<void> | null;
};

function internals(): SyncInternals {
  return syncService as unknown as SyncInternals;
}

describe('SyncService.cleanupRealtimeSync — timer cleanup (#557 B3)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Reset any scheduled timers left over from other tests.
    const inst = internals();
    if (inst.conflictSyncTimer) {
      clearTimeout(inst.conflictSyncTimer);
      inst.conflictSyncTimer = null;
    }
    if (inst.realtimeResyncTimer) {
      clearTimeout(inst.realtimeResyncTimer);
      inst.realtimeResyncTimer = null;
    }
    inst.syncPromise = null;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('clears conflictSyncTimer when cleanupRealtimeSync runs', async () => {
    const inst = internals();
    inst.scheduleConflictReconcile('test-reason');
    expect(inst.conflictSyncTimer).not.toBeNull();

    await inst.cleanupRealtimeSync();

    expect(inst.conflictSyncTimer).toBeNull();
  });

  it('clears realtimeResyncTimer when cleanupRealtimeSync runs', async () => {
    const inst = internals();
    inst.scheduleResyncAfterRealtimeError('test-reason');
    expect(inst.realtimeResyncTimer).not.toBeNull();

    await inst.cleanupRealtimeSync();

    expect(inst.realtimeResyncTimer).toBeNull();
  });

  it('clears BOTH timers together when both are scheduled', async () => {
    const inst = internals();
    inst.scheduleConflictReconcile('reason-1');
    inst.scheduleResyncAfterRealtimeError('reason-2');
    expect(inst.conflictSyncTimer).not.toBeNull();
    expect(inst.realtimeResyncTimer).not.toBeNull();

    await inst.cleanupRealtimeSync();

    expect(inst.conflictSyncTimer).toBeNull();
    expect(inst.realtimeResyncTimer).toBeNull();
  });

  it('is safe to call when no timers are scheduled', async () => {
    const inst = internals();
    expect(inst.conflictSyncTimer).toBeNull();
    expect(inst.realtimeResyncTimer).toBeNull();

    await expect(inst.cleanupRealtimeSync()).resolves.not.toThrow();
    expect(inst.conflictSyncTimer).toBeNull();
    expect(inst.realtimeResyncTimer).toBeNull();
  });

  it('prevents the scheduled sync from firing after cleanup', async () => {
    const inst = internals();
    inst.scheduleConflictReconcile('test-reason');
    inst.scheduleResyncAfterRealtimeError('test-reason-2');

    await inst.cleanupRealtimeSync();

    // Advance past any realistic delay — if cleanup didn't clear the handle
    // the fake-timer queue would still fire the scheduled callback and
    // mutate conflictSyncTimer/realtimeResyncTimer somewhere in the chain.
    jest.advanceTimersByTime(10_000);
    expect(inst.conflictSyncTimer).toBeNull();
    expect(inst.realtimeResyncTimer).toBeNull();
  });
});
