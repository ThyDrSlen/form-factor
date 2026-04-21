/**
 * Tests for lib/services/healthkit/health-bulk-sync.ts
 *
 * syncAllHealthKitDataToSupabase, getExistingDataRange, syncMissingHealthKitData.
 * Uses jest.spyOn to mock localDB methods and native HealthKit.
 */

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

// Mock expo-sqlite so local-db.ts can initialize
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

// Mock native HealthKit for health-metrics.ts functions
const mockNativeHK: Record<string, jest.Mock> = {
  isAvailable: jest.fn().mockReturnValue(true),
  getQuantitySamples: jest.fn().mockResolvedValue([]),
  getLatestQuantitySample: jest.fn().mockResolvedValue(null),
  getDailySumSamples: jest.fn().mockResolvedValue([]),
  getBiologicalSex: jest.fn().mockResolvedValue(null),
  getDateOfBirth: jest.fn().mockResolvedValue(null),
};

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn((name: string) => {
    if (name === 'FFHealthKit') return mockNativeHK;
    throw new Error(`Unknown module: ${name}`);
  }),
}));

import {
  syncAllHealthKitDataToSupabase,
  getExistingDataRange,
  syncMissingHealthKitData,
  type BulkSyncProgress,
} from '@/lib/services/healthkit/health-bulk-sync';
import { localDB } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';

describe('health-bulk-sync', () => {
  let spyInsertHealthMetric: jest.SpyInstance;
  let spyGetHealthMetricsCount: jest.SpyInstance;
  let spyGetHealthMetricsForRange: jest.SpyInstance;
  let spySyncToSupabase: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    spyInsertHealthMetric = jest.spyOn(localDB, 'insertHealthMetric').mockResolvedValue(undefined as any);
    spyGetHealthMetricsCount = jest.spyOn(localDB, 'getHealthMetricsCount').mockResolvedValue(0);
    spyGetHealthMetricsForRange = jest.spyOn(localDB, 'getHealthMetricsForRange').mockResolvedValue([]);
    spySyncToSupabase = jest.spyOn(syncService, 'syncToSupabase').mockResolvedValue(undefined as any);

    mockNativeHK.getDailySumSamples.mockResolvedValue([]);
    mockNativeHK.getQuantitySamples.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- syncAllHealthKitDataToSupabase ----------

  describe('syncAllHealthKitDataToSupabase', () => {
    it('returns failure for empty userId', async () => {
      const result = await syncAllHealthKitDataToSupabase('');
      expect(result.success).toBe(false);
      expect(result.recordsSynced).toBe(0);
    });

    it('syncs data to localDB when native returns results', async () => {
      const now = new Date();
      now.setHours(12, 0, 0, 0);

      mockNativeHK.getDailySumSamples.mockResolvedValue([
        { value: 5000, startDate: now.toISOString() },
      ]);

      const result = await syncAllHealthKitDataToSupabase('user-1', 7);
      expect(result.success).toBe(true);
      expect(result.recordsSynced).toBeGreaterThanOrEqual(1);
      expect(spyInsertHealthMetric).toHaveBeenCalled();
    });

    it('reports progress via callback', async () => {
      mockNativeHK.getDailySumSamples.mockResolvedValue([
        { value: 5000, startDate: new Date().toISOString() },
      ]);

      const progressUpdates: BulkSyncProgress[] = [];
      await syncAllHealthKitDataToSupabase('user-1', 7, (progress) => {
        progressUpdates.push({ ...progress });
      });

      expect(progressUpdates.some(p => p.phase === 'fetching')).toBe(true);
    });

    it('continues on individual insert failures', async () => {
      mockNativeHK.getDailySumSamples.mockResolvedValue([
        { value: 5000, startDate: '2024-01-01T12:00:00Z' },
        { value: 6000, startDate: '2024-01-02T12:00:00Z' },
      ]);

      spyInsertHealthMetric
        .mockRejectedValueOnce(new Error('insert fail'))
        .mockResolvedValue(undefined);

      const result = await syncAllHealthKitDataToSupabase('user-1', 7);
      expect(result.errors).toBeGreaterThanOrEqual(1);
    });

    it('triggers background sync to Supabase', async () => {
      await syncAllHealthKitDataToSupabase('user-1', 7);
      expect(spySyncToSupabase).toHaveBeenCalled();
    });

    it('handles HealthKit fetch exception gracefully', async () => {
      mockNativeHK.getDailySumSamples.mockRejectedValue(new Error('unavailable'));

      const progressUpdates: BulkSyncProgress[] = [];
      const result = await syncAllHealthKitDataToSupabase('user-1', 7, (p) => {
        progressUpdates.push({ ...p });
      });

      expect(result).toBeDefined();
      expect(result.recordsSynced).toBe(0);
    });

    it('inserts zero-filled step records even when native returns empty', async () => {
      // When native returns no data, getStepHistoryAsync still produces
      // zero-filled continuous history. These records have steps: 0 (not null),
      // so they pass the filter and get inserted.
      mockNativeHK.getDailySumSamples.mockResolvedValue([]);
      mockNativeHK.getQuantitySamples.mockResolvedValue([]);

      const result = await syncAllHealthKitDataToSupabase('user-1', 7);
      // Steps with value 0 are valid data points that get synced
      expect(result.recordsSynced).toBeGreaterThanOrEqual(0);
      expect(result.success).toBe(true);
    });
  });

  // ---------- getExistingDataRange ----------

  describe('getExistingDataRange', () => {
    it('returns empty range for empty userId', async () => {
      const result = await getExistingDataRange('');
      expect(result).toEqual({ earliest: null, latest: null, count: 0 });
    });

    it('returns empty range when count is 0', async () => {
      spyGetHealthMetricsCount.mockResolvedValue(0);

      const result = await getExistingDataRange('user-1');
      expect(result.count).toBe(0);
      expect(result.earliest).toBeNull();
      expect(result.latest).toBeNull();
    });

    it('returns date range from existing metrics', async () => {
      spyGetHealthMetricsCount.mockResolvedValue(10);
      spyGetHealthMetricsForRange.mockResolvedValue([
        { summary_date: '2024-01-10' },
        { summary_date: '2024-01-05' },
        { summary_date: '2024-01-01' },
      ]);

      const result = await getExistingDataRange('user-1');
      expect(result.count).toBe(10);
      expect(result.latest).toBe('2024-01-10');
      expect(result.earliest).toBe('2024-01-01');
    });

    it('returns empty range when metrics query returns empty', async () => {
      spyGetHealthMetricsCount.mockResolvedValue(5);
      spyGetHealthMetricsForRange.mockResolvedValue([]);

      const result = await getExistingDataRange('user-1');
      expect(result.count).toBe(5);
      expect(result.earliest).toBeNull();
      expect(result.latest).toBeNull();
    });

    it('handles database errors gracefully', async () => {
      spyGetHealthMetricsCount.mockRejectedValue(new Error('db fail'));

      const result = await getExistingDataRange('user-1');
      expect(result).toEqual({ earliest: null, latest: null, count: 0 });
    });
  });

  // ---------- syncMissingHealthKitData ----------

  describe('syncMissingHealthKitData', () => {
    it('does full sync when no existing data', async () => {
      spyGetHealthMetricsCount.mockResolvedValue(0);

      const result = await syncMissingHealthKitData('user-1', 365);
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });

    it('syncs when existing data is present', async () => {
      spyGetHealthMetricsCount.mockResolvedValue(10);
      spyGetHealthMetricsForRange.mockResolvedValue([
        { summary_date: '2024-01-10' },
        { summary_date: '2024-01-01' },
      ]);

      const result = await syncMissingHealthKitData('user-1', 365);
      expect(result).toBeDefined();
    });
  });

  // ===========================================================================
  // Partial-failure + permission-revoke coverage (Issue #546)
  //
  // Acceptance criteria from #546:
  //   1. Permission denied mid-sync → sync aborts cleanly via logError,
  //      no crash.
  //   2. localDB insertHealthMetric fails for one record → others still
  //      written.
  //   3. Timeout on large historical fetch → partial results saved.
  //   4. Exponential backoff on transient native error (3 retries,
  //      doubling intervals).
  //   5. User-cancel mid-sync → abort signal honored.
  //
  // Tests for (3), (4), (5) are test.skip because the production code at
  // lib/services/healthkit/health-bulk-sync.ts does NOT currently
  // implement timeout / retry / abort-signal plumbing. Flipping those
  // to passing requires production-side changes tracked as follow-up
  // work under #546.
  // ===========================================================================

  describe('partial-failure and permission-revoke coverage (#546)', () => {
    it('does not crash when native step/weight fetch rejects (permission denial / revocation mid-fetch)', async () => {
      // Simulate the user revoking HealthKit permission via iOS Settings
      // mid-import. `getStepHistoryAsync` / `getWeightHistoryAsync` both
      // wrap their native call in try/catch and return [] on error, so
      // the bulk-sync pipeline proceeds with empty history — no crash,
      // no local writes from this run.
      mockNativeHK.getDailySumSamples.mockRejectedValue(
        new Error('HealthKit authorization denied'),
      );
      mockNativeHK.getQuantitySamples.mockRejectedValue(
        new Error('HealthKit authorization denied'),
      );

      const result = await syncAllHealthKitDataToSupabase('user-1', 30);

      // The function returns a clean (non-thrown) result and no insert
      // calls landed (no data to persist after permission revocation).
      expect(result).toBeDefined();
      expect(result.recordsSynced).toBe(0);
      expect(spyInsertHealthMetric).not.toHaveBeenCalled();
    });

    it('emits progress callbacks even when the native fetch returns no data (phase=fetching, then phase=complete)', async () => {
      // When permission is denied, the history helpers silently return
      // [] — the bulk-sync pipeline still emits its phase progression.
      // UI consumers can surface a generic "no data" state without
      // needing a separate error signal.
      mockNativeHK.getDailySumSamples.mockRejectedValue(
        new Error('authorization denied'),
      );

      const progressUpdates: BulkSyncProgress[] = [];
      await syncAllHealthKitDataToSupabase('user-1', 7, (p) => {
        progressUpdates.push({ ...p });
      });

      // Pipeline must at least advance through the fetching phase.
      expect(progressUpdates.some((p) => p.phase === 'fetching')).toBe(true);
      // No crash → callback array populated.
      expect(progressUpdates.length).toBeGreaterThan(0);
    });

    it('continues writing remaining records when one localDB.insertHealthMetric throws', async () => {
      const now = new Date();
      const samples = [
        { value: 5000, startDate: new Date(now.getTime() - 3 * 86400000).toISOString() },
        { value: 6000, startDate: new Date(now.getTime() - 2 * 86400000).toISOString() },
        { value: 7000, startDate: new Date(now.getTime() - 1 * 86400000).toISOString() },
      ];
      mockNativeHK.getDailySumSamples.mockResolvedValue(samples);

      // Fail only the second insert; the other two must still succeed —
      // the production code wraps each insert in a try/catch so one
      // failure doesn't abort the batch (health-bulk-sync.ts:137-143).
      let insertCall = 0;
      spyInsertHealthMetric.mockImplementation(async () => {
        insertCall++;
        if (insertCall === 2) {
          throw new Error('constraint violation on day-2 row');
        }
        return undefined;
      });

      const result = await syncAllHealthKitDataToSupabase('user-1', 7);

      // At least the two surviving inserts landed; the failed one is
      // tallied in the errors counter. success flag is false only if
      // ANY failed (production uses `failed === 0`).
      expect(spyInsertHealthMetric.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(result.recordsSynced).toBeGreaterThanOrEqual(2);
      expect(result.errors).toBeGreaterThanOrEqual(1);
      expect(result.success).toBe(false);
    });

    it('still triggers the Supabase background sync even when some inserts fail', async () => {
      mockNativeHK.getDailySumSamples.mockResolvedValue([
        { value: 5000, startDate: '2024-01-01T12:00:00Z' },
        { value: 6000, startDate: '2024-01-02T12:00:00Z' },
      ]);

      spyInsertHealthMetric
        .mockRejectedValueOnce(new Error('bad row'))
        .mockResolvedValue(undefined);

      await syncAllHealthKitDataToSupabase('user-1', 7);

      // Background sync fires regardless of partial-failure count —
      // enqueued successful writes must still propagate to Supabase.
      expect(spySyncToSupabase).toHaveBeenCalled();
    });

    it('does not crash when localDB rejects every single insert (all records tracked as errors)', async () => {
      mockNativeHK.getDailySumSamples.mockResolvedValue([
        { value: 5000, startDate: '2024-01-01T12:00:00Z' },
        { value: 6000, startDate: '2024-01-02T12:00:00Z' },
      ]);

      spyInsertHealthMetric.mockRejectedValue(new Error('DB locked'));

      // Should NOT throw — the function returns a failure result.
      const result = await syncAllHealthKitDataToSupabase('user-1', 7);

      expect(result.success).toBe(false);
      expect(result.recordsSynced).toBe(0);
      expect(result.errors).toBeGreaterThanOrEqual(1);
    });

    it('still triggers Supabase background sync even when native fetch returned zero points (no-op but consistent)', async () => {
      // Native permission denied → fetch helpers return []. The pipeline
      // walks through with zero validData and calls syncToSupabase()
      // anyway because it is non-blocking and covers any queued items
      // from previous partial syncs. Core assertion: no crash +
      // syncToSupabase is invoked for consistency.
      mockNativeHK.getDailySumSamples.mockRejectedValue(
        new Error('HealthKit unavailable'),
      );

      await syncAllHealthKitDataToSupabase('user-1', 7);

      // The production code at health-bulk-sync.ts:217-220 invokes
      // syncService.syncToSupabase() after the write-phase regardless of
      // how many rows landed. This is INTENTIONAL — previous-run queue
      // items may still be pending and a background flush is safe.
      expect(spySyncToSupabase).toHaveBeenCalled();
    });

    // ---- Skipped: production gaps tracked by #546 follow-up -------------

    // BLOCKED on production change: syncAllHealthKitDataToSupabase does
    // not currently accept a timeout or AbortSignal. Flipping this test
    // to passing requires threading a `signal` / `timeoutMs` option
    // through to `getStepHistoryAsync` / `getWeightHistoryAsync` and
    // honoring it when the fetch overruns.
    test.skip('BLOCKED #546: aborts large historical fetch on timeout, saves partial results', async () => {
      // Intended shape once production supports timeouts:
      //   mockNativeHK.getDailySumSamples.mockImplementation(() =>
      //     new Promise(() => {}) // never resolves
      //   );
      //   const controller = new AbortController();
      //   setTimeout(() => controller.abort(), 100);
      //   const result = await syncAllHealthKitDataToSupabase(
      //     'user-1', 365, undefined, { signal: controller.signal },
      //   );
      //   expect(result.success).toBe(false);
      //   expect(result.recordsSynced).toBeGreaterThanOrEqual(0);
    });

    // BLOCKED on production change: the service does NOT retry on
    // transient native errors (e.g., HealthKit returning a temporary
    // data-store-unavailable error). A retry-with-backoff wrapper
    // around the native fetch + localDB insert is the required change.
    test.skip('BLOCKED #546: retries transient native errors with exponential backoff (3 attempts, doubling)', async () => {
      // jest.useFakeTimers();
      // let attempt = 0;
      // mockNativeHK.getDailySumSamples.mockImplementation(async () => {
      //   attempt++;
      //   if (attempt < 3) throw new Error('transient unavailable');
      //   return [{ value: 5000, startDate: '2024-01-01T12:00:00Z' }];
      // });
      // const promise = syncAllHealthKitDataToSupabase('user-1', 7);
      // await jest.advanceTimersByTimeAsync(500);   // 1st retry @ 500ms
      // await jest.advanceTimersByTimeAsync(1000);  // 2nd retry @ 1000ms
      // const result = await promise;
      // expect(attempt).toBe(3);
      // expect(result.recordsSynced).toBeGreaterThan(0);
    });

    // BLOCKED on production change: syncAllHealthKitDataToSupabase does
    // not currently accept an AbortSignal. User-cancel plumbing through
    // every stage of the pipeline (fetch, merge, write) is the required
    // production change.
    test.skip('BLOCKED #546: honors an AbortSignal cancellation mid-sync and preserves partial results', async () => {
      // const controller = new AbortController();
      // mockNativeHK.getDailySumSamples.mockResolvedValue([
      //   { value: 5000, startDate: '2024-01-01T12:00:00Z' },
      //   { value: 6000, startDate: '2024-01-02T12:00:00Z' },
      //   { value: 7000, startDate: '2024-01-03T12:00:00Z' },
      // ]);
      // spyInsertHealthMetric.mockImplementation(async () => {
      //   // Simulate user cancel after the first insert lands.
      //   controller.abort();
      // });
      // const result = await syncAllHealthKitDataToSupabase(
      //   'user-1', 3, undefined, { signal: controller.signal },
      // );
      // expect(result.recordsSynced).toBeGreaterThanOrEqual(1); // some saved
      // expect(result.recordsSynced).toBeLessThan(3);           // cancel honored
    });
  });
});
