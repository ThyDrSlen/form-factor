import { supabase } from '@/lib/supabase';
import {
  calculateRepFqiTrend,
  calculateTempoStability,
  getSymmetryTrend,
  getFaultHeatmap,
  getRepCueAdoptionStats,
} from '@/lib/services/rep-analytics';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const mockFrom = supabase.from as jest.Mock;

function createMockQuery(data: any, error: any = null) {
  const resolved = { data, error };
  const query: Record<string, any> = {};
  ['select', 'eq', 'lt', 'gte', 'order', 'limit'].forEach((method) => {
    query[method] = jest.fn().mockReturnValue(query);
  });
  Object.defineProperty(query, 'then', {
    value: (onFulfilled: any, onRejected?: any) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
  });
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// calculateRepFqiTrend
// =============================================================================

describe('calculateRepFqiTrend', () => {
  it('returns empty shape when exerciseId is blank or invalid days', async () => {
    const none = await calculateRepFqiTrend('', 30);
    expect(none).toEqual({ slope: null, rSquared: null, avgFqi: null, dataPoints: [] });

    const badDays = await calculateRepFqiTrend('squat', 0);
    expect(badDays).toEqual({ slope: null, rSquared: null, avgFqi: null, dataPoints: [] });

    const nanDays = await calculateRepFqiTrend('squat', Number.NaN);
    expect(nanDays).toEqual({ slope: null, rSquared: null, avgFqi: null, dataPoints: [] });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('computes a positive slope for improving FQI over time', async () => {
    const rows = [
      { fqi: 60, start_ts: '2026-04-01T00:00:00.000Z' },
      { fqi: 70, start_ts: '2026-04-05T00:00:00.000Z' },
      { fqi: 80, start_ts: '2026-04-09T00:00:00.000Z' },
      { fqi: 90, start_ts: '2026-04-13T00:00:00.000Z' },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await calculateRepFqiTrend('squat', 30);

    expect(mockFrom).toHaveBeenCalledWith('reps');
    expect(result.dataPoints).toHaveLength(4);
    expect(result.avgFqi).toBeCloseTo(75, 2);
    expect(result.slope).not.toBeNull();
    expect(result.slope!).toBeGreaterThan(0);
    expect(result.rSquared).not.toBeNull();
    expect(result.rSquared!).toBeCloseTo(1, 2);
  });

  it('returns single data point without slope when only one rep exists', async () => {
    mockFrom.mockReturnValue(createMockQuery([{ fqi: 75, start_ts: '2026-04-10T00:00:00.000Z' }]));

    const result = await calculateRepFqiTrend('squat', 30);

    expect(result.dataPoints).toHaveLength(1);
    expect(result.avgFqi).toBe(75);
    expect(result.slope).toBeNull();
    expect(result.rSquared).toBeNull();
  });

  it('filters out NaN / null FQI values', async () => {
    const rows = [
      { fqi: 80, start_ts: '2026-04-01T00:00:00.000Z' },
      { fqi: null, start_ts: '2026-04-02T00:00:00.000Z' },
      { fqi: Number.NaN, start_ts: '2026-04-03T00:00:00.000Z' },
      { fqi: 90, start_ts: '2026-04-04T00:00:00.000Z' },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await calculateRepFqiTrend('squat', 30);
    expect(result.dataPoints).toHaveLength(2);
    expect(result.avgFqi).toBe(85);
  });

  it('returns empty shape on supabase error', async () => {
    mockFrom.mockReturnValue(createMockQuery(null, new Error('network')));
    const result = await calculateRepFqiTrend('squat', 30);
    expect(result.dataPoints).toHaveLength(0);
    expect(result.slope).toBeNull();
    expect(result.avgFqi).toBeNull();
  });
});

// =============================================================================
// calculateTempoStability
// =============================================================================

describe('calculateTempoStability', () => {
  it('computes mean, stdDev and coefficient of variation', async () => {
    const rows = [
      { start_ts: '2026-04-01T00:00:00.000Z', end_ts: '2026-04-01T00:00:02.000Z' }, // 2000
      { start_ts: '2026-04-01T00:01:00.000Z', end_ts: '2026-04-01T00:01:02.500Z' }, // 2500
      { start_ts: '2026-04-01T00:02:00.000Z', end_ts: '2026-04-01T00:02:02.200Z' }, // 2200
      { start_ts: '2026-04-01T00:03:00.000Z', end_ts: '2026-04-01T00:03:02.300Z' }, // 2300
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await calculateTempoStability('squat', 4);

    expect(mockFrom).toHaveBeenCalledWith('reps');
    expect(result.avgDurationMs).toBe(2250);
    expect(result.stdDev).not.toBeNull();
    expect(result.stdDev!).toBeGreaterThan(0);
    expect(result.coefficientOfVariation).not.toBeNull();
    expect(result.coefficientOfVariation!).toBeCloseTo(result.stdDev! / result.avgDurationMs!, 3);
    expect(['improving', 'declining', 'stable', 'unknown']).toContain(result.trend);
  });

  it('returns empty shape when no rep durations', async () => {
    mockFrom.mockReturnValue(createMockQuery([]));
    const result = await calculateTempoStability('squat', 4);
    expect(result).toEqual({
      avgDurationMs: null,
      stdDev: null,
      coefficientOfVariation: null,
      trend: 'unknown',
    });
  });

  it('filters out zero-duration reps', async () => {
    const rows = [
      { start_ts: '2026-04-01T00:00:00.000Z', end_ts: '2026-04-01T00:00:00.000Z' }, // 0ms
      { start_ts: '2026-04-01T00:01:00.000Z', end_ts: '2026-04-01T00:00:59.000Z' }, // negative
      { start_ts: '2026-04-01T00:02:00.000Z', end_ts: '2026-04-01T00:02:01.500Z' }, // 1500
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await calculateTempoStability('squat', 4);
    expect(result.avgDurationMs).toBe(1500);
  });
});

// =============================================================================
// getSymmetryTrend
// =============================================================================

describe('getSymmetryTrend', () => {
  it('computes asymmetry ratio from left vs right ROM', async () => {
    const rows = [
      { side: 'left', features: { romDeg: 120 }, start_ts: '2026-04-01T00:00:00.000Z' },
      { side: 'right', features: { romDeg: 100 }, start_ts: '2026-04-01T00:00:30.000Z' },
      { side: 'left', features: { romDeg: 118 }, start_ts: '2026-04-02T00:00:00.000Z' },
      { side: 'right', features: { romDeg: 102 }, start_ts: '2026-04-02T00:00:30.000Z' },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await getSymmetryTrend('pullup', 30);

    expect(result.leftAvgRom).toBeCloseTo(119, 1);
    expect(result.rightAvgRom).toBeCloseTo(101, 1);
    expect(result.asymmetryRatio).toBeCloseTo(18 / 119, 3);
  });

  it('returns null asymmetry ratio when one side has no data', async () => {
    const rows = [
      { side: 'left', features: { romDeg: 120 }, start_ts: '2026-04-01T00:00:00.000Z' },
      { side: 'left', features: { romDeg: 118 }, start_ts: '2026-04-02T00:00:00.000Z' },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await getSymmetryTrend('pullup', 30);

    expect(result.leftAvgRom).toBe(119);
    expect(result.rightAvgRom).toBeNull();
    expect(result.asymmetryRatio).toBeNull();
    expect(result.trend).toBe('unknown');
  });

  it('returns empty shape when ROM is 0 / missing in features', async () => {
    const rows = [
      { side: 'left', features: { romDeg: 0 }, start_ts: '2026-04-01T00:00:00.000Z' },
      { side: 'right', features: { romDeg: 0 }, start_ts: '2026-04-01T00:00:30.000Z' },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await getSymmetryTrend('pullup', 30);
    // Both sides have mean 0, so denom is 0 -> ratio null
    expect(result.asymmetryRatio).toBeNull();
  });

  it('detects worsening trend when second half is more asymmetric', async () => {
    const rows = [
      { side: 'left', features: { romDeg: 100 }, start_ts: '2026-04-01T00:00:00.000Z' },
      { side: 'right', features: { romDeg: 99 }, start_ts: '2026-04-01T00:00:30.000Z' },
      { side: 'left', features: { romDeg: 100 }, start_ts: '2026-04-02T00:00:00.000Z' },
      { side: 'right', features: { romDeg: 99 }, start_ts: '2026-04-02T00:00:30.000Z' },
      { side: 'left', features: { romDeg: 120 }, start_ts: '2026-04-09T00:00:00.000Z' },
      { side: 'right', features: { romDeg: 80 }, start_ts: '2026-04-09T00:00:30.000Z' },
      { side: 'left', features: { romDeg: 120 }, start_ts: '2026-04-10T00:00:00.000Z' },
      { side: 'right', features: { romDeg: 80 }, start_ts: '2026-04-10T00:00:30.000Z' },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await getSymmetryTrend('pullup', 30);

    expect(result.trend).toBe('worsening');
  });
});

// =============================================================================
// getFaultHeatmap
// =============================================================================

describe('getFaultHeatmap', () => {
  it('aggregates fault counts and severities across reps, sorted by count', async () => {
    const rows = [
      { faults_detected: ['valgus_collapse', 'shallow_depth'] },
      { faults_detected: ['valgus_collapse'] },
      { faults_detected: ['shallow_depth', 'forward_lean'] },
      { faults_detected: [] },
      { faults_detected: null },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await getFaultHeatmap({ sessionId: 'sess-1' });

    expect(mockFrom).toHaveBeenCalledWith('reps');
    expect(result).toHaveLength(3);
    // sorted by count desc
    expect(result[0].faultId).toBe('valgus_collapse');
    expect(result[0].count).toBe(2);
    // 'valgus_collapse' matches major pattern => severity 2
    expect(result[0].severityAvg).toBe(2);
    // 'shallow_depth' matches moderate pattern => severity 1
    expect(result.find((e) => e.faultId === 'shallow_depth')?.severityAvg).toBe(1);
  });

  it('returns empty array when nothing matches', async () => {
    mockFrom.mockReturnValue(createMockQuery([]));
    const result = await getFaultHeatmap({ days: 30 });
    expect(result).toEqual([]);
  });
});

// =============================================================================
// getRepCueAdoptionStats
// =============================================================================

describe('getRepCueAdoptionStats', () => {
  it('computes adoption rate and ranks cue types by adoption', async () => {
    const rows = [
      {
        cues_emitted: [{ type: 'knee_push' }, { type: 'chest_up' }],
        adopted_within_3_reps: true,
      },
      {
        cues_emitted: [{ type: 'knee_push' }],
        adopted_within_3_reps: true,
      },
      {
        cues_emitted: [{ type: 'chest_up' }],
        adopted_within_3_reps: false,
      },
      {
        cues_emitted: [],
        adopted_within_3_reps: null,
      },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await getRepCueAdoptionStats('squat', 30);

    expect(mockFrom).toHaveBeenCalledWith('reps');
    expect(result.totalCuesEmitted).toBe(4);
    // 2 reps with cues adopted out of 3 reps-with-cues => 0.6667
    expect(result.adoptionRate).toBeCloseTo(2 / 3, 3);
    expect(result.mostAdopted).toBe('knee_push');
    expect(result.leastAdopted).toBe('chest_up');
  });

  it('returns empty shape when no cues were emitted', async () => {
    const rows = [
      { cues_emitted: [], adopted_within_3_reps: null },
      { cues_emitted: null, adopted_within_3_reps: null },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await getRepCueAdoptionStats('squat', 30);
    expect(result).toEqual({
      totalCuesEmitted: 0,
      adoptionRate: null,
      mostAdopted: null,
      leastAdopted: null,
    });
  });
});
