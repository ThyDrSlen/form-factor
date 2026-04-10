/**
 * Tests for lib/services/healthkit/health-aggregation.ts
 *
 * Pure functions: aggregateWeekly, aggregateMonthly, calculatePercentageChange, getComparisonMetrics
 * Async (localDB): fetchDailyHealthMetrics, fetchHealthTrendData -- tested via spyOn
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

import {
  aggregateWeekly,
  aggregateMonthly,
  fetchDailyHealthMetrics,
  fetchHealthTrendData,
  calculatePercentageChange,
  getComparisonMetrics,
  type DailyHealthMetric,
  type AggregatedHealthMetrics,
} from '@/lib/services/healthkit/health-aggregation';
import { localDB } from '@/lib/services/database/local-db';

describe('health-aggregation', () => {
  // ---------- calculatePercentageChange ----------

  describe('calculatePercentageChange', () => {
    it('calculates positive change', () => {
      expect(calculatePercentageChange(110, 100)).toBe(10);
    });

    it('calculates negative change', () => {
      expect(calculatePercentageChange(90, 100)).toBe(-10);
    });

    it('returns null when current is null', () => {
      expect(calculatePercentageChange(null, 100)).toBeNull();
    });

    it('returns null when previous is null', () => {
      expect(calculatePercentageChange(100, null)).toBeNull();
    });

    it('returns null when previous is zero (division by zero)', () => {
      expect(calculatePercentageChange(100, 0)).toBeNull();
    });

    it('returns 0 when both values are equal', () => {
      expect(calculatePercentageChange(100, 100)).toBe(0);
    });

    it('handles decimal values', () => {
      const result = calculatePercentageChange(75.5, 70);
      expect(result).toBeCloseTo(7.9, 0);
    });
  });

  // ---------- aggregateWeekly ----------

  describe('aggregateWeekly', () => {
    it('returns empty array for empty input', () => {
      expect(aggregateWeekly([])).toEqual([]);
    });

    it('groups daily metrics by ISO week (Monday start)', () => {
      // 2024-01-08 is a Monday, 2024-01-14 is a Sunday
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-08', steps: 5000, weightKg: 75, heartRateBpm: 70 },
        { date: '2024-01-09', steps: 6000, weightKg: 75.2, heartRateBpm: 72 },
        { date: '2024-01-10', steps: 4000, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateWeekly(metrics);
      expect(result).toHaveLength(1);
      expect(result[0].period).toBe('2024-01-08');
      expect(result[0].dataPoints).toBe(3);
    });

    it('calculates correct step averages and totals', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-08', steps: 5000, weightKg: null, heartRateBpm: null },
        { date: '2024-01-09', steps: 7000, weightKg: null, heartRateBpm: null },
        { date: '2024-01-10', steps: 6000, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateWeekly(metrics);
      expect(result[0].avgSteps).toBe(6000);
      expect(result[0].totalSteps).toBe(18000);
    });

    it('calculates correct weight stats', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-08', steps: null, weightKg: 75.0, heartRateBpm: null },
        { date: '2024-01-09', steps: null, weightKg: 75.5, heartRateBpm: null },
        { date: '2024-01-10', steps: null, weightKg: 74.5, heartRateBpm: null },
      ];

      const result = aggregateWeekly(metrics);
      expect(result[0].avgWeight).toBe(75);
      expect(result[0].minWeight).toBe(74.5);
      expect(result[0].maxWeight).toBe(75.5);
    });

    it('returns null for metrics with no data', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-08', steps: null, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateWeekly(metrics);
      expect(result[0].avgSteps).toBeNull();
      expect(result[0].totalSteps).toBeNull();
      expect(result[0].avgWeight).toBeNull();
      expect(result[0].avgHeartRate).toBeNull();
    });

    it('separates data into different weeks', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-08', steps: 5000, weightKg: null, heartRateBpm: null },
        { date: '2024-01-15', steps: 7000, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateWeekly(metrics);
      expect(result).toHaveLength(2);
      expect(result[0].period).toBe('2024-01-08');
      expect(result[1].period).toBe('2024-01-15');
    });

    it('sorts result by period', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-15', steps: 7000, weightKg: null, heartRateBpm: null },
        { date: '2024-01-08', steps: 5000, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateWeekly(metrics);
      expect(result[0].period < result[1].period).toBe(true);
    });

    it('handles Sunday correctly (belongs to previous week)', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-08', steps: 5000, weightKg: null, heartRateBpm: null },
        { date: '2024-01-14', steps: 7000, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateWeekly(metrics);
      expect(result).toHaveLength(1);
      expect(result[0].dataPoints).toBe(2);
    });

    it('skips metrics with invalid dates', () => {
      const metrics: DailyHealthMetric[] = [
        { date: 'invalid', steps: 5000, weightKg: null, heartRateBpm: null },
        { date: '2024-01-08', steps: 7000, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateWeekly(metrics);
      expect(result).toHaveLength(1);
      expect(result[0].totalSteps).toBe(7000);
    });
  });

  // ---------- aggregateMonthly ----------

  describe('aggregateMonthly', () => {
    it('returns empty array for empty input', () => {
      expect(aggregateMonthly([])).toEqual([]);
    });

    it('groups metrics by month', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-15', steps: 5000, weightKg: null, heartRateBpm: null },
        { date: '2024-01-20', steps: 6000, weightKg: null, heartRateBpm: null },
        { date: '2024-02-10', steps: 7000, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateMonthly(metrics);
      expect(result).toHaveLength(2);
      expect(result[0].period).toBe('2024-01-01');
      expect(result[0].dataPoints).toBe(2);
      expect(result[1].period).toBe('2024-02-01');
      expect(result[1].dataPoints).toBe(1);
    });

    it('calculates monthly averages', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-01-05', steps: 4000, weightKg: 75, heartRateBpm: 70 },
        { date: '2024-01-15', steps: 6000, weightKg: 76, heartRateBpm: 72 },
      ];

      const result = aggregateMonthly(metrics);
      expect(result[0].avgSteps).toBe(5000);
      expect(result[0].totalSteps).toBe(10000);
      expect(result[0].avgWeight).toBe(75.5);
      expect(result[0].avgHeartRate).toBe(71);
    });

    it('sorts months chronologically', () => {
      const metrics: DailyHealthMetric[] = [
        { date: '2024-03-01', steps: 3000, weightKg: null, heartRateBpm: null },
        { date: '2024-01-01', steps: 1000, weightKg: null, heartRateBpm: null },
        { date: '2024-02-01', steps: 2000, weightKg: null, heartRateBpm: null },
      ];

      const result = aggregateMonthly(metrics);
      expect(result.map(r => r.period)).toEqual(['2024-01-01', '2024-02-01', '2024-03-01']);
    });
  });

  // ---------- getComparisonMetrics ----------

  describe('getComparisonMetrics', () => {
    const makeAggregated = (period: string, avgSteps: number | null, avgWeight: number | null, avgHr: number | null): AggregatedHealthMetrics => ({
      period,
      avgSteps,
      totalSteps: avgSteps ? avgSteps * 7 : null,
      avgWeight,
      minWeight: avgWeight ? avgWeight - 1 : null,
      maxWeight: avgWeight ? avgWeight + 1 : null,
      avgHeartRate: avgHr,
      dataPoints: 7,
    });

    it('returns nulls for empty aggregated data', () => {
      const result = getComparisonMetrics([], 'weekly');
      expect(result.current).toBeNull();
      expect(result.previous).toBeNull();
      expect(result.stepsChange).toBeNull();
      expect(result.weightChange).toBeNull();
      expect(result.heartRateChange).toBeNull();
    });

    it('returns current with no previous for single period', () => {
      const data = [makeAggregated('2024-01-08', 5000, 75, 70)];
      const result = getComparisonMetrics(data, 'weekly');

      expect(result.current).toBeDefined();
      expect(result.previous).toBeNull();
      expect(result.stepsChange).toBeNull();
    });

    it('calculates percentage changes between two periods', () => {
      const data = [
        makeAggregated('2024-01-08', 5000, 75, 70),
        makeAggregated('2024-01-15', 5500, 74.5, 68),
      ];

      const result = getComparisonMetrics(data, 'weekly');
      expect(result.current?.period).toBe('2024-01-15');
      expect(result.previous?.period).toBe('2024-01-08');
      expect(result.stepsChange).toBe(10);
    });

    it('handles null values in comparison', () => {
      const data = [
        makeAggregated('2024-01-08', null, null, null),
        makeAggregated('2024-01-15', 5000, 75, 70),
      ];

      const result = getComparisonMetrics(data, 'weekly');
      expect(result.stepsChange).toBeNull();
      expect(result.weightChange).toBeNull();
    });
  });

  // ---------- fetchDailyHealthMetrics ----------

  describe('fetchDailyHealthMetrics', () => {
    it('returns empty array for empty userId', async () => {
      const result = await fetchDailyHealthMetrics('', new Date(), new Date());
      expect(result).toEqual([]);
    });

    it('fills gaps with defaults when localDB provides data', async () => {
      const start = new Date(2024, 0, 1, 12, 0, 0);
      const end = new Date(2024, 0, 3, 12, 0, 0);

      jest.spyOn(localDB, 'getHealthMetricsForRange').mockResolvedValue([
        { summary_date: '2024-01-02', steps: 5000, weight_kg: 75, heart_rate_bpm: 70 } as any,
      ]);

      const result = await fetchDailyHealthMetrics('user-1', start, end);
      expect(result).toHaveLength(3);
      expect(result[0].steps).toBe(0); // gap filled
      expect(result[1].steps).toBe(5000);
      expect(result[2].steps).toBe(0); // gap filled

      jest.restoreAllMocks();
    });

    it('returns gap-filled nulls for weight and heart rate', async () => {
      const start = new Date(2024, 0, 1, 12, 0, 0);
      const end = new Date(2024, 0, 1, 12, 0, 0);

      jest.spyOn(localDB, 'getHealthMetricsForRange').mockResolvedValue([]);

      const result = await fetchDailyHealthMetrics('user-1', start, end);
      expect(result).toHaveLength(1);
      expect(result[0].steps).toBe(0);
      expect(result[0].weightKg).toBeNull();
      expect(result[0].heartRateBpm).toBeNull();

      jest.restoreAllMocks();
    });

    it('returns empty array on localDB error', async () => {
      jest.spyOn(localDB, 'getHealthMetricsForRange').mockRejectedValue(new Error('db error'));

      const result = await fetchDailyHealthMetrics('user-1', new Date(), new Date());
      expect(result).toEqual([]);

      jest.restoreAllMocks();
    });
  });

  // ---------- fetchHealthTrendData ----------

  describe('fetchHealthTrendData', () => {
    it('returns daily, weekly, and monthly arrays', async () => {
      jest.spyOn(localDB, 'getHealthMetricsForRange').mockResolvedValue([
        { summary_date: '2024-01-08', steps: 5000, weight_kg: 75, heart_rate_bpm: 70 } as any,
      ]);

      const result = await fetchHealthTrendData('user-1', 30);
      expect(result.daily).toEqual(expect.any(Array));
      expect(result.weekly).toEqual(expect.any(Array));
      expect(result.monthly).toEqual(expect.any(Array));

      jest.restoreAllMocks();
    });

    it('returns empty arrays for empty userId', async () => {
      const result = await fetchHealthTrendData('', 30);
      expect(result.daily).toEqual([]);
      expect(result.weekly).toEqual([]);
      expect(result.monthly).toEqual([]);
    });
  });
});
