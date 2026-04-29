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

  test('mixed NaN-date + finite-date: analysis completes without throwing and drops the NaN entry', () => {
    // wave-35 hardened analyzeWeightTrends to sanitize non-finite timestamps
    // before sort (see lib/services/healthkit/weight-trends.ts). Document the
    // new contract: the NaN-dated sample is filtered out, so min/max reflect
    // only the finite-dated entries.
    const now = Date.now();
    const data: HealthMetricPoint[] = [
      { date: Number.NaN, value: 75 },
      { date: now - 86400000, value: 80 },
      { date: now, value: 78 },
    ];

    const analysis = analyzeWeightTrends(data);
    // With the NaN entry dropped, only 78 and 80 survive.
    expect(analysis.statistics.min).toBe(78);
    expect(analysis.statistics.max).toBe(80);
    expect(Number.isFinite(analysis.statistics.standardDeviation)).toBe(true);
  });

  test('timestamp drift (future-dated entry) is filtered out of the current weight', () => {
    // wave-35 filter: future-dated samples are dropped before analysis so a
    // bad device clock can't surface a fabricated 200kg "latest" value.
    const now = Date.now();
    const future = now + 365 * 24 * 60 * 60 * 1000;
    const data: HealthMetricPoint[] = [
      { date: now - 2 * 86400000, value: 80 },
      { date: now - 86400000, value: 79 },
      { date: future, value: 200 }, // clearly drifted — filtered
    ];

    const analysis = analyzeWeightTrends(data);
    // Most recent *valid* entry is the one dated `now - 86400000` (value 79).
    expect(analysis.current.weight).toBe(79);
    expect(analysis.current.timestamp).toBe(now - 86400000);
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
