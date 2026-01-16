import { supabase } from '@/lib/supabase';
import { warnWithTs } from '@/lib/logger';
import type { HealthMetricPoint } from './health-metrics';

interface HealthMetricsRow {
  summary_date: string;
  steps: number | null;
  heart_rate_bpm: number | null;
  heart_rate_timestamp: string | null;
  weight_kg: number | null;
  weight_timestamp: string | null;
  recorded_at: string | null;
}

export interface SupabaseHealthSnapshot {
  steps: number | null;
  heartRateBpm: number | null;
  heartRateTimestamp: number | null;
  weightKg: number | null;
  weightTimestamp: number | null;
  stepHistory: HealthMetricPoint[];
  weightHistory: HealthMetricPoint[];
  lastUpdatedAt: number | null;
}

function startOfDayUtcFromString(dateString: string): number | null {
  const [year, month, day] = dateString.split('-').map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function toTimestamp(iso?: string | null): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function getDateRange(days: number): { from: string; to: string; dates: number[] } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const dates: number[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const current = new Date(end);
    current.setDate(end.getDate() - i);
    dates.push(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  }

  const fromDate = new Date(dates[0]);
  const toDate = new Date(dates[dates.length - 1]);

  const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

  return {
    from: toIsoDate(fromDate),
    to: toIsoDate(toDate),
    dates,
  };
}

function buildHistory(
  dates: number[],
  rows: Map<number, HealthMetricsRow>,
  valueSelector: (row: HealthMetricsRow | undefined, previous: number | null) => number | null,
  carryForward = false
): HealthMetricPoint[] {
  const history: HealthMetricPoint[] = [];
  let previousValue: number | null = null;

  dates.forEach((dateKey) => {
    const row = rows.get(dateKey);
    const selected = valueSelector(row, previousValue);
    const value = selected ?? (carryForward ? previousValue : 0);
    previousValue = value;
    history.push({ date: dateKey, value: value ?? 0 });
  });

  return history;
}

export async function fetchSupabaseHealthSnapshot(
  userId: string,
  days = 7
): Promise<SupabaseHealthSnapshot | null> {
  if (!userId) return null;

  const range = getDateRange(days);

  const { data, error } = await supabase
    .from('health_metrics')
    .select('summary_date, steps, heart_rate_bpm, heart_rate_timestamp, weight_kg, weight_timestamp, recorded_at')
    .eq('user_id', userId)
    .gte('summary_date', range.from)
    .lte('summary_date', range.to)
    .order('summary_date', { ascending: true });

  if (error) {
    warnWithTs('[HealthSupabase] Failed to fetch health metrics', error.message);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const rowMap = new Map<number, HealthMetricsRow>();
  data.forEach((row) => {
    const timestamp = startOfDayUtcFromString(row.summary_date);
    if (timestamp != null) {
      rowMap.set(timestamp, row);
    }
  });

  const stepHistory = buildHistory(range.dates, rowMap, (row) => (row?.steps == null ? 0 : Math.max(0, Math.round(row.steps))), false);
  const weightHistory = buildHistory(
    range.dates,
    rowMap,
    (row, previous) => {
      if (row?.weight_kg != null) {
        const normalized = Number(row.weight_kg.toFixed(1));
        return normalized;
      }
      return previous;
    },
    true
  ).map((point) => ({ ...point, value: Number(point.value.toFixed(1)) }));

  const latestRow = data[data.length - 1];
  const steps = latestRow?.steps == null ? null : Math.max(0, Math.round(latestRow.steps));
  const heartRateBpm = latestRow?.heart_rate_bpm == null ? null : Number(latestRow.heart_rate_bpm);
  const heartRateTimestamp = toTimestamp(latestRow?.heart_rate_timestamp);
  const weightKg = latestRow?.weight_kg == null ? null : Number(latestRow.weight_kg.toFixed(1));
  const weightTimestamp = toTimestamp(latestRow?.weight_timestamp);
  const lastUpdatedAt = toTimestamp(latestRow?.recorded_at) ?? heartRateTimestamp ?? weightTimestamp;

  return {
    steps,
    heartRateBpm,
    heartRateTimestamp,
    weightKg,
    weightTimestamp,
    stepHistory,
    weightHistory,
    lastUpdatedAt: lastUpdatedAt ?? null,
  };
}
