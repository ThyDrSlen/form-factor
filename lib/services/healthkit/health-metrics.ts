import { getNativeHealthKit } from './native-healthkit';

export interface HealthMetricPoint {
  date: number;
  value: number;
}

export type BiologicalSex = 'female' | 'male' | 'other' | 'unknown';

export function parseNumeric(value: unknown): number | null {
  // Treat null/undefined as missing data instead of coercing to 0.
  if (value == null) {
    return null;
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractSampleValue(sample: any): number | null {
  if (!sample) return null;
  const direct = parseNumeric(sample.value);
  if (direct != null) return direct;
  const quantityValue = parseNumeric(sample.quantity?.value);
  if (quantityValue != null) return quantityValue;
  return parseNumeric(sample.quantity);
}

export function normalizeDay(dateLike: unknown): number | null {
  if (!dateLike) return null;
  const date = new Date(dateLike as Date | string | number);
  if (Number.isNaN(date.getTime())) return null;
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return normalized.getTime();
}

function getHealthKitModule() {
  return getNativeHealthKit();
}

export function buildDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

export type MissingDayFillStrategy = 'carry-forward' | 'zero';

export function ensureContinuousHistory(
  points: HealthMetricPoint[],
  range: { start: Date; end: Date },
  fillStrategy: MissingDayFillStrategy = 'carry-forward'
): HealthMetricPoint[] {
  const byDay = new Map<number, number>();
  points.forEach((point) => {
    if (Number.isFinite(point.date)) {
      byDay.set(point.date, point.value);
    }
  });

  const days: HealthMetricPoint[] = [];
  const cursor = new Date(range.start);
  let lastValue: number | null = null;

  while (cursor <= range.end) {
    const key = cursor.getTime();
    const valueForDay = byDay.get(key);

    if (typeof valueForDay === 'number' && !Number.isNaN(valueForDay)) {
      lastValue = valueForDay;
    }

    const value = fillStrategy === 'zero' ? (valueForDay ?? 0) : lastValue;
    if (value != null) {
      days.push({ date: key, value });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function buildRangeOptions(days: number) {
  const range = buildDateRange(days);
  return {
    range,
    startDate: range.start.toISOString(),
    endDate: range.end.toISOString(),
  };
}

function aggregateDaily(
  results: any[],
  aggregate: 'sum' | 'average',
  defaultValue: number | null = null
): HealthMetricPoint[] {
  const byDay = new Map<number, number[]>();
  results.forEach((item) => {
    const date = normalizeDay(item?.startDate ?? item?.endDate);
    const value = extractSampleValue(item);
    if (date == null || value == null) return;
    const arr = byDay.get(date) ?? [];
    arr.push(value);
    byDay.set(date, arr);
  });

  const points: HealthMetricPoint[] = [];
  Array.from(byDay.entries()).forEach(([date, values]) => {
    if (aggregate === 'sum') {
      points.push({ date, value: values.reduce((sum, v) => sum + v, 0) });
    } else if (values.length > 0) {
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      points.push({ date, value: Number(avg.toFixed(2)) });
    }
  });
  return points.sort((a, b) => a.date - b.date);
}

export async function getBiologicalSexAsync(): Promise<BiologicalSex | null> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getBiologicalSex !== 'function') {
      return null;
    }
    const sex = await healthKit.getBiologicalSex();
    return typeof sex === 'string' ? (sex as BiologicalSex) : null;
  } catch (_e) {
    return null;
  }
}

export async function getDateOfBirthAsync(): Promise<{ birthDate: string | null; age: number | null }> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getDateOfBirth !== 'function') {
      return { birthDate: null, age: null };
    }
    const result = await healthKit.getDateOfBirth();
    const birthDate = typeof result?.birthDate === 'string' ? result.birthDate : null;
    const age = parseNumeric(result?.age);
    return { birthDate, age: age != null ? Math.floor(age) : null };
  } catch (_e) {
    return { birthDate: null, age: null };
  }
}

export async function getRespiratoryRateHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getQuantitySamples !== 'function') {
      return [];
    }
    const { startDate, endDate } = buildRangeOptions(days);
    const results = await healthKit.getQuantitySamples('respiratoryRate', startDate, endDate, 'count/min', null, true);
    if (!Array.isArray(results)) {
      return [];
    }
    return aggregateDaily(results, 'average');
  } catch (_e) {
    return [];
  }
}

export async function getWalkingHeartRateAverageHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getQuantitySamples !== 'function') {
      return [];
    }
    const { startDate, endDate } = buildRangeOptions(days);
    const results = await healthKit.getQuantitySamples('walkingHeartRateAverage', startDate, endDate, 'bpm', null, true);
    if (!Array.isArray(results)) {
      return [];
    }
    return aggregateDaily(results, 'average');
  } catch (_e) {
    return [];
  }
}

export async function getActiveEnergyHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getQuantitySamples !== 'function') {
      return [];
    }
    const { startDate, endDate } = buildRangeOptions(days);
    const results = await healthKit.getQuantitySamples('activeEnergyBurned', startDate, endDate, 'kcal', null, true);
    if (!Array.isArray(results)) {
      return [];
    }
    return aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
  } catch (_e) {
    return [];
  }
}

export async function getBasalEnergyHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getQuantitySamples !== 'function') {
      return [];
    }
    const { startDate, endDate } = buildRangeOptions(days);
    const results = await healthKit.getQuantitySamples('basalEnergyBurned', startDate, endDate, 'kcal', null, true);
    if (!Array.isArray(results)) {
      return [];
    }
    return aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
  } catch (_e) {
    return [];
  }
}

export async function getDistanceWalkingRunningHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getDailySumSamples !== 'function') {
      return [];
    }
    const { startDate, endDate } = buildRangeOptions(days);
    const results = await healthKit.getDailySumSamples('distanceWalkingRunning', startDate, endDate, 'meter');
    if (!Array.isArray(results)) {
      return [];
    }
    return aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
  } catch (_e) {
    return [];
  }
}

export async function getDistanceCyclingHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getDailySumSamples !== 'function') {
      return [];
    }
    const { startDate, endDate } = buildRangeOptions(days);
    const results = await healthKit.getDailySumSamples('distanceCycling', startDate, endDate, 'meter');
    if (!Array.isArray(results)) {
      return [];
    }
    return aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
  } catch (_e) {
    return [];
  }
}

export async function getDistanceSwimmingHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getDailySumSamples !== 'function') {
      return [];
    }
    const { startDate, endDate } = buildRangeOptions(days);
    const results = await healthKit.getDailySumSamples('distanceSwimming', startDate, endDate, 'meter');
    if (!Array.isArray(results)) {
      return [];
    }
    return aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
  } catch (_e) {
    return [];
  }
}

export async function getStepCountForTodayAsync(): Promise<number> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getDailySumSamples !== 'function') {
      return 0;
    }
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    const results = await healthKit.getDailySumSamples(
      'stepCount',
      startOfDay.toISOString(),
      endOfDay.toISOString(),
      'count'
    );
    if (!Array.isArray(results)) {
      return 0;
    }
    return results.reduce((sum: number, row: any) => {
      const value = extractSampleValue(row) ?? 0;
      return sum + value;
    }, 0);
  } catch (_e) {
    return 0;
  }
}

export async function getStepHistoryAsync(days = 7): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getDailySumSamples !== 'function') {
      return [];
    }

    const range = buildDateRange(days);
    const results = await healthKit.getDailySumSamples(
      'stepCount',
      range.start.toISOString(),
      range.end.toISOString(),
      'count'
    );
    if (!Array.isArray(results)) {
      return ensureContinuousHistory([], range, 'zero');
    }

    const mapped = results
      .map((row: any) => {
        const value = extractSampleValue(row) ?? 0;
        const date = normalizeDay(row?.startDate ?? row?.endDate);
        return date ? { date, value } : null;
      })
      .filter((item): item is HealthMetricPoint => Boolean(item));

    return ensureContinuousHistory(mapped, range, 'zero');
  } catch (_e) {
    return [];
  }
}

export async function getLatestHeartRateAsync(): Promise<{ bpm: number | null; timestamp: number | null }> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getQuantitySamples !== 'function') {
      return { bpm: null, timestamp: null };
    }
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 1000 * 60 * 60 * 24);
    const results = await healthKit.getQuantitySamples(
      'heartRate',
      startDate.toISOString(),
      endDate.toISOString(),
      'bpm',
      1,
      false
    );
    if (!Array.isArray(results) || results.length === 0) {
      return { bpm: null, timestamp: null };
    }
    const first = results[0];
    const bpm = extractSampleValue(first);
    const ts = first.endDate ? new Date(first.endDate).getTime() : null;
    return { bpm: bpm ?? null, timestamp: ts };
  } catch (_e) {
    return { bpm: null, timestamp: null };
  }
}

export async function getLatestBodyMassKgAsync(): Promise<{ kg: number | null; timestamp: number | null }> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getLatestQuantitySample !== 'function') {
      return { kg: null, timestamp: null };
    }
    const result = await healthKit.getLatestQuantitySample('bodyMass', 'kg');
    if (!result) {
      return { kg: null, timestamp: null };
    }
    const kg = extractSampleValue(result);
    const ts = result.endDate ? new Date(result.endDate).getTime() : null;
    return { kg: kg ?? null, timestamp: ts };
  } catch (_e) {
    return { kg: null, timestamp: null };
  }
}

export async function getWeightHistoryAsync(days = 7): Promise<HealthMetricPoint[]> {
  try {
    const healthKit = getHealthKitModule();
    if (typeof healthKit?.getQuantitySamples !== 'function') {
      return [];
    }

    const range = buildDateRange(days);
    const results = await healthKit.getQuantitySamples(
      'bodyMass',
      range.start.toISOString(),
      range.end.toISOString(),
      'kg',
      days * 3,
      false
    );
    if (!Array.isArray(results) || results.length === 0) {
      return ensureContinuousHistory([], range, 'carry-forward');
    }

    const latestPerDay = new Map<number, number>();
    results.forEach((item: any) => {
      const date = normalizeDay(item?.startDate ?? item?.endDate);
      if (date == null) return;
      const value = extractSampleValue(item);
      if (value == null) return;
      if (!latestPerDay.has(date) || (item?.endDate && normalizeDay(item.endDate) === date)) {
        latestPerDay.set(date, value);
      }
    });

    const mapped: HealthMetricPoint[] = Array.from(latestPerDay.entries()).map(([date, value]) => ({
      date,
      value,
    }));

    return ensureContinuousHistory(mapped, range, 'carry-forward');
  } catch (_e) {
    return [];
  }
}
