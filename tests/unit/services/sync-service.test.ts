/**
 * Unit tests for SyncService — the offline-first sync engine.
 *
 * We test the exported singleton (`syncService`) by mocking its two main
 * dependencies: the local SQLite database (`localDB`) and the Supabase
 * client.  The generic-sync helpers are stubbed out so we can focus on
 * the core queue-processing, concurrency-lock, retry, and status logic
 * that lives inside sync-service.ts itself.
 */

// ---------------------------------------------------------------------------
// Supabase mock — a chainable query builder using Proxy
// ---------------------------------------------------------------------------

let qbResolvedValue: { data?: unknown; error?: unknown } = { data: null, error: null };

function createQueryBuilder() {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(qbResolvedValue);
      }
      return (..._args: unknown[]) => builder;
    },
  };
  const builder = new Proxy({} as Record<string, unknown>, handler);
  return builder;
}

const mockGetUser = jest.fn().mockResolvedValue({
  data: { user: { id: 'user-123' } },
});

const mockFrom = jest.fn().mockImplementation(() => createQueryBuilder());

const mockRemoveChannel = jest.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// jest.mock calls — hoisted above imports
// ---------------------------------------------------------------------------

jest.mock('@/lib/services/database/local-db', () => {
  const methods = [
    'getUnsyncedFoods', 'getUnsyncedWorkouts', 'getUnsyncedHealthMetrics',
    'getUnsyncedNutritionGoals', 'getSyncQueue', 'countSyncQueueItems',
    'removeSyncQueueItem', 'incrementSyncQueueRetry', 'cleanupSyncedDeletes',
    'clearSyncQueue', 'addToSyncQueue',
    'updateFoodSyncStatus', 'updateWorkoutSyncStatus',
    'updateHealthMetricSyncStatus', 'updateNutritionGoalsSyncStatus',
    'hardDeleteFood', 'hardDeleteWorkout', 'deleteHealthMetric', 'deleteNutritionGoals',
    'getAllFoodsWithDeleted', 'getAllWorkoutsWithDeleted',
    'insertFood', 'insertWorkout', 'updateFood', 'updateWorkout',
    'getFoodById', 'getWorkoutById', 'getHealthMetricById', 'getNutritionGoalsById',
    'getNutritionGoals', 'upsertNutritionGoals',
    'insertHealthMetric', 'updateHealthMetric',
    'withTransaction',
  ];
  const db: Record<string, jest.Mock> = {};
  for (const m of methods) {
    if (m === 'withTransaction') {
      // Execute the callback so inner calls are visible to assertions
      db[m] = jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn());
    } else {
      db[m] = jest.fn().mockResolvedValue(
        m === 'countSyncQueueItems' ? 0 :
        (m.startsWith('getUnsynced') || m === 'getSyncQueue' || m.startsWith('getAll') ? [] : undefined)
      );
    }
  }
  // Store on global so tests can access it
  (global as any).__mockLocalDB = db;
  return { localDB: db };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getUser: () => mockGetUser(),
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    }),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

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
  createError: jest.fn((_domain: string, _code: string, message: string) => ({
    domain: _domain,
    code: _code,
    message,
    retryable: true,
    severity: 'error',
  })),
  logError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { syncService } from '@/lib/services/database/sync-service';

// Access the mock object created inside the factory
const mockLocalDB = (global as any).__mockLocalDB as Record<string, jest.Mock>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetSyncService() {
  (syncService as any).syncPromise = null;
  (syncService as any).syncCallbacks = [];
  (syncService as any).syncStatusCallbacks = [];
  (syncService as any).syncStatus = {
    state: 'idle',
    queueSize: 0,
    lastError: null,
    lastErrorAt: null,
  };
  (syncService as any).foodChannel = null;
  (syncService as any).workoutChannel = null;
  (syncService as any).healthChannel = null;
  (syncService as any).nutritionGoalsChannel = null;
  (syncService as any).workoutSessionChannels = [];
  if ((syncService as any).conflictSyncTimer) {
    clearTimeout((syncService as any).conflictSyncTimer);
    (syncService as any).conflictSyncTimer = null;
  }
  if ((syncService as any).realtimeResyncTimer) {
    clearTimeout((syncService as any).realtimeResyncTimer);
    (syncService as any).realtimeResyncTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncService();
    // Reset default query builder resolved value
    qbResolvedValue = { data: null, error: null };
    // Re-set default return values that clearAllMocks removed
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    mockFrom.mockImplementation(() => createQueryBuilder());
    mockRemoveChannel.mockResolvedValue(undefined);
    // Re-set localDB default returns
    for (const m of Object.keys(mockLocalDB)) {
      if (m === 'withTransaction') {
        mockLocalDB[m].mockImplementation(async (fn: () => Promise<void>) => fn());
      } else if (m === 'countSyncQueueItems') {
        mockLocalDB[m].mockResolvedValue(0);
      } else if (m.startsWith('getUnsynced') || m === 'getSyncQueue' || m.startsWith('getAll')) {
        mockLocalDB[m].mockResolvedValue([]);
      } else if (m.startsWith('get') || m === 'getNutritionGoals') {
        mockLocalDB[m].mockResolvedValue(null);
      } else {
        mockLocalDB[m].mockResolvedValue(undefined);
      }
    }
  });

  // -----------------------------------------------------------------------
  // Singleton
  // -----------------------------------------------------------------------
  describe('singleton export', () => {
    it('exports a stable reference', () => {
      const ref1 = syncService;
      const ref2 = require('@/lib/services/database/sync-service').syncService;
      expect(ref1).toBe(ref2);
    });
  });

  // -----------------------------------------------------------------------
  // Sync status
  // -----------------------------------------------------------------------
  describe('getSyncStatus / onSyncStatusChange', () => {
    it('returns idle status by default', () => {
      const status = syncService.getSyncStatus();
      expect(status.state).toBe('idle');
      expect(status.queueSize).toBe(0);
      expect(status.lastError).toBeNull();
    });

    it('notifies status subscribers immediately on registration', () => {
      const cb = jest.fn();
      syncService.onSyncStatusChange(cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ state: 'idle' }));
    });

    it('unsubscribe function removes the callback', () => {
      const cb = jest.fn();
      const unsub = syncService.onSyncStatusChange(cb);
      cb.mockClear();
      unsub();
      (syncService as any).setSyncStatus({ state: 'syncing' });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // onSyncComplete
  // -----------------------------------------------------------------------
  describe('onSyncComplete', () => {
    it('notifies registered callbacks', () => {
      const cb = jest.fn();
      syncService.onSyncComplete(cb);
      (syncService as any).notifySyncComplete();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe removes the callback', () => {
      const cb = jest.fn();
      const unsub = syncService.onSyncComplete(cb);
      unsub();
      (syncService as any).notifySyncComplete();
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // syncToSupabase — concurrency lock & basic flow
  // -----------------------------------------------------------------------
  describe('syncToSupabase', () => {
    it('skips when already syncing (syncPromise lock)', async () => {
      // Simulate an in-flight sync by setting syncPromise to a pending promise
      const neverResolves = new Promise<void>(() => {});
      (syncService as any).syncPromise = neverResolves;
      // syncToSupabase should join the existing promise, not start a new sync
      const result = syncService.syncToSupabase();
      expect(mockGetUser).not.toHaveBeenCalled();
      // Clean up so test doesn't hang
      (syncService as any).syncPromise = null;
      // The returned promise is the existing neverResolves; we don't await it
      void result;
    });

    it('sets syncPromise during execution and clears after', async () => {
      expect((syncService as any).syncPromise).toBeNull();
      const promise = syncService.syncToSupabase();
      expect((syncService as any).syncPromise).not.toBeNull();
      await promise;
      expect((syncService as any).syncPromise).toBeNull();
    });

    it('skips sync when no authenticated user', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      await syncService.syncToSupabase();
      expect(mockLocalDB.getUnsyncedFoods).not.toHaveBeenCalled();
    });

    it('sets status to syncing then back to idle on success', async () => {
      const statuses: string[] = [];
      syncService.onSyncStatusChange((s) => statuses.push(s.state));
      await syncService.syncToSupabase();
      expect(statuses).toContain('syncing');
      expect(statuses[statuses.length - 1]).toBe('idle');
    });

    it('sets status to error when getUser throws', async () => {
      mockGetUser.mockRejectedValue(new Error('network down'));
      await syncService.syncToSupabase();
      const status = syncService.getSyncStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('network down');
    });

    it('notifies sync complete on success', async () => {
      const cb = jest.fn();
      syncService.onSyncComplete(cb);
      await syncService.syncToSupabase();
      expect(cb).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // processSyncQueue
  // -----------------------------------------------------------------------
  describe('processSyncQueue (via syncToSupabase)', () => {
    it('removes items that hit max retries (5)', async () => {
      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 1,
          table_name: 'foods',
          operation: 'upsert',
          record_id: 'food-1',
          data: JSON.stringify({ id: 'food-1', name: 'Apple', calories: 95, user_id: 'user-123' }),
          created_at: new Date().toISOString(),
          retry_count: 5,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(1);
    });

    it('processes upsert queue items and removes on success', async () => {
      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 10,
          table_name: 'foods',
          operation: 'upsert',
          record_id: 'food-abc',
          data: JSON.stringify({ id: 'food-abc', name: 'Banana', calories: 105, user_id: 'user-123' }),
          created_at: new Date().toISOString(),
          retry_count: 0,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(10);
      expect(mockLocalDB.updateFoodSyncStatus).toHaveBeenCalledWith('food-abc', true);
    });

    it('processes delete queue items', async () => {
      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 20,
          table_name: 'workouts',
          operation: 'delete',
          record_id: 'workout-xyz',
          data: null,
          created_at: new Date().toISOString(),
          retry_count: 0,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(20);
      expect(mockLocalDB.updateWorkoutSyncStatus).toHaveBeenCalledWith('workout-xyz', true);
    });

    it('increments retry count on queue processing failure', async () => {
      qbResolvedValue = { data: null, error: { message: 'timeout', code: '500' } };

      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 30,
          table_name: 'foods',
          operation: 'upsert',
          record_id: 'food-fail',
          data: JSON.stringify({ id: 'food-fail', name: 'Test', calories: 50, user_id: 'user-123' }),
          created_at: new Date().toISOString(),
          retry_count: 2,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.incrementSyncQueueRetry).toHaveBeenCalledWith(
        30,
        expect.any(String)
      );
    });

    it('skips queue items whose next_retry_at is in the future', async () => {
      const futureDate = new Date(Date.now() + 60_000).toISOString();

      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 40,
          table_name: 'foods',
          operation: 'upsert',
          record_id: 'food-wait',
          data: JSON.stringify({ id: 'food-wait', name: 'Waiting', calories: 10, user_id: 'user-123' }),
          created_at: new Date().toISOString(),
          retry_count: 1,
          next_retry_at: futureDate,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.removeSyncQueueItem).not.toHaveBeenCalledWith(40);
      expect(mockLocalDB.incrementSyncQueueRetry).not.toHaveBeenCalledWith(40, expect.anything());
    });

    it('handles corrupted JSON data gracefully (removes unparseable item)', async () => {
      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 50,
          table_name: 'foods',
          operation: 'upsert',
          record_id: 'food-corrupt',
          data: '{{not valid json',
          created_at: new Date().toISOString(),
          retry_count: 0,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(50);
      expect(mockLocalDB.incrementSyncQueueRetry).not.toHaveBeenCalled();
    });

    it('purges local record and removes queue item on RLS violation (42501)', async () => {
      qbResolvedValue = { data: null, error: { message: 'RLS', code: '42501' } };

      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 60,
          table_name: 'foods',
          operation: 'upsert',
          record_id: 'food-rls',
          data: JSON.stringify({ id: 'food-rls', name: 'Forbidden', calories: 0, user_id: 'user-123' }),
          created_at: new Date().toISOString(),
          retry_count: 0,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.hardDeleteFood).toHaveBeenCalledWith('food-rls');
      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(60);
    });

    it('purges health metric on invalid UUID error (22P02)', async () => {
      qbResolvedValue = { data: null, error: { message: 'invalid UUID', code: '22P02' } };

      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 70,
          table_name: 'health_metrics',
          operation: 'upsert',
          record_id: 'bad-uuid',
          data: JSON.stringify({ id: 'bad-uuid', summary_date: '2025-01-01', user_id: 'user-123' }),
          created_at: new Date().toISOString(),
          retry_count: 0,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.deleteHealthMetric).toHaveBeenCalledWith('bad-uuid');
      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(70);
    });

    it('removes stale duplicate queue rows before processing the newest entry', async () => {
      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 80,
          table_name: 'foods',
          operation: 'upsert',
          record_id: 'food-dup',
          data: JSON.stringify({ id: 'food-dup', name: 'Old', calories: 10, user_id: 'user-123' }),
          created_at: new Date().toISOString(),
          retry_count: 4,
          next_retry_at: null,
        },
        {
          id: 81,
          table_name: 'foods',
          operation: 'delete',
          record_id: 'food-dup',
          data: JSON.stringify({ id: 'food-dup', user_id: 'user-123' }),
          created_at: new Date().toISOString(),
          retry_count: 0,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(80);
      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(81);
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockLocalDB.incrementSyncQueueRetry).not.toHaveBeenCalledWith(80, expect.any(String));
    });

    it('drops wrong-user queue items instead of leaving them stuck forever', async () => {
      mockLocalDB.getSyncQueue.mockResolvedValue([
        {
          id: 90,
          table_name: 'foods',
          operation: 'upsert',
          record_id: 'food-wrong-user',
          data: JSON.stringify({ id: 'food-wrong-user', name: 'Other', calories: 10, user_id: 'someone-else' }),
          created_at: new Date().toISOString(),
          retry_count: 0,
          next_retry_at: null,
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.hardDeleteFood).toHaveBeenCalledWith('food-wrong-user');
      expect(mockLocalDB.removeSyncQueueItem).toHaveBeenCalledWith(90);
      expect(mockLocalDB.incrementSyncQueueRetry).not.toHaveBeenCalledWith(90, expect.any(String));
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // fullSync
  // -----------------------------------------------------------------------
  describe('fullSync', () => {
    it('coalesces concurrent calls via syncPromise', async () => {
      const p1 = syncService.fullSync();
      const p2 = syncService.fullSync();
      await Promise.all([p1, p2]);
      expect((syncService as any).syncPromise).toBeNull();
    });

    it('clears syncPromise after completion', async () => {
      await syncService.fullSync();
      expect((syncService as any).syncPromise).toBeNull();
    });

    it('clears syncPromise even on error', async () => {
      // Make getUser reject so both downloadFromSupabase and syncToSupabase fail
      mockGetUser.mockRejectedValue(new Error('kaboom'));
      await syncService.fullSync();
      expect((syncService as any).syncPromise).toBeNull();
      expect(syncService.getSyncStatus().state).toBe('error');
    });
  });

  // -----------------------------------------------------------------------
  // clearSyncQueue
  // -----------------------------------------------------------------------
  describe('clearSyncQueue', () => {
    it('delegates to localDB.clearSyncQueue and resets status', async () => {
      (syncService as any).setSyncStatus({
        state: 'error',
        lastError: 'some error',
        lastErrorAt: new Date().toISOString(),
      });

      await syncService.clearSyncQueue();

      expect(mockLocalDB.clearSyncQueue).toHaveBeenCalled();
      const status = syncService.getSyncStatus();
      expect(status.state).toBe('idle');
      expect(status.lastError).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Retry delay calculation
  // -----------------------------------------------------------------------
  describe('getRetryDelayMs', () => {
    it('uses exponential backoff capped at 60s', () => {
      const fn = (syncService as any).getRetryDelayMs.bind(syncService);
      expect(fn(0)).toBe(1_000);
      expect(fn(1)).toBe(2_000);
      expect(fn(2)).toBe(4_000);
      expect(fn(3)).toBe(8_000);
      expect(fn(4)).toBe(16_000);
      expect(fn(5)).toBe(32_000);
      expect(fn(6)).toBe(60_000);
      expect(fn(10)).toBe(60_000);
    });
  });

  // -----------------------------------------------------------------------
  // isQueueItemReady
  // -----------------------------------------------------------------------
  describe('isQueueItemReady', () => {
    const check = (item: Record<string, unknown>) =>
      (syncService as any).isQueueItemReady.call(syncService, item);

    it('returns true when next_retry_at is null', () => {
      expect(check({ next_retry_at: null, created_at: new Date().toISOString() })).toBe(true);
    });

    it('returns true when next_retry_at is in the past', () => {
      expect(check({
        next_retry_at: new Date(Date.now() - 10_000).toISOString(),
        created_at: new Date().toISOString(),
      })).toBe(true);
    });

    it('returns false when next_retry_at is in the future', () => {
      expect(check({
        next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        created_at: new Date().toISOString(),
      })).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Realtime cleanup
  // -----------------------------------------------------------------------
  describe('cleanupRealtimeSync', () => {
    it('removes all channels and clears conflict timer', async () => {
      (syncService as any).foodChannel = { id: 'food' };
      (syncService as any).workoutChannel = { id: 'workout' };
      (syncService as any).healthChannel = { id: 'health' };
      (syncService as any).nutritionGoalsChannel = { id: 'nutrition' };
      (syncService as any).workoutSessionChannels = [{ id: 'session1' }];
      (syncService as any).conflictSyncTimer = setTimeout(() => {}, 10000);

      await syncService.cleanupRealtimeSync();

      expect(mockRemoveChannel).toHaveBeenCalledTimes(5);
      expect((syncService as any).foodChannel).toBeNull();
      expect((syncService as any).workoutChannel).toBeNull();
      expect((syncService as any).healthChannel).toBeNull();
      expect((syncService as any).nutritionGoalsChannel).toBeNull();
      expect((syncService as any).workoutSessionChannels).toHaveLength(0);
      expect((syncService as any).conflictSyncTimer).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Error classification helpers
  // -----------------------------------------------------------------------
  describe('error classification', () => {
    it('identifies RLS violations (42501)', () => {
      const fn = (syncService as any).isRlsViolation.bind(syncService);
      expect(fn({ code: '42501' })).toBe(true);
      expect(fn({ code: '500' })).toBe(false);
      expect(fn(null)).toBe(false);
    });

    it('identifies invalid UUID errors (22P02)', () => {
      const fn = (syncService as any).isInvalidUuid.bind(syncService);
      expect(fn({ code: '22P02' })).toBe(true);
      expect(fn({ code: '42501' })).toBe(false);
      expect(fn(null)).toBe(false);
    });

    it('identifies managed tables', () => {
      const fn = (syncService as any).isManagedTable.bind(syncService);
      expect(fn('foods')).toBe(true);
      expect(fn('workouts')).toBe(true);
      expect(fn('health_metrics')).toBe(true);
      expect(fn('nutrition_goals')).toBe(true);
      expect(fn('other_table')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Food-specific sync
  // -----------------------------------------------------------------------
  describe('food sync to Supabase', () => {
    it('syncs unsynced foods with upsert', async () => {
      mockLocalDB.getUnsyncedFoods.mockResolvedValue([
        {
          id: 'food-1',
          name: 'Apple',
          calories: 95,
          protein: 0.5,
          carbs: 25,
          fat: 0.3,
          date: '2025-01-01T12:00:00Z',
          synced: 0,
          deleted: 0,
          updated_at: '2025-01-01T12:00:00Z',
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.updateFoodSyncStatus).toHaveBeenCalledWith('food-1', true);
    });

    it('handles deleted foods by calling supabase delete', async () => {
      mockLocalDB.getUnsyncedFoods.mockResolvedValue([
        {
          id: 'food-del',
          name: 'Deleted Food',
          calories: 0,
          date: '2025-01-01',
          synced: 0,
          deleted: 1,
          updated_at: '2025-01-01T12:00:00Z',
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.updateFoodSyncStatus).toHaveBeenCalledWith('food-del', true);
    });

    it('adds food to sync queue on non-RLS failure', async () => {
      qbResolvedValue = { data: null, error: { message: 'server error', code: '500' } };

      mockLocalDB.getUnsyncedFoods.mockResolvedValue([
        {
          id: 'food-retry',
          name: 'Retry Food',
          calories: 100,
          date: '2025-01-01',
          synced: 0,
          deleted: 0,
          updated_at: '2025-01-01T12:00:00Z',
        },
      ]);

      await syncService.syncToSupabase();

      expect(mockLocalDB.addToSyncQueue).toHaveBeenCalledWith(
        'foods',
        'upsert',
        'food-retry',
        expect.objectContaining({ name: 'Retry Food' })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Realtime error handling (#225)
  // -----------------------------------------------------------------------
  describe('handleRealtimeError', () => {
    it('sets sync status to error with the failure message', () => {
      const fn = (syncService as any).handleRealtimeError.bind(syncService);
      fn('foods', new Error('DB write failed'));

      const status = syncService.getSyncStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('DB write failed');
      expect(status.lastErrorAt).toBeTruthy();
    });

    it('uses a generic message for non-Error values', () => {
      const fn = (syncService as any).handleRealtimeError.bind(syncService);
      fn('workouts', 'string error');

      const status = syncService.getSyncStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('Realtime workouts change failed');
    });

    it('schedules a resync via realtimeResyncTimer', () => {
      const fn = (syncService as any).handleRealtimeError.bind(syncService);
      fn('foods', new Error('write failed'));

      // A resync timer should be pending
      expect((syncService as any).realtimeResyncTimer).not.toBeNull();
    });

    it('debounces multiple errors into a single resync', () => {
      jest.useFakeTimers();
      try {
        const fn = (syncService as any).handleRealtimeError.bind(syncService);
        fn('foods', new Error('error 1'));
        const timer1 = (syncService as any).realtimeResyncTimer;

        fn('workouts', new Error('error 2'));
        const timer2 = (syncService as any).realtimeResyncTimer;

        // Same timer — second call was debounced
        expect(timer1).toBe(timer2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('realtime food change error handling', () => {
    it('sets sync status to error when local DB write fails', async () => {
      const { createError: mockCreateError, logError: mockLogError } =
        require('@/lib/services/ErrorHandler');

      mockLocalDB.getFoodById.mockRejectedValue(new Error('SQLite full'));

      const handler = (syncService as any).handleRealtimeFoodChange.bind(syncService);
      await handler({
        eventType: 'INSERT',
        new: { id: 'food-rt-1', name: 'Apple', calories: 95 },
        old: {},
      });

      const status = syncService.getSyncStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('SQLite full');

      expect(mockCreateError).toHaveBeenCalledWith(
        'sync',
        'REALTIME_CHANGE_FAILED',
        expect.stringContaining('foods'),
        expect.objectContaining({ retryable: true }),
      );
      expect(mockLogError).toHaveBeenCalled();
    });
  });

  describe('realtime workout change error handling', () => {
    it('sets sync status to error when local DB write fails', async () => {
      mockLocalDB.getWorkoutById.mockRejectedValue(new Error('disk error'));

      const handler = (syncService as any).handleRealtimeWorkoutChange.bind(syncService);
      await handler({
        eventType: 'UPDATE',
        new: { id: 'workout-rt-1', exercise: 'Bench Press', sets: 3 },
        old: {},
      });

      const status = syncService.getSyncStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('disk error');
    });
  });

  describe('realtime health metric change error handling', () => {
    it('sets sync status to error when local DB write fails', async () => {
      mockLocalDB.getHealthMetricById.mockRejectedValue(new Error('constraint violation'));

      const handler = (syncService as any).handleRealtimeHealthMetricChange.bind(syncService);
      await handler({
        eventType: 'INSERT',
        new: { id: 'hm-1', user_id: 'u-1', summary_date: '2025-01-01' },
        old: {},
      });

      const status = syncService.getSyncStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('constraint violation');
    });
  });

  describe('realtime nutrition goals change error handling', () => {
    it('sets sync status to error when local DB write fails', async () => {
      mockLocalDB.getNutritionGoalsById.mockRejectedValue(new Error('table locked'));

      const handler = (syncService as any).handleRealtimeNutritionGoalsChange.bind(syncService);
      await handler({
        eventType: 'INSERT',
        new: { id: 'ng-1', user_id: 'u-1', calories_goal: 2000, protein_goal: 150, carbs_goal: 200, fat_goal: 60 },
        old: {},
      });

      const status = syncService.getSyncStatus();
      expect(status.state).toBe('error');
      expect(status.lastError).toBe('table locked');
    });
  });

  describe('cleanupRealtimeSync clears resync timer', () => {
    it('clears the realtimeResyncTimer', async () => {
      // Set up a pending resync timer
      (syncService as any).realtimeResyncTimer = setTimeout(() => {}, 10000);
      expect((syncService as any).realtimeResyncTimer).not.toBeNull();

      await syncService.cleanupRealtimeSync();

      expect((syncService as any).realtimeResyncTimer).toBeNull();
    });
  });
});
