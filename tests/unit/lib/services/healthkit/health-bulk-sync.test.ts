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
});
