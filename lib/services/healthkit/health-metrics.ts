import AppleHealthKit from 'react-native-health';
import { NativeModules } from 'react-native';

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

function getHealthKitModule(): any {
  const native = (NativeModules as any)?.RNAppleHealthKit ?? (NativeModules as any)?.AppleHealthKit;
  const jsModule = AppleHealthKit as any;
  if (native) {
    if (jsModule && typeof jsModule === 'object') {
      // Preserve constants while using native methods (TurboModules proxies are not spreadable).
      native.Constants = native.Constants ?? jsModule.Constants;
    }
    return native;
  }
  return jsModule;
}

export function buildDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

export function ensureContinuousHistory(points: HealthMetricPoint[], range: { start: Date; end: Date }): HealthMetricPoint[] {
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

    // Carry forward last known weight to avoid dropping to zero on missing days.
    if (lastValue != null) {
      days.push({ date: key, value: lastValue });
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
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getBiologicalSex !== 'function') {
        resolve(null);
        return;
      }

      healthKit.getBiologicalSex({}, (_err: any, result: any) => {
        const sex = typeof result?.value === 'string' ? result.value : null;
        resolve(sex as BiologicalSex | null);
      });
    } catch (_e) {
      resolve(null);
    }
  });
}

export async function getDateOfBirthAsync(): Promise<{ birthDate: string | null; age: number | null }> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getDateOfBirth !== 'function') {
        resolve({ birthDate: null, age: null });
        return;
      }

      healthKit.getDateOfBirth({}, (_err: any, result: any) => {
        const birthDate = typeof result?.value === 'string' ? result.value : null;
        const age = parseNumeric(result?.age);
        resolve({ birthDate, age: age != null ? Math.floor(age) : null });
      });
    } catch (_e) {
      resolve({ birthDate: null, age: null });
    }
  });
}

export async function getRespiratoryRateHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getRespiratoryRateSamples !== 'function') {
        resolve([]);
        return;
      }
      const { startDate, endDate } = buildRangeOptions(days);
      const options = { startDate, endDate, unit: 'count/min', ascending: true } as const;
      healthKit.getRespiratoryRateSamples(options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve([]);
          return;
        }
        resolve(aggregateDaily(results, 'average'));
      });
    } catch (_e) {
      resolve([]);
    }
  });
}

export async function getWalkingHeartRateAverageHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getWalkingHeartRateAverage !== 'function') {
        resolve([]);
        return;
      }
      const { startDate, endDate } = buildRangeOptions(days);
      const options = { startDate, endDate, unit: 'bpm', ascending: true } as const;
      healthKit.getWalkingHeartRateAverage(options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve([]);
          return;
        }
        resolve(aggregateDaily(results, 'average'));
      });
    } catch (_e) {
      resolve([]);
    }
  });
}

export async function getActiveEnergyHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getActiveEnergyBurned !== 'function') {
        resolve([]);
        return;
      }
      const { startDate, endDate } = buildRangeOptions(days);
      const options = { startDate, endDate, includeManuallyAdded: false, ascending: true } as const;
      healthKit.getActiveEnergyBurned(options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve([]);
          return;
        }
        const aggregated = aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
        resolve(aggregated);
      });
    } catch (_e) {
      resolve([]);
    }
  });
}

export async function getBasalEnergyHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getBasalEnergyBurned !== 'function') {
        resolve([]);
        return;
      }
      const { startDate, endDate } = buildRangeOptions(days);
      const options = { startDate, endDate, includeManuallyAdded: false, ascending: true } as const;
      healthKit.getBasalEnergyBurned(options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve([]);
          return;
        }
        const aggregated = aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
        resolve(aggregated);
      });
    } catch (_e) {
      resolve([]);
    }
  });
}

export async function getDistanceWalkingRunningHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      const method = healthKit?.getDailyDistanceWalkingRunningSamples ?? healthKit?.getDistanceWalkingRunning;
      if (typeof method !== 'function') {
        resolve([]);
        return;
      }
      const { startDate, endDate } = buildRangeOptions(days);
      const options = { startDate, endDate, unit: 'meter', includeManuallyAdded: false, ascending: true } as const;
      method.call(healthKit, options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve([]);
          return;
        }
        const aggregated = aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
        resolve(aggregated);
      });
    } catch (_e) {
      resolve([]);
    }
  });
}

export async function getDistanceCyclingHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      const method = healthKit?.getDailyDistanceCyclingSamples ?? healthKit?.getDistanceCycling;
      if (typeof method !== 'function') {
        resolve([]);
        return;
      }
      const { startDate, endDate } = buildRangeOptions(days);
      const options = { startDate, endDate, unit: 'meter', includeManuallyAdded: false, ascending: true } as const;
      method.call(healthKit, options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve([]);
          return;
        }
        const aggregated = aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
        resolve(aggregated);
      });
    } catch (_e) {
      resolve([]);
    }
  });
}

export async function getDistanceSwimmingHistoryAsync(days = 14): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      const method = healthKit?.getDailyDistanceSwimmingSamples ?? healthKit?.getDistanceSwimming;
      if (typeof method !== 'function') {
        resolve([]);
        return;
      }
      const { startDate, endDate } = buildRangeOptions(days);
      const options = { startDate, endDate, unit: 'meter', includeManuallyAdded: false, ascending: true } as const;
      method.call(healthKit, options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve([]);
          return;
        }
        const aggregated = aggregateDaily(results, 'sum', 0).map((p) => ({ ...p, value: Math.max(0, Number(p.value.toFixed(1))) }));
        resolve(aggregated);
      });
    } catch (_e) {
      resolve([]);
    }
  });
}

export async function getStepCountForTodayAsync(): Promise<number> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      const method = healthKit?.getDailyStepCountSamples;
      if (typeof method !== 'function') {
        resolve(0);
        return;
      }
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();

      const options = {
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
        includeManuallyAdded: false,
      } as const;

      method.call(healthKit, options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve(0);
          return;
        }
        const total = results.reduce((sum: number, row: any) => {
          const value = extractSampleValue(row) ?? 0;
          return sum + value;
        }, 0);
        resolve(total);
      });
    } catch (_e) {
      resolve(0);
    }
  });
}

export async function getStepHistoryAsync(days = 7): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getDailyStepCountSamples !== 'function') {
        resolve([]);
        return;
      }

      const range = buildDateRange(days);
      const options = {
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
        includeManuallyAdded: false,
      } as const;

      healthKit.getDailyStepCountSamples(options as any, (_err: any, results: any) => {
        if (!Array.isArray(results)) {
          resolve(ensureContinuousHistory([], range));
          return;
        }

        const mapped = results
          .map((row: any) => {
            const value = extractSampleValue(row) ?? 0;
            const date = normalizeDay(row?.startDate ?? row?.endDate);
            return date ? { date, value } : null;
          })
          .filter((item): item is HealthMetricPoint => Boolean(item));

        resolve(ensureContinuousHistory(mapped, range));
      });
    } catch (_e) {
      resolve([]);
    }
  });
}

export async function getLatestHeartRateAsync(): Promise<{ bpm: number | null; timestamp: number | null }> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getHeartRateSamples !== 'function') {
        resolve({ bpm: null, timestamp: null });
        return;
      }
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 1000 * 60 * 60 * 24); // last 24 hours

      const options = {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        ascending: false,
        limit: 1,
      } as const;

      healthKit.getHeartRateSamples(options as any, (_err: any, results: any) => {
        if (!Array.isArray(results) || results.length === 0) {
          resolve({ bpm: null, timestamp: null });
          return;
        }
        const first = results[0];
        const bpm = extractSampleValue(first);
        const ts = first.endDate ? new Date(first.endDate).getTime() : null;
        resolve({ bpm: bpm ?? null, timestamp: ts });
      });
    } catch (_e) {
      resolve({ bpm: null, timestamp: null });
    }
  });
}

export async function getLatestBodyMassKgAsync(): Promise<{ kg: number | null; timestamp: number | null }> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getLatestWeight !== 'function') {
        resolve({ kg: null, timestamp: null });
        return;
      }
      const options = { unit: 'kg' } as const;
      // @ts-ignore react-native-health type versions can differ
      healthKit.getLatestWeight(options as any, (_err: any, result: any) => {
        if (!result) {
          resolve({ kg: null, timestamp: null });
          return;
        }
        const kg = extractSampleValue(result);
        const ts = result.endDate ? new Date(result.endDate).getTime() : null;
        resolve({ kg: kg ?? null, timestamp: ts });
      });
    } catch (_e) {
      resolve({ kg: null, timestamp: null });
    }
  });
}

export async function getWeightHistoryAsync(days = 7): Promise<HealthMetricPoint[]> {
  return new Promise((resolve) => {
    try {
      const healthKit = getHealthKitModule();
      if (typeof healthKit?.getWeightSamples !== 'function') {
        resolve([]);
        return;
      }

      const range = buildDateRange(days);
      const options = {
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
        unit: 'kg',
        limit: days * 3, // Increased limit to handle more frequent measurements
        ascending: false,
      } as const;

      healthKit.getWeightSamples(options as any, (_err: any, results: any) => {
        if (!Array.isArray(results) || results.length === 0) {
          resolve(ensureContinuousHistory([], range));
          return;
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

        resolve(ensureContinuousHistory(mapped, range));
      });
    } catch (_e) {
      resolve([]);
    }
  });
}
