/**
 * Bulk HealthKit Data Sync Service
 * Handles importing historical health data from HealthKit to local DB (then syncs to Supabase)
 */

import { localDB } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';
import { getStepHistoryAsync, getWeightHistoryAsync, type HealthMetricPoint } from './health-metrics';

export interface BulkSyncProgress {
  phase: 'fetching' | 'uploading' | 'complete' | 'error';
  current: number;
  total: number;
  message: string;
}

export type BulkSyncProgressCallback = (progress: BulkSyncProgress) => void;

interface HealthDataPoint {
  id: string;
  user_id: string;
  summary_date: string;
  steps: number | null;
  heart_rate_bpm: number | null;
  heart_rate_timestamp: string | null;
  weight_kg: number | null;
  weight_timestamp: string | null;
}

/**
 * Converts a timestamp to ISO date string (YYYY-MM-DD)
 */
function toDateString(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10);
}

/**
 * Converts a timestamp to ISO datetime string
 */
function toIsoOrNull(timestamp?: number | null): string | null {
  if (timestamp == null) return null;
  const asDate = new Date(timestamp);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate.toISOString();
}

/**
 * Merges step and weight history data into daily records
 */
function mergeHealthData(
  userId: string,
  stepHistory: HealthMetricPoint[],
  weightHistory: HealthMetricPoint[]
): Map<string, HealthDataPoint> {
  const dataByDate = new Map<string, HealthDataPoint>();

  // Process steps
  stepHistory.forEach((point) => {
    const dateStr = toDateString(point.date);
    const existing = dataByDate.get(dateStr);
    
    if (existing) {
      existing.steps = Math.max(0, Math.round(point.value));
    } else {
      dataByDate.set(dateStr, {
        id: `${userId}_${dateStr}`,
        user_id: userId,
        summary_date: dateStr,
        steps: Math.max(0, Math.round(point.value)),
        heart_rate_bpm: null,
        heart_rate_timestamp: null,
        weight_kg: null,
        weight_timestamp: null,
      });
    }
  });

  // Process weights
  weightHistory.forEach((point) => {
    const dateStr = toDateString(point.date);
    const existing = dataByDate.get(dateStr);
    
    if (existing) {
      existing.weight_kg = Number(Math.max(0, point.value).toFixed(1));
      existing.weight_timestamp = toIsoOrNull(point.date);
    } else {
      dataByDate.set(dateStr, {
        id: `${userId}_${dateStr}`,
        user_id: userId,
        summary_date: dateStr,
        steps: null,
        heart_rate_bpm: null,
        heart_rate_timestamp: null,
        weight_kg: Number(Math.max(0, point.value).toFixed(1)),
        weight_timestamp: toIsoOrNull(point.date),
      });
    }
  });

  return dataByDate;
}

/**
 * Writes health data to local DB in batches
 */
async function writeHealthDataToLocalDB(
  dataPoints: HealthDataPoint[],
  onProgress?: BulkSyncProgressCallback
): Promise<{ success: number; failed: number }> {
  const BATCH_SIZE = 100; // Process in batches for progress updates
  let successCount = 0;
  let failedCount = 0;

  // Filter out records with no meaningful data
  const validData = dataPoints.filter(
    (point) => point.steps != null || point.weight_kg != null
  );

  const totalBatches = Math.ceil(validData.length / BATCH_SIZE);

  for (let i = 0; i < validData.length; i += BATCH_SIZE) {
    const batch = validData.slice(i, i + BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

    onProgress?.({
      phase: 'uploading',
      current: i + batch.length,
      total: validData.length,
      message: `Importing batch ${currentBatch}/${totalBatches}...`,
    });

    try {
      // Write to local DB (much faster than Supabase)
      for (const point of batch) {
        try {
          await localDB.insertHealthMetric(point);
          successCount++;
        } catch (err) {
          console.warn('[BulkSync] Failed to insert point', { date: point.summary_date, err });
          failedCount++;
        }
      }
    } catch (err) {
      console.error('[BulkSync] Exception during batch write', err);
      failedCount += batch.length;
    }
  }

  return { success: successCount, failed: failedCount };
}

/**
 * Syncs all historical HealthKit data to local DB (then syncs to Supabase in background)
 * @param userId - User ID to sync data for
 * @param days - Number of days of history to sync (default: 365)
 * @param onProgress - Optional callback for progress updates
 * @returns Promise with sync results
 */
export async function syncAllHealthKitDataToSupabase(
  userId: string,
  days: number = 365,
  onProgress?: BulkSyncProgressCallback
): Promise<{ success: boolean; recordsSynced: number; errors: number }> {
  if (!userId) {
    return { success: false, recordsSynced: 0, errors: 0 };
  }

  try {
    console.log('[BulkSync] Starting bulk import for', days, 'days');
    
    // Phase 1: Fetch data from HealthKit
    onProgress?.({
      phase: 'fetching',
      current: 0,
      total: days,
      message: 'Fetching data from HealthKit...',
    });

    const [stepHistory, weightHistory] = await Promise.all([
      getStepHistoryAsync(days),
      getWeightHistoryAsync(days),
    ]);

    console.log('[BulkSync] Fetched', {
      steps: stepHistory.length,
      weights: weightHistory.length,
    });

    onProgress?.({
      phase: 'fetching',
      current: days,
      total: days,
      message: 'Data fetched successfully',
    });

    // Phase 2: Merge and prepare data
    const mergedData = mergeHealthData(userId, stepHistory, weightHistory);
    const dataPoints = Array.from(mergedData.values());

    console.log('[BulkSync] Prepared', dataPoints.length, 'records for import');

    // Phase 3: Write to local DB (instant, offline-capable)
    const { success, failed } = await writeHealthDataToLocalDB(dataPoints, onProgress);

    console.log('[BulkSync] Local import complete', { success, failed });

    // Phase 4: Trigger background sync to Supabase
    onProgress?.({
      phase: 'complete',
      current: success,
      total: success + failed,
      message: `Import complete: ${success} records imported`,
    });

    // Trigger background sync (non-blocking)
    syncService.syncToSupabase().catch(err => {
      console.warn('[BulkSync] Background sync to Supabase failed', err);
    });

    return {
      success: failed === 0,
      recordsSynced: success,
      errors: failed,
    };
  } catch (error: any) {
    console.error('[BulkSync] Failed to import health data', error);
    
    onProgress?.({
      phase: 'error',
      current: 0,
      total: 0,
      message: error?.message || 'Import failed',
    });

    return {
      success: false,
      recordsSynced: 0,
      errors: 1,
    };
  }
}

/**
 * Checks if a user has any historical data in local DB
 * Returns the date range of existing data
 */
export async function getExistingDataRange(
  userId: string
): Promise<{ earliest: string | null; latest: string | null; count: number }> {
  if (!userId) {
    return { earliest: null, latest: null, count: 0 };
  }

  try {
    const count = await localDB.getHealthMetricsCount(userId);
    
    if (count === 0) {
      return { earliest: null, latest: null, count: 0 };
    }

    // Get date range from local DB
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2); // Look back 2 years max

    const metrics = await localDB.getHealthMetricsForRange(
      userId,
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10)
    );

    if (metrics.length === 0) {
      return { earliest: null, latest: null, count };
    }

    return {
      earliest: metrics[metrics.length - 1].summary_date, // Oldest (DESC order)
      latest: metrics[0].summary_date, // Newest (DESC order)
      count,
    };
  } catch (err) {
    console.error('[BulkSync] Failed to check existing data range', err);
    return { earliest: null, latest: null, count: 0 };
  }
}

/**
 * Syncs only the missing date ranges (incremental sync)
 */
export async function syncMissingHealthKitData(
  userId: string,
  maxDays: number = 365,
  onProgress?: BulkSyncProgressCallback
): Promise<{ success: boolean; recordsSynced: number; errors: number }> {
  const existing = await getExistingDataRange(userId);
  
  if (existing.count === 0) {
    // No existing data, do a full sync
    return syncAllHealthKitDataToSupabase(userId, maxDays, onProgress);
  }

  // For now, we'll just sync the full range
  // In a more advanced implementation, we could calculate gaps and sync only those
  return syncAllHealthKitDataToSupabase(userId, maxDays, onProgress);
}

