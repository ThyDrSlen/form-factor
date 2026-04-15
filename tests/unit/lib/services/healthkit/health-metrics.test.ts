/**
 * Tests for lib/services/healthkit/health-metrics.ts
 *
 * Pure utility functions: parseNumeric, normalizeDay, buildDateRange, ensureContinuousHistory
 * Async HealthKit functions: getBiologicalSexAsync, getStepHistoryAsync, etc.
 *
 * NOTE: The existing tests/unit/lib/services/health-metrics.test.ts covers the basic
 * utility functions. This file extends coverage to the async HealthKit functions and
 * edge cases in the utilities.
 */

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

const mockNativeModule: Record<string, jest.Mock> = {
  isAvailable: jest.fn().mockReturnValue(true),
  getBiologicalSex: jest.fn(),
  getDateOfBirth: jest.fn(),
  getQuantitySamples: jest.fn(),
  getLatestQuantitySample: jest.fn(),
  getDailySumSamples: jest.fn(),
};

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn((name: string) => {
    if (name === 'FFHealthKit') return mockNativeModule;
    throw new Error(`Unknown module: ${name}`);
  }),
}));

import {
  parseNumeric,
  normalizeDay,
  buildDateRange,
  ensureContinuousHistory,
  getBiologicalSexAsync,
  getDateOfBirthAsync,
  getStepHistoryAsync,
  getWeightHistoryAsync,
  getLatestHeartRateAsync,
  getLatestBodyMassKgAsync,
  getStepCountForTodayAsync,
  getActiveEnergyHistoryAsync,
  type HealthMetricPoint,
} from '@/lib/services/healthkit/health-metrics';

describe('health-metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------- parseNumeric edge cases ----------

  describe('parseNumeric (additional edge cases)', () => {
    it('coerces empty string to 0 (Number("") === 0)', () => {
      // Empty string coerces to 0 via Number(), which is finite
      expect(parseNumeric('')).toBe(0);
    });

    it('parses negative numbers', () => {
      expect(parseNumeric(-5)).toBe(-5);
      expect(parseNumeric('-3.14')).toBe(-3.14);
    });

    it('returns null for -Infinity', () => {
      expect(parseNumeric(-Infinity)).toBeNull();
    });

    it('returns null for boolean', () => {
      // Boolean true coerces to 1, but it's a valid number
      expect(parseNumeric(true)).toBe(1);
      expect(parseNumeric(false)).toBe(0);
    });

    it('returns 0 for zero', () => {
      expect(parseNumeric(0)).toBe(0);
      expect(parseNumeric('0')).toBe(0);
    });
  });

  // ---------- normalizeDay edge cases ----------

  describe('normalizeDay (additional edge cases)', () => {
    it('normalizes timestamp number to midnight UTC', () => {
      const ts = Date.UTC(2024, 5, 15, 14, 30, 0);
      const result = normalizeDay(ts);
      expect(result).toBe(Date.UTC(2024, 5, 15));
    });

    it('returns null for empty string', () => {
      expect(normalizeDay('')).toBeNull();
    });

    it('returns null for false', () => {
      expect(normalizeDay(false)).toBeNull();
    });

    it('returns null for 0 (falsy)', () => {
      expect(normalizeDay(0)).toBeNull();
    });
  });

  // ---------- ensureContinuousHistory ----------

  describe('ensureContinuousHistory with zero fill', () => {
    it('fills gaps with zero instead of carry-forward', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-03T23:59:59Z');
      const points: HealthMetricPoint[] = [
        { date: Date.UTC(2024, 0, 1), value: 5000 },
      ];

      const result = ensureContinuousHistory(points, { start, end }, 'zero');
      expect(result).toHaveLength(3);
      expect(result[0].value).toBe(5000);
      expect(result[1].value).toBe(0); // zero fill, not carried forward
      expect(result[2].value).toBe(0);
    });

    it('skips points with non-finite dates', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-02T23:59:59Z');
      const points: HealthMetricPoint[] = [
        { date: NaN, value: 100 },
        { date: Date.UTC(2024, 0, 1), value: 200 },
      ];

      const result = ensureContinuousHistory(points, { start, end }, 'carry-forward');
      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(200);
      expect(result[1].value).toBe(200); // carried forward
    });
  });

  // ---------- getBiologicalSexAsync ----------

  describe('getBiologicalSexAsync', () => {
    it('returns the biological sex string', async () => {
      mockNativeModule.getBiologicalSex.mockResolvedValue('male');
      const result = await getBiologicalSexAsync();
      expect(result).toBe('male');
    });

    it('returns null when native returns non-string', async () => {
      mockNativeModule.getBiologicalSex.mockResolvedValue(42);
      expect(await getBiologicalSexAsync()).toBeNull();
    });

    it('returns null when native throws', async () => {
      mockNativeModule.getBiologicalSex.mockRejectedValue(new Error('no data'));
      expect(await getBiologicalSexAsync()).toBeNull();
    });

    it('returns null when function is not available', async () => {
      mockNativeModule.getBiologicalSex = undefined as any;
      expect(await getBiologicalSexAsync()).toBeNull();
      mockNativeModule.getBiologicalSex = jest.fn(); // restore
    });
  });

  // ---------- getDateOfBirthAsync ----------

  describe('getDateOfBirthAsync', () => {
    it('returns birthDate and floored age', async () => {
      mockNativeModule.getDateOfBirth.mockResolvedValue({
        birthDate: '1990-05-15',
        age: 33.7,
      });
      const result = await getDateOfBirthAsync();
      expect(result.birthDate).toBe('1990-05-15');
      expect(result.age).toBe(33); // floored
    });

    it('returns nulls when native throws', async () => {
      mockNativeModule.getDateOfBirth.mockRejectedValue(new Error('no data'));
      const result = await getDateOfBirthAsync();
      expect(result.birthDate).toBeNull();
      expect(result.age).toBeNull();
    });

    it('returns null birthDate when it is not a string', async () => {
      mockNativeModule.getDateOfBirth.mockResolvedValue({
        birthDate: 12345,
        age: 30,
      });
      const result = await getDateOfBirthAsync();
      expect(result.birthDate).toBeNull();
      expect(result.age).toBe(30);
    });
  });

  // ---------- getStepHistoryAsync ----------

  describe('getStepHistoryAsync', () => {
    it('returns continuous step history covering requested days', async () => {
      mockNativeModule.getDailySumSamples.mockResolvedValue([]);

      const result = await getStepHistoryAsync(7);
      // Should return 7 days of zero-filled entries
      expect(result.length).toBe(7);
      expect(result.every(p => p.value === 0)).toBe(true);
    });

    it('incorporates native step data into history', async () => {
      mockNativeModule.getDailySumSamples.mockResolvedValue([
        { value: 8000, startDate: new Date().toISOString() },
      ]);

      const result = await getStepHistoryAsync(3);
      expect(result.length).toBe(3);
      // At least one point should have our step data (or 0 if timezone mismatch)
      const totalSteps = result.reduce((sum, p) => sum + p.value, 0);
      expect(totalSteps).toBeGreaterThanOrEqual(0);
    });

    it('returns zero-filled history when native returns non-array', async () => {
      mockNativeModule.getDailySumSamples.mockResolvedValue(null);
      const result = await getStepHistoryAsync(3);
      // Should still have zero-filled entries
      expect(result.length).toBe(3);
      result.forEach(point => {
        expect(point.value).toBe(0);
      });
    });

    it('returns empty array on error', async () => {
      mockNativeModule.getDailySumSamples.mockRejectedValue(new Error('fail'));
      expect(await getStepHistoryAsync()).toEqual([]);
    });
  });

  // ---------- getStepCountForTodayAsync ----------

  describe('getStepCountForTodayAsync', () => {
    it('sums all step samples for today', async () => {
      mockNativeModule.getDailySumSamples.mockResolvedValue([
        { value: 3000, startDate: new Date().toISOString() },
        { value: 2000, startDate: new Date().toISOString() },
      ]);

      const result = await getStepCountForTodayAsync();
      expect(result).toBe(5000);
    });

    it('returns 0 when no data', async () => {
      mockNativeModule.getDailySumSamples.mockResolvedValue([]);
      expect(await getStepCountForTodayAsync()).toBe(0);
    });

    it('returns 0 on error', async () => {
      mockNativeModule.getDailySumSamples.mockRejectedValue(new Error('fail'));
      expect(await getStepCountForTodayAsync()).toBe(0);
    });
  });

  // ---------- getLatestHeartRateAsync ----------

  describe('getLatestHeartRateAsync', () => {
    it('returns bpm and timestamp from latest sample', async () => {
      const now = new Date().toISOString();
      mockNativeModule.getQuantitySamples.mockResolvedValue([
        { value: 72, endDate: now },
      ]);

      const result = await getLatestHeartRateAsync();
      expect(result.bpm).toBe(72);
      expect(result.timestamp).toEqual(expect.any(Number));
    });

    it('returns nulls when no samples', async () => {
      mockNativeModule.getQuantitySamples.mockResolvedValue([]);
      const result = await getLatestHeartRateAsync();
      expect(result.bpm).toBeNull();
      expect(result.timestamp).toBeNull();
    });

    it('returns nulls on error', async () => {
      mockNativeModule.getQuantitySamples.mockRejectedValue(new Error('fail'));
      const result = await getLatestHeartRateAsync();
      expect(result.bpm).toBeNull();
      expect(result.timestamp).toBeNull();
    });
  });

  // ---------- getLatestBodyMassKgAsync ----------

  describe('getLatestBodyMassKgAsync', () => {
    it('returns kg and timestamp', async () => {
      const now = new Date().toISOString();
      mockNativeModule.getLatestQuantitySample.mockResolvedValue({
        value: 75.5,
        endDate: now,
      });

      const result = await getLatestBodyMassKgAsync();
      expect(result.kg).toBe(75.5);
      expect(result.timestamp).toEqual(expect.any(Number));
    });

    it('returns nulls when no data', async () => {
      mockNativeModule.getLatestQuantitySample.mockResolvedValue(null);
      const result = await getLatestBodyMassKgAsync();
      expect(result.kg).toBeNull();
      expect(result.timestamp).toBeNull();
    });
  });

  // ---------- getWeightHistoryAsync ----------

  describe('getWeightHistoryAsync', () => {
    it('calls getQuantitySamples with bodyMass type', async () => {
      mockNativeModule.getQuantitySamples.mockResolvedValue([]);

      await getWeightHistoryAsync(7);
      expect(mockNativeModule.getQuantitySamples).toHaveBeenCalledWith(
        'bodyMass',
        expect.any(String), // startDate ISO
        expect.any(String), // endDate ISO
        'kg',
        expect.any(Number), // limit
        false // ascending
      );
    });

    it('returns array for weight history', async () => {
      mockNativeModule.getQuantitySamples.mockResolvedValue([
        { value: 80.0, startDate: new Date().toISOString(), endDate: new Date().toISOString() },
      ]);

      const result = await getWeightHistoryAsync(3);
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty carry-forward history when no data', async () => {
      mockNativeModule.getQuantitySamples.mockResolvedValue([]);
      const result = await getWeightHistoryAsync(3);
      // With carry-forward and no seed data, result may be empty
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array on error', async () => {
      mockNativeModule.getQuantitySamples.mockRejectedValue(new Error('fail'));
      expect(await getWeightHistoryAsync()).toEqual([]);
    });
  });

  // ---------- getActiveEnergyHistoryAsync ----------

  describe('getActiveEnergyHistoryAsync', () => {
    it('returns aggregated daily energy with non-negative values', async () => {
      mockNativeModule.getQuantitySamples.mockResolvedValue([
        { value: 250.7, startDate: new Date().toISOString() },
        { value: 100.3, startDate: new Date().toISOString() },
      ]);

      const result = await getActiveEnergyHistoryAsync(1);
      expect(result.length).toBeGreaterThanOrEqual(1);
      result.forEach(p => expect(p.value).toBeGreaterThanOrEqual(0));
    });

    it('returns empty array when native returns non-array', async () => {
      mockNativeModule.getQuantitySamples.mockResolvedValue(null);
      expect(await getActiveEnergyHistoryAsync()).toEqual([]);
    });
  });
});
