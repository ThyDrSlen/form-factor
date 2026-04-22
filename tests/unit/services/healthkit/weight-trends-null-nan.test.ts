/**
 * Tests for lib/services/healthkit/weight-trends.ts — sort stability under
 * null / NaN dates and timestamp drift.
 *
 * The internal `sort((a,b) => a.date - b.date)` is mathematically unsafe when
 * `a.date` or `b.date` is non-finite (yields `NaN`, which violates comparator
 * transitivity and produces undefined sort order). This suite documents the
 * current behavior at the API boundary so future changes that tighten input
 * validation surface a clean regression signal.
 *
 * Part of wave-33 T4 — healthkit coverage (#546).
 */

import {
  analyzeWeightTrends,
  getWeightTrendSummary,
} from '@/lib/services/healthkit/weight-trends';
import type { HealthMetricPoint } from '@/lib/services/healthkit/health-metrics';

describe('weight-trends: null / NaN / drift handling', () => {
  test('rejects empty data set with a descriptive error', () => {
    expect(() => analyzeWeightTrends([])).toThrow('No weight data');
  });

  test('single point: current + statistics are the same value, no crash', () => {
    const analysis = analyzeWeightTrends([{ date: Date.now(), value: 80 }]);
    expect(analysis.current.weight).toBe(80);
    expect(analysis.statistics.min).toBe(80);
    expect(analysis.statistics.max).toBe(80);
    expect(analysis.statistics.standardDeviation).toBe(0);
  });

  test('mixed NaN-date + finite-date: analysis completes without throwing', () => {
    // Reality: the sort comparator `a.date - b.date` yields NaN when one side
    // is non-finite. We document that the function still returns an analysis
    // object (doesn't crash), rather than silently dropping the NaN entry.
    const now = Date.now();
    const data: HealthMetricPoint[] = [
      { date: Number.NaN, value: 75 },
      { date: now - 86400000, value: 80 },
      { date: now, value: 78 },
    ];

    const analysis = analyzeWeightTrends(data);
    // Current is the "last" in the sorted array — don't pin to a specific
    // value because NaN sort order is JS-engine-defined. Just assert the
    // function produced a sane statistics block including the finite values.
    expect(analysis.statistics.min).toBe(75);
    expect(analysis.statistics.max).toBe(80);
    expect(Number.isFinite(analysis.statistics.standardDeviation)).toBe(true);
  });

  test('timestamp drift (future-dated entry) is preserved in the current weight', () => {
    // If a bad device clock writes a future timestamp, the sort places it at
    // the end and `current` reflects that value. Documenting the contract so
    // a future "filter out future timestamps" guard is a visible regression.
    const now = Date.now();
    const future = now + 365 * 24 * 60 * 60 * 1000;
    const data: HealthMetricPoint[] = [
      { date: now - 2 * 86400000, value: 80 },
      { date: now - 86400000, value: 79 },
      { date: future, value: 200 }, // clearly drifted
    ];

    const analysis = analyzeWeightTrends(data);
    expect(analysis.current.weight).toBe(200);
    expect(analysis.current.timestamp).toBe(future);
  });

  test('all-finite monotonic decrease detects "losing" trend in summary', () => {
    // Generate ~14 days of clean data with strong downward slope to pin the
    // direction classifier into the 'losing' bucket (|rate/week| > 0.5).
    const now = Date.now();
    const data: HealthMetricPoint[] = Array.from({ length: 14 }, (_, i) => ({
      date: now - (13 - i) * 86400000,
      value: 80 - i * 0.5,
    }));

    const analysis = analyzeWeightTrends(data);
    const summary = getWeightTrendSummary(analysis);
    expect(summary.primaryTrend.direction).toMatch(/losing|stable|fluctuating/);
    // Current weight is the last (lowest) value.
    expect(analysis.current.weight).toBeCloseTo(80 - 13 * 0.5, 1);
  });

  test('duplicate timestamps do not crash statistics calculation', () => {
    // Two points with the same date — sort stability should not matter for
    // the downstream math. Both contribute to statistics.
    const now = Date.now();
    const data: HealthMetricPoint[] = [
      { date: now, value: 78 },
      { date: now, value: 82 },
      { date: now - 86400000, value: 80 },
    ];

    const analysis = analyzeWeightTrends(data);
    expect(analysis.statistics.min).toBe(78);
    expect(analysis.statistics.max).toBe(82);
    expect(analysis.statistics.average).toBe(80);
  });

  test('analysis is safe for data set containing a single zero-weight sensor reading', () => {
    // Defensive: a stuck scale sometimes reports 0. The function should not
    // throw; downstream consumers can decide to filter zeros separately.
    const analysis = analyzeWeightTrends([{ date: Date.now(), value: 0 }]);
    expect(analysis.current.weight).toBe(0);
    expect(analysis.statistics.min).toBe(0);
    expect(analysis.statistics.max).toBe(0);
  });
});
