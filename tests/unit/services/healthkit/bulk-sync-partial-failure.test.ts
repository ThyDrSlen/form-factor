/**
 * Tests for lib/services/healthkit/health-bulk-sync.ts — partial-failure
 * semantics when some HealthKit reads succeed and others throw.
 *
 * Validates that:
 *  - Partial failures surface as `errors > 0` without losing successful writes.
 *  - `success` flag flips to false even when >= 1 record lands.
 *  - A whole-batch exception (e.g. native-bridge crash during write) still
 *    resolves with `success: false` and does not leak unfinished state.
 *  - Final `onProgress` callback reflects reality (complete vs error).
 *
 * Closes #546 (T4 — healthkit partial-failure).
 */

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

const mockNativeHK = {
  isAvailable: jest.fn().mockReturnValue(true),
  getQuantitySamples: jest.fn().mockResolvedValue([]),
  getLatestQuantitySample: jest.fn().mockResolvedValue(null),
  getDailySumSamples: jest.fn().mockResolvedValue([]),
  getBiologicalSex: jest.fn().mockResolvedValue(null),
  getDateOfBirth: jest.fn().mockResolvedValue(null),
};

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn((name) => {
    if (name === 'FFHealthKit') return mockNativeHK;
    throw new Error(`Unknown module: ${name}`);
  }),
}));

import {
  syncAllHealthKitDataToSupabase,
  type BulkSyncProgress,
} from '@/lib/services/healthkit/health-bulk-sync';
import { localDB } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';

function recentMidnight(daysAgo: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime() - daysAgo * 24 * 60 * 60 * 1000;
}

describe('health-bulk-sync: partial-failure semantics (#546)', () => {
  let spyInsert: jest.SpyInstance;
  let spySyncToSupabase: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    spyInsert = jest.spyOn(localDB, 'insertHealthMetric').mockResolvedValue(undefined as any);
    spySyncToSupabase = jest
      .spyOn(syncService, 'syncToSupabase')
      .mockResolvedValue(undefined as any);

    // Default native stubs to empty.
    mockNativeHK.getDailySumSamples.mockResolvedValue([]);
    mockNativeHK.getQuantitySamples.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('mixed success/error on insertHealthMetric counts errors separately, success flag flips false', async () => {
    // 3 daily step samples.
    mockNativeHK.getDailySumSamples.mockResolvedValue([
      { date: recentMidnight(2), value: 5000 },
      { date: recentMidnight(1), value: 6000 },
      { date: recentMidnight(0), value: 7000 },
    ]);

    // Second insert throws (native write partial failure). Others succeed.
    spyInsert
      .mockResolvedValueOnce(undefined as any)
      .mockRejectedValueOnce(new Error('SQLITE_BUSY'))
      .mockResolvedValueOnce(undefined as any);

    const result = await syncAllHealthKitDataToSupabase('user-1', 3);

    // Each successful insert was counted; one error was tallied.
    expect(spyInsert).toHaveBeenCalledTimes(3);
    expect(result.recordsSynced).toBe(2);
    expect(result.errors).toBe(1);
    // success=false whenever >=1 error occurs.
    expect(result.success).toBe(false);
  });

  test('all inserts succeed => success=true, errors=0, and sync-to-supabase is triggered', async () => {
    mockNativeHK.getDailySumSamples.mockResolvedValue([
      { date: recentMidnight(1), value: 8000 },
      { date: recentMidnight(0), value: 9000 },
    ]);

    const result = await syncAllHealthKitDataToSupabase('user-1', 2);

    expect(result.recordsSynced).toBe(2);
    expect(result.errors).toBe(0);
    expect(result.success).toBe(true);
    // Background sync-to-supabase kicked off.
    expect(spySyncToSupabase).toHaveBeenCalledTimes(1);
  });

  test('onProgress emits a terminal complete phase on partial success (no orphaned uploading phase)', async () => {
    mockNativeHK.getDailySumSamples.mockResolvedValue([
      { date: recentMidnight(1), value: 5000 },
      { date: recentMidnight(0), value: 6000 },
    ]);
    spyInsert.mockResolvedValueOnce(undefined as any).mockRejectedValueOnce(new Error('fail'));

    const recorded: BulkSyncProgress[] = [];
    await syncAllHealthKitDataToSupabase('user-1', 2, (p) => recorded.push(p));

    // Last emission is always 'complete' or 'error' — never a dangling 'uploading'.
    expect(recorded[recorded.length - 1].phase).toBe('complete');
    // Sanity: at least one fetching + uploading emission in between.
    expect(recorded.map((p) => p.phase)).toContain('fetching');
  });

  test('native-bridge crash inside getStepHistoryAsync is swallowed by the reader (XXX current contract)', async () => {
    // XXX Current behavior: `getStepHistoryAsync` / `getWeightHistoryAsync`
    // catch native errors and return `[]` silently (health-metrics.ts:340-342).
    // That means an HK bridge crash surfaces to bulk-sync as "0 samples" and
    // the overall operation reports success=true / recordsSynced=0.
    //
    // Documented here so a future refactor that wants to propagate native
    // errors upward (so users can see "HealthKit unavailable") does not
    // silently break this existing contract. If the reader's error policy
    // changes, flip these expectations and remove the XXX.
    mockNativeHK.getDailySumSamples.mockRejectedValue(new Error('native bridge crash'));

    const emitted: BulkSyncProgress[] = [];
    const result = await syncAllHealthKitDataToSupabase('user-1', 7, (p) => emitted.push(p));

    expect(result.recordsSynced).toBe(0);
    // success=true because reader's swallow-and-return-[] policy treats the
    // crash as "no data" rather than "error". This documents current behavior.
    expect(result.success).toBe(true);
    expect(spyInsert).not.toHaveBeenCalled();
    expect(emitted[emitted.length - 1].phase).toBe('complete');
  });

  test('insertHealthMetric write errors do NOT throw out — queue stays consistent', async () => {
    // Partial-failure rollback semantics: each insert is independently
    // try/catch-ed, so a mid-batch failure cannot leave the bulk sync in
    // a half-finished state that later logic assumes ran to completion.
    mockNativeHK.getDailySumSamples.mockResolvedValue([
      { date: recentMidnight(1), value: 5000 },
      { date: recentMidnight(0), value: 6000 },
    ]);
    spyInsert
      .mockRejectedValueOnce(new Error('disk full'))
      .mockRejectedValueOnce(new Error('disk full'));

    const result = await syncAllHealthKitDataToSupabase('user-1', 2);

    // Both inserts attempted, both failed — errors=2, success=false.
    expect(spyInsert).toHaveBeenCalledTimes(2);
    expect(result.recordsSynced).toBe(0);
    expect(result.errors).toBe(2);
    expect(result.success).toBe(false);
  });
});

