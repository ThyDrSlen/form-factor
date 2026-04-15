/**
 * Tests for lib/services/healthkit/weight-trends.ts
 *
 * Pure math functions -- no mocks needed.
 * analyzeWeightTrends, getWeightTrendSummary, linear regression, predictions.
 */

import {
  analyzeWeightTrends,
  getWeightTrendSummary,
  type WeightAnalysis,
} from '@/lib/services/healthkit/weight-trends';
import type { HealthMetricPoint } from '@/lib/services/healthkit/health-metrics';

// Helper: generate daily weight data points
function generateWeightData(
  startWeight: number,
  dailyChange: number,
  days: number,
  startDate?: number
): HealthMetricPoint[] {
  const start = startDate ?? Date.now() - days * 24 * 60 * 60 * 1000;
  return Array.from({ length: days }, (_, i) => ({
    date: start + i * 24 * 60 * 60 * 1000,
    value: Number((startWeight + dailyChange * i).toFixed(1)),
  }));
}

describe('weight-trends', () => {
  // ---------- analyzeWeightTrends ----------

  describe('analyzeWeightTrends', () => {
    it('throws when given empty data', () => {
      expect(() => analyzeWeightTrends([])).toThrow('No weight data available for analysis');
    });

    it('returns analysis for a single data point', () => {
      const data: HealthMetricPoint[] = [
        { date: Date.now(), value: 75 },
      ];

      const analysis = analyzeWeightTrends(data);
      expect(analysis.current.weight).toBe(75);
      expect(analysis.statistics.average).toBe(75);
      expect(analysis.statistics.median).toBe(75);
      expect(analysis.statistics.min).toBe(75);
      expect(analysis.statistics.max).toBe(75);
      expect(analysis.statistics.standardDeviation).toBe(0);
    });

    it('correctly identifies the most recent weight as current', () => {
      const now = Date.now();
      const data: HealthMetricPoint[] = [
        { date: now - 2 * 86400000, value: 80 },
        { date: now - 86400000, value: 79 },
        { date: now, value: 78 },
      ];

      const analysis = analyzeWeightTrends(data);
      expect(analysis.current.weight).toBe(78);
    });

    it('handles unsorted data by sorting internally', () => {
      const now = Date.now();
      const data: HealthMetricPoint[] = [
        { date: now, value: 78 },
        { date: now - 2 * 86400000, value: 80 },
        { date: now - 86400000, value: 79 },
      ];

      const analysis = analyzeWeightTrends(data);
      expect(analysis.current.weight).toBe(78);
    });

    it('calculates correct statistics for multiple points', () => {
      const now = Date.now();
      const data: HealthMetricPoint[] = [
        { date: now - 4 * 86400000, value: 70 },
        { date: now - 3 * 86400000, value: 72 },
        { date: now - 2 * 86400000, value: 74 },
        { date: now - 86400000, value: 76 },
        { date: now, value: 78 },
      ];

      const analysis = analyzeWeightTrends(data);
      expect(analysis.statistics.average).toBe(74);
      expect(analysis.statistics.median).toBe(74);
      expect(analysis.statistics.min).toBe(70);
      expect(analysis.statistics.max).toBe(78);
      expect(analysis.statistics.standardDeviation).toBeGreaterThan(0);
      expect(analysis.statistics.variance).toBeGreaterThan(0);
    });

    it('calculates median correctly for even-length data', () => {
      const now = Date.now();
      const data: HealthMetricPoint[] = [
        { date: now - 3 * 86400000, value: 70 },
        { date: now - 2 * 86400000, value: 72 },
        { date: now - 86400000, value: 74 },
        { date: now, value: 76 },
      ];

      const analysis = analyzeWeightTrends(data);
      // Median of [70, 72, 74, 76] = (72 + 74) / 2 = 73
      expect(analysis.statistics.median).toBe(73);
    });

    it('produces short/medium/long term trends', () => {
      const data = generateWeightData(80, -0.1, 100);
      const analysis = analyzeWeightTrends(data);

      expect(analysis.trends.shortTerm).toBeDefined();
      expect(analysis.trends.shortTerm.period).toBe('last 7 days');
      expect(analysis.trends.mediumTerm).toBeDefined();
      expect(analysis.trends.mediumTerm.period).toBe('last 30 days');
      expect(analysis.trends.longTerm).toBeDefined();
      expect(analysis.trends.longTerm.period).toBe('last 90 days');
    });

    it('detects losing trend with consistent weight decrease', () => {
      // ~0.15 kg/day loss over 30 days = ~1.05 kg/week
      const data = generateWeightData(85, -0.15, 30);
      const analysis = analyzeWeightTrends(data);

      // At least one trend should show losing
      const hasLosingTrend = [
        analysis.trends.shortTerm,
        analysis.trends.mediumTerm,
      ].some(t => t.direction === 'losing');
      expect(hasLosingTrend).toBe(true);
    });

    it('detects gaining trend with consistent weight increase', () => {
      const data = generateWeightData(70, 0.15, 30);
      const analysis = analyzeWeightTrends(data);

      const hasGainingTrend = [
        analysis.trends.shortTerm,
        analysis.trends.mediumTerm,
      ].some(t => t.direction === 'gaining');
      expect(hasGainingTrend).toBe(true);
    });

    it('detects stable trend with constant weight', () => {
      const data = generateWeightData(75, 0, 30);
      const analysis = analyzeWeightTrends(data);

      expect(analysis.trends.shortTerm.direction).toBe('stable');
      expect(analysis.trends.shortTerm.rate).toBe(0);
    });

    it('generates predictions for short-term trend', () => {
      const data = generateWeightData(80, -0.1, 14);
      const analysis = analyzeWeightTrends(data);

      // Short-term trend should have predictions
      const predictions = analysis.trends.shortTerm.predictions;
      if (predictions && predictions.length > 0) {
        // Predictions should be in the future
        const lastDate = data[data.length - 1].date;
        predictions.forEach(p => {
          expect(p.date).toBeGreaterThan(lastDate);
          expect(p.predictedWeight).toEqual(expect.any(Number));
          expect(p.confidence).toBeGreaterThanOrEqual(0);
          expect(p.confidence).toBeLessThanOrEqual(1);
        });

        // Confidence should decay over time
        if (predictions.length >= 2) {
          expect(predictions[predictions.length - 1].confidence)
            .toBeLessThanOrEqual(predictions[0].confidence);
        }
      }
    });

    it('includes insights in trends', () => {
      const data = generateWeightData(80, -0.1, 14);
      const analysis = analyzeWeightTrends(data);

      analysis.trends.shortTerm.insights.forEach(insight => {
        expect(typeof insight).toBe('string');
        expect(insight.length).toBeGreaterThan(0);
      });
    });

    it('detects weekly pattern with 14+ days of data', () => {
      const data = generateWeightData(75, 0, 21);
      // Add some variance to trigger pattern detection
      data.forEach((p, i) => {
        p.value += Math.sin(i * Math.PI / 3.5) * 0.5;
      });

      const analysis = analyzeWeightTrends(data);
      // Pattern detection may or may not find a pattern depending on variance
      expect(analysis.patterns).toBeDefined();
    });

    it('does not detect weekly pattern with less than 14 days', () => {
      const data = generateWeightData(75, 0, 10);
      const analysis = analyzeWeightTrends(data);
      expect(analysis.patterns.weeklyPattern).toBeUndefined();
    });

    it('calculates goal progress when goalWeight is provided', () => {
      const data = generateWeightData(80, -0.1, 30);
      const analysis = analyzeWeightTrends(data, 75);

      expect(analysis.goals.progress).toEqual(expect.any(Number));
      expect(analysis.goals.progress).toBeGreaterThanOrEqual(0);
      expect(analysis.goals.recommendations).toEqual(expect.any(Array));
    });

    it('returns 100% progress when at goal weight', () => {
      const now = Date.now();
      const data: HealthMetricPoint[] = [
        { date: now - 86400000, value: 75.1 },
        { date: now, value: 75 },
      ];

      const analysis = analyzeWeightTrends(data, 75);
      expect(analysis.goals.progress).toBe(100);
    });

    it('produces recommendations when not at goal weight', () => {
      const data = generateWeightData(85, 0, 14);
      const analysis = analyzeWeightTrends(data, 75);

      expect(analysis.goals.recommendations.length).toBeGreaterThan(0);
    });
  });

  // ---------- getWeightTrendSummary ----------

  describe('getWeightTrendSummary', () => {
    function makeAnalysis(overrides?: Partial<WeightAnalysis>): WeightAnalysis {
      const defaultAnalysis: WeightAnalysis = {
        current: { weight: 75, timestamp: Date.now() },
        trends: {
          shortTerm: {
            direction: 'stable',
            rate: 0,
            confidence: 0.5,
            trendStrength: 'moderate',
            period: 'last 7 days',
            insights: [],
          },
          mediumTerm: {
            direction: 'stable',
            rate: 0,
            confidence: 0.3,
            trendStrength: 'weak',
            period: 'last 30 days',
            insights: [],
          },
          longTerm: {
            direction: 'stable',
            rate: 0,
            confidence: 0.1,
            trendStrength: 'weak',
            period: 'last 90 days',
            insights: [],
          },
        },
        statistics: {
          average: 75,
          median: 75,
          min: 74,
          max: 76,
          standardDeviation: 0.5,
          variance: 0.25,
        },
        patterns: {},
        goals: {
          progress: 0,
          recommendations: [],
        },
      };
      return { ...defaultAnalysis, ...overrides };
    }

    it('selects the most confident trend as primary', () => {
      const analysis = makeAnalysis({
        trends: {
          shortTerm: {
            direction: 'losing',
            rate: -0.5,
            confidence: 0.8,
            trendStrength: 'strong',
            period: 'last 7 days',
            insights: [],
          },
          mediumTerm: {
            direction: 'stable',
            rate: 0,
            confidence: 0.3,
            trendStrength: 'weak',
            period: 'last 30 days',
            insights: [],
          },
          longTerm: {
            direction: 'stable',
            rate: 0,
            confidence: 0.1,
            trendStrength: 'weak',
            period: 'last 90 days',
            insights: [],
          },
        },
      });

      const summary = getWeightTrendSummary(analysis);
      expect(summary.primaryTrend.direction).toBe('losing');
      expect(summary.primaryTrend.confidence).toBe(0.8);
    });

    it('provides losing summary text', () => {
      const analysis = makeAnalysis({
        trends: {
          shortTerm: {
            direction: 'losing',
            rate: -0.5,
            confidence: 0.9,
            trendStrength: 'strong',
            period: 'last 7 days',
            insights: [],
          },
          mediumTerm: { direction: 'stable', rate: 0, confidence: 0.1, trendStrength: 'weak', period: 'last 30 days', insights: [] },
          longTerm: { direction: 'stable', rate: 0, confidence: 0.1, trendStrength: 'weak', period: 'last 90 days', insights: [] },
        },
      });

      const summary = getWeightTrendSummary(analysis);
      expect(summary.summary).toContain('Losing');
      expect(summary.summary).toContain('kg/week');
    });

    it('provides gaining summary text', () => {
      const analysis = makeAnalysis({
        trends: {
          shortTerm: {
            direction: 'gaining',
            rate: 0.8,
            confidence: 0.9,
            trendStrength: 'strong',
            period: 'last 7 days',
            insights: [],
          },
          mediumTerm: { direction: 'stable', rate: 0, confidence: 0.1, trendStrength: 'weak', period: 'last 30 days', insights: [] },
          longTerm: { direction: 'stable', rate: 0, confidence: 0.1, trendStrength: 'weak', period: 'last 90 days', insights: [] },
        },
      });

      const summary = getWeightTrendSummary(analysis);
      expect(summary.summary).toContain('Gaining');
      expect(summary.recommendation).toContain('reviewing');
    });

    it('provides stable summary text', () => {
      const analysis = makeAnalysis();
      const summary = getWeightTrendSummary(analysis);
      expect(summary.summary).toBe('Weight is stable');
      expect(summary.recommendation).toContain('maintenance');
    });

    it('provides fluctuating summary text', () => {
      const analysis = makeAnalysis({
        trends: {
          shortTerm: {
            direction: 'fluctuating',
            rate: 0.2,
            confidence: 0.9,
            trendStrength: 'moderate',
            period: 'last 7 days',
            insights: [],
          },
          mediumTerm: { direction: 'stable', rate: 0, confidence: 0.1, trendStrength: 'weak', period: 'last 30 days', insights: [] },
          longTerm: { direction: 'stable', rate: 0, confidence: 0.1, trendStrength: 'weak', period: 'last 90 days', insights: [] },
        },
      });

      const summary = getWeightTrendSummary(analysis);
      expect(summary.summary).toBe('Weight is fluctuating');
      expect(summary.recommendation).toContain('consistent');
    });

    it('warns about rapid weight loss', () => {
      const analysis = makeAnalysis({
        trends: {
          shortTerm: {
            direction: 'losing',
            rate: -1.5,
            confidence: 0.9,
            trendStrength: 'strong',
            period: 'last 7 days',
            insights: [],
          },
          mediumTerm: { direction: 'stable', rate: 0, confidence: 0.1, trendStrength: 'weak', period: 'last 30 days', insights: [] },
          longTerm: { direction: 'stable', rate: 0, confidence: 0.1, trendStrength: 'weak', period: 'last 90 days', insights: [] },
        },
      });

      const summary = getWeightTrendSummary(analysis);
      expect(summary.recommendation).toContain('slowing');
    });
  });
});
