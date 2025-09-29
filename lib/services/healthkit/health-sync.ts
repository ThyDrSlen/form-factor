import { supabase } from '@/lib/supabase';

interface HealthMetricsUpsertInput {
  userId: string;
  summaryDate?: Date;
  steps?: number | null;
  heartRateBpm?: number | null;
  heartRateTimestamp?: number | null;
  weightKg?: number | null;
  weightTimestamp?: number | null;
}

function getSummaryDate(date?: Date): Date {
  const summary = date ? new Date(date) : new Date();
  summary.setHours(0, 0, 0, 0);
  return summary;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toIsoOrNull(timestamp?: number | null): string | null {
  if (timestamp == null) return null;
  const asDate = new Date(timestamp);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate.toISOString();
}

/**
 * Upserts a daily health metrics summary for the authenticated user.
 * Consecutive calls for the same `userId` and `summaryDate` will update the row.
 */
export async function syncHealthMetricsToSupabase({
  userId,
  summaryDate,
  steps,
  heartRateBpm,
  heartRateTimestamp,
  weightKg,
  weightTimestamp,
}: HealthMetricsUpsertInput): Promise<boolean> {
  if (!userId) return false;

  const summary = getSummaryDate(summaryDate);
  const summaryDateString = toDateString(summary);

  const normalizedSteps = steps == null || Number.isNaN(steps) ? null : Math.round(steps);
  const normalizedHeartRate = heartRateBpm == null || Number.isNaN(heartRateBpm) ? null : Number(heartRateBpm);
  const normalizedWeight = weightKg == null || Number.isNaN(weightKg) ? null : Number(weightKg);

  const payload = {
    user_id: userId,
    summary_date: summaryDateString,
    steps: normalizedSteps,
    heart_rate_bpm: normalizedHeartRate,
    heart_rate_timestamp: toIsoOrNull(heartRateTimestamp),
    weight_kg: normalizedWeight,
    weight_timestamp: toIsoOrNull(weightTimestamp),
    recorded_at: new Date().toISOString(),
  };

  // If all metrics are null/undefined, skip persistence to avoid empty rows.
  const hasMetricData = [payload.steps, payload.heart_rate_bpm, payload.weight_kg].some((value) => value != null);
  if (!hasMetricData) {
    return false;
  }

  const { error } = await supabase
    .from('health_metrics')
    .upsert(payload, { onConflict: 'user_id,summary_date' });

  if (error) {
    console.warn('[HealthSync] Failed to upsert health metrics', { error: error.message, code: error.code });
    return false;
  }

  console.log('[HealthSync] Synced health metrics to Supabase', {
    userId,
    summaryDate: summaryDateString,
  });

  return true;
}
