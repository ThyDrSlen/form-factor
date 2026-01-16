/**
 * Health Data Aggregation Service
 * Provides weekly and monthly aggregated health metrics
 * Reads from local DB first (offline-capable)
 */

import { localDB } from '@/lib/services/database/local-db';
import { warnWithTs } from '@/lib/logger';

export interface AggregatedHealthMetrics {
  period: string; // ISO date string (week start or month start)
  avgSteps: number | null;
  totalSteps: number | null;
  avgWeight: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  avgHeartRate: number | null;
  dataPoints: number; // Number of days with data in this period
}

export interface HealthTrendData {
  daily: DailyHealthMetric[];
  weekly: AggregatedHealthMetrics[];
  monthly: AggregatedHealthMetrics[];
}

export interface DailyHealthMetric {
  date: string;
  steps: number | null;
  weightKg: number | null;
  heartRateBpm: number | null;
}

/**
 * Parse summary date (YYYY-MM-DD) as UTC date
 */
function parseSummaryDate(dateString: string): Date | null {
  const [year, month, day] = dateString.split('-').map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get start of week (Monday) for a given UTC date
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get start of month for a given UTC date
 */
function getMonthStart(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Fetches daily health metrics for a date range from local DB
 */
export async function fetchDailyHealthMetrics(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<DailyHealthMetric[]> {
  if (!userId) return [];

  const startStr = formatDateKey(startDate);
  const endStr = formatDateKey(endDate);

  try {
    const metrics = await localDB.getHealthMetricsForRange(userId, startStr, endStr);
    
    const byDate = new Map(metrics.map((row) => [row.summary_date, row]));
    const filled: DailyHealthMetric[] = [];
    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);
    const endCursor = new Date(endDate);
    endCursor.setHours(0, 0, 0, 0);

    while (cursor <= endCursor) {
      const key = formatDateKey(cursor);
      const row = byDate.get(key);
      filled.push({
        date: key,
        steps: row?.steps ?? 0,
        weightKg: row?.weight_kg ?? null,
        heartRateBpm: row?.heart_rate_bpm ?? null,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return filled;
  } catch (error) {
    warnWithTs('[HealthAggregation] Failed to fetch daily metrics from local DB', error);
    return [];
  }
}

/**
 * Aggregates daily metrics into weekly periods
 */
export function aggregateWeekly(dailyMetrics: DailyHealthMetric[]): AggregatedHealthMetrics[] {
  const weekMap = new Map<string, DailyHealthMetric[]>();

  // Group by week
  dailyMetrics.forEach((metric) => {
    const date = parseSummaryDate(metric.date);
    if (!date) return;
    const weekStart = getWeekStart(date);
    const weekKey = weekStart.toISOString().slice(0, 10);

    const existing = weekMap.get(weekKey) || [];
    existing.push(metric);
    weekMap.set(weekKey, existing);
  });

  // Calculate aggregates for each week
  const weeklyData: AggregatedHealthMetrics[] = [];

  weekMap.forEach((metrics, weekKey) => {
    const stepsData = metrics.filter((m) => m.steps != null).map((m) => m.steps!);
    const weightData = metrics.filter((m) => m.weightKg != null).map((m) => m.weightKg!);
    const hrData = metrics.filter((m) => m.heartRateBpm != null).map((m) => m.heartRateBpm!);

    weeklyData.push({
      period: weekKey,
      avgSteps: stepsData.length > 0 
        ? Math.round(stepsData.reduce((sum, val) => sum + val, 0) / stepsData.length)
        : null,
      totalSteps: stepsData.length > 0 
        ? Math.round(stepsData.reduce((sum, val) => sum + val, 0))
        : null,
      avgWeight: weightData.length > 0
        ? Number((weightData.reduce((sum, val) => sum + val, 0) / weightData.length).toFixed(1))
        : null,
      minWeight: weightData.length > 0 ? Math.min(...weightData) : null,
      maxWeight: weightData.length > 0 ? Math.max(...weightData) : null,
      avgHeartRate: hrData.length > 0
        ? Math.round(hrData.reduce((sum, val) => sum + val, 0) / hrData.length)
        : null,
      dataPoints: metrics.length,
    });
  });

  return weeklyData.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Aggregates daily metrics into monthly periods
 */
export function aggregateMonthly(dailyMetrics: DailyHealthMetric[]): AggregatedHealthMetrics[] {
  const monthMap = new Map<string, DailyHealthMetric[]>();

  // Group by month
  dailyMetrics.forEach((metric) => {
    const date = parseSummaryDate(metric.date);
    if (!date) return;
    const monthStart = getMonthStart(date);
    const monthKey = monthStart.toISOString().slice(0, 10);

    const existing = monthMap.get(monthKey) || [];
    existing.push(metric);
    monthMap.set(monthKey, existing);
  });

  // Calculate aggregates for each month
  const monthlyData: AggregatedHealthMetrics[] = [];

  monthMap.forEach((metrics, monthKey) => {
    const stepsData = metrics.filter((m) => m.steps != null).map((m) => m.steps!);
    const weightData = metrics.filter((m) => m.weightKg != null).map((m) => m.weightKg!);
    const hrData = metrics.filter((m) => m.heartRateBpm != null).map((m) => m.heartRateBpm!);

    monthlyData.push({
      period: monthKey,
      avgSteps: stepsData.length > 0
        ? Math.round(stepsData.reduce((sum, val) => sum + val, 0) / stepsData.length)
        : null,
      totalSteps: stepsData.length > 0
        ? Math.round(stepsData.reduce((sum, val) => sum + val, 0))
        : null,
      avgWeight: weightData.length > 0
        ? Number((weightData.reduce((sum, val) => sum + val, 0) / weightData.length).toFixed(1))
        : null,
      minWeight: weightData.length > 0 ? Math.min(...weightData) : null,
      maxWeight: weightData.length > 0 ? Math.max(...weightData) : null,
      avgHeartRate: hrData.length > 0
        ? Math.round(hrData.reduce((sum, val) => sum + val, 0) / hrData.length)
        : null,
      dataPoints: metrics.length,
    });
  });

  return monthlyData.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Fetches comprehensive health trend data (daily, weekly, monthly)
 */
export async function fetchHealthTrendData(
  userId: string,
  days: number = 90
): Promise<HealthTrendData> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));

  const dailyMetrics = await fetchDailyHealthMetrics(userId, startDate, endDate);

  return {
    daily: dailyMetrics,
    weekly: aggregateWeekly(dailyMetrics),
    monthly: aggregateMonthly(dailyMetrics),
  };
}

/**
 * Calculate percentage change between two periods
 */
export function calculatePercentageChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) {
    return null;
  }
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

/**
 * Get comparison metrics for a specific period type
 */
export interface ComparisonMetrics {
  current: AggregatedHealthMetrics | null;
  previous: AggregatedHealthMetrics | null;
  stepsChange: number | null;
  weightChange: number | null;
  heartRateChange: number | null;
}

export function getComparisonMetrics(
  aggregated: AggregatedHealthMetrics[],
  periodType: 'weekly' | 'monthly'
): ComparisonMetrics {
  if (aggregated.length === 0) {
    return {
      current: null,
      previous: null,
      stepsChange: null,
      weightChange: null,
      heartRateChange: null,
    };
  }

  const current = aggregated[aggregated.length - 1];
  const previous = aggregated.length > 1 ? aggregated[aggregated.length - 2] : null;

  return {
    current,
    previous,
    stepsChange: calculatePercentageChange(current.avgSteps, previous?.avgSteps ?? null),
    weightChange: calculatePercentageChange(current.avgWeight, previous?.avgWeight ?? null),
    heartRateChange: calculatePercentageChange(current.avgHeartRate, previous?.avgHeartRate ?? null),
  };
}
