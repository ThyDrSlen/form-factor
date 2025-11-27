import {
  parseNumeric,
  normalizeDay,
  buildDateRange,
  ensureContinuousHistory,
  type HealthMetricPoint,
} from '@/lib/services/healthkit/health-metrics';

describe('health-metrics utilities', () => {
  describe('parseNumeric', () => {

    it('should parse valid numbers', () => {
      expect(parseNumeric(42)).toBe(42);
      expect(parseNumeric(3.14)).toBe(3.14);
      expect(parseNumeric(0)).toBe(0);
    });

    it('should parse numeric strings', () => {
      expect(parseNumeric('42')).toBe(42);
      expect(parseNumeric('3.14')).toBe(3.14);
    });

    it('should return null for invalid values', () => {
      expect(parseNumeric(NaN)).toBeNull();
      expect(parseNumeric(Infinity)).toBeNull();
      expect(parseNumeric('not a number')).toBeNull();
      expect(parseNumeric(undefined)).toBeNull();
      expect(parseNumeric(null)).toBeNull();
    });
  });

  describe('normalizeDay', () => {
    it('should normalize dates to midnight UTC', () => {
      const result = normalizeDay('2024-01-15T14:30:00Z');
      expect(result).toBe(Date.UTC(2024, 0, 15));
    });

    it('should handle Date objects', () => {
      const date = new Date('2024-06-20T10:00:00Z');
      const result = normalizeDay(date);
      expect(result).toBe(Date.UTC(2024, 5, 20));
    });

    it('should return null for invalid dates', () => {
      expect(normalizeDay(null)).toBeNull();
      expect(normalizeDay(undefined)).toBeNull();
      expect(normalizeDay('invalid')).toBeNull();
    });
  });

  describe('buildDateRange', () => {
    it('should return a range spanning the specified days', () => {
      const { start, end } = buildDateRange(7);
      const daysDiff = Math.round(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(daysDiff).toBeGreaterThanOrEqual(6);
      expect(daysDiff).toBeLessThanOrEqual(7);
    });

    it('should set start to beginning of day', () => {
      const { start } = buildDateRange(7);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
    });

    it('should set end to end of day', () => {
      const { end } = buildDateRange(7);
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
    });
  });

  describe('ensureContinuousHistory', () => {
    it('should fill gaps with the last known value', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-03T23:59:59Z');

      const points = [{ date: Date.UTC(2024, 0, 1), value: 150 }];

      const result = ensureContinuousHistory(points, { start, end });

      expect(result.length).toBe(3);
      expect(result[0].value).toBe(150);
      expect(result[1].value).toBe(150); // carried forward
      expect(result[2].value).toBe(150); // carried forward
    });

    it('should update value when new data arrives', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-03T23:59:59Z');

      const points = [
        { date: Date.UTC(2024, 0, 1), value: 150 },
        { date: Date.UTC(2024, 0, 3), value: 148 },
      ];

      const result = ensureContinuousHistory(points, { start, end });

      expect(result[0].value).toBe(150);
      expect(result[1].value).toBe(150); // carried forward
      expect(result[2].value).toBe(148); // new value
    });

    it('should return empty array if no data before range', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-01T23:59:59Z');

      const result = ensureContinuousHistory([], { start, end });

      expect(result.length).toBe(0);
    });
  });
});
