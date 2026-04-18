/**
 * Unit tests for session-comparison-aggregator.
 * Covers pure helpers (diffFaultIds, classifyTrend, summarizeSessionFromReps)
 * and the main buildSessionComparison function.
 * Fetcher (fetchSessionsForComparison) is tested separately once DB mocks
 * are available — not exercised here since it hits supabase directly.
 */

import {
  buildSessionComparison,
  classifyTrend,
  diffFaultIds,
  summarizeSessionFromReps,
  type ExerciseSessionSummary,
} from '@/lib/services/session-comparison-aggregator';

function summary(overrides: Partial<ExerciseSessionSummary> = {}): ExerciseSessionSummary {
  return {
    sessionId: 'sess_' + (overrides.sessionId ?? 'curr'),
    exerciseId: 'squat',
    completedAt: '2026-04-17T12:00:00.000Z',
    repCount: 10,
    avgFqi: 80,
    avgRomDeg: 100,
    avgDepthRatio: 0.9,
    avgSymmetryDeg: 5,
    faultCounts: {},
    ...overrides,
  };
}

describe('diffFaultIds', () => {
  it('returns empty arrays when both sides are empty', () => {
    expect(diffFaultIds({}, {})).toEqual({ newFaults: [], resolvedFaults: [] });
  });

  it('marks fault only in current as new', () => {
    expect(diffFaultIds({ knee_valgus: 2 }, {})).toEqual({
      newFaults: ['knee_valgus'],
      resolvedFaults: [],
    });
  });

  it('marks fault only in prior as resolved', () => {
    expect(diffFaultIds({}, { shallow_depth: 3 })).toEqual({
      newFaults: [],
      resolvedFaults: ['shallow_depth'],
    });
  });

  it('ignores faults with count 0', () => {
    expect(
      diffFaultIds({ knee_valgus: 0, fast_rep: 1 }, { shallow_depth: 0 }),
    ).toEqual({ newFaults: ['fast_rep'], resolvedFaults: [] });
  });

  it('sorts fault ids alphabetically', () => {
    const result = diffFaultIds(
      { valgus: 1, fast_rep: 1, asymmetric_pull: 1 },
      {},
    );
    expect(result.newFaults).toEqual(['asymmetric_pull', 'fast_rep', 'valgus']);
  });
});

describe('classifyTrend', () => {
  it('returns "unchanged" when all deltas are null or below threshold', () => {
    expect(
      classifyTrend({
        fqiDelta: 0.5,
        romDeltaDeg: 1,
        symmetryDeltaDeg: 0.5,
        faultCountDelta: 0,
      }),
    ).toBe('unchanged');
  });

  it('returns "improving" when all signals are positive', () => {
    expect(
      classifyTrend({
        fqiDelta: 5,
        romDeltaDeg: 4,
        symmetryDeltaDeg: -2,
        faultCountDelta: -3,
      }),
    ).toBe('improving');
  });

  it('returns "regressing" when all signals are negative', () => {
    expect(
      classifyTrend({
        fqiDelta: -8,
        romDeltaDeg: -5,
        symmetryDeltaDeg: 3,
        faultCountDelta: 4,
      }),
    ).toBe('regressing');
  });

  it('returns "mixed" when signals disagree', () => {
    expect(
      classifyTrend({
        fqiDelta: 5,
        romDeltaDeg: -5,
        symmetryDeltaDeg: null,
        faultCountDelta: null,
      }),
    ).toBe('mixed');
  });

  it('treats negative symmetry delta as positive signal (less asymmetry)', () => {
    expect(
      classifyTrend({
        fqiDelta: null,
        romDeltaDeg: null,
        symmetryDeltaDeg: -3,
        faultCountDelta: null,
      }),
    ).toBe('improving');
  });
});

describe('buildSessionComparison', () => {
  it('returns baseline shape when prior is null', () => {
    const current = summary();
    const comparison = buildSessionComparison(current, null);
    expect(comparison.overallTrend).toBe('baseline');
    expect(comparison.priorSummary).toBeNull();
    expect(comparison.priorSessionId).toBeNull();
    expect(comparison.fqiDelta).toBeNull();
    expect(comparison.newFaults).toEqual([]);
    expect(comparison.resolvedFaults).toEqual([]);
  });

  it('computes deltas and classifies trend across all metrics', () => {
    const current = summary({
      sessionId: 'sess_curr',
      avgFqi: 85,
      avgRomDeg: 110,
      avgDepthRatio: 0.95,
      avgSymmetryDeg: 3,
      faultCounts: { knee_valgus: 1 },
    });
    const prior = summary({
      sessionId: 'sess_prev',
      avgFqi: 75,
      avgRomDeg: 100,
      avgDepthRatio: 0.85,
      avgSymmetryDeg: 6,
      faultCounts: { knee_valgus: 3, shallow_depth: 2 },
    });
    const comparison = buildSessionComparison(current, prior);
    expect(comparison.fqiDelta).toBe(10);
    expect(comparison.romDeltaDeg).toBe(10);
    expect(comparison.depthDeltaRatio).toBeCloseTo(0.1, 2);
    expect(comparison.symmetryDeltaDeg).toBe(-3);
    expect(comparison.faultCountDelta).toBe(-4);
    expect(comparison.newFaults).toEqual([]);
    expect(comparison.resolvedFaults).toEqual(['shallow_depth']);
    expect(comparison.overallTrend).toBe('improving');
  });

  it('handles null metric values without crashing', () => {
    const current = summary({ avgFqi: null, avgRomDeg: null });
    const prior = summary({ avgFqi: 70 });
    const comparison = buildSessionComparison(current, prior);
    expect(comparison.fqiDelta).toBeNull();
    expect(comparison.romDeltaDeg).toBeNull();
  });

  it('flags newly appeared faults separately from resolved ones', () => {
    const current = summary({ faultCounts: { forward_lean: 2 } });
    const prior = summary({ faultCounts: { shallow_depth: 1 } });
    const comparison = buildSessionComparison(current, prior);
    expect(comparison.newFaults).toEqual(['forward_lean']);
    expect(comparison.resolvedFaults).toEqual(['shallow_depth']);
  });
});

describe('summarizeSessionFromReps', () => {
  it('returns null when no rows match session + exercise', () => {
    const result = summarizeSessionFromReps({
      rows: [],
      sessionId: 'sess_1',
      exerciseId: 'squat',
    });
    expect(result).toBeNull();
  });

  it('aggregates fqi and features across matching reps', () => {
    const result = summarizeSessionFromReps({
      rows: [
        {
          session_id: 'sess_1',
          exercise: 'squat',
          start_ts: '2026-04-17T12:00:00Z',
          end_ts: '2026-04-17T12:00:05Z',
          fqi: 80,
          features: { romDeg: 100, depthRatio: 0.9, symmetryDeg: 4 },
          faults_detected: ['knee_valgus'],
        },
        {
          session_id: 'sess_1',
          exercise: 'squat',
          start_ts: '2026-04-17T12:00:10Z',
          end_ts: '2026-04-17T12:00:15Z',
          fqi: 90,
          features: { romDeg: 110, depthRatio: 0.95, symmetryDeg: 6 },
          faults_detected: ['knee_valgus', 'shallow_depth'],
        },
        {
          session_id: 'sess_1',
          exercise: 'pushup',
          start_ts: '2026-04-17T12:00:20Z',
          end_ts: '2026-04-17T12:00:25Z',
          fqi: 100,
          features: { romDeg: 999 },
          faults_detected: [],
        },
      ],
      sessionId: 'sess_1',
      exerciseId: 'squat',
    });
    expect(result).not.toBeNull();
    expect(result!.repCount).toBe(2);
    expect(result!.avgFqi).toBe(85);
    expect(result!.avgRomDeg).toBe(105);
    expect(result!.avgDepthRatio).toBeCloseTo(0.93, 2);
    expect(result!.avgSymmetryDeg).toBe(5);
    expect(result!.faultCounts).toEqual({ knee_valgus: 2, shallow_depth: 1 });
    expect(result!.completedAt).toBe('2026-04-17T12:00:15Z');
  });

  it('skips non-finite feature values', () => {
    const result = summarizeSessionFromReps({
      rows: [
        {
          session_id: 'sess_1',
          exercise: 'squat',
          start_ts: '2026-04-17T12:00:00Z',
          end_ts: '2026-04-17T12:00:05Z',
          fqi: null,
          features: { romDeg: Number.NaN, depthRatio: Infinity },
          faults_detected: null,
        },
      ],
      sessionId: 'sess_1',
      exerciseId: 'squat',
    });
    expect(result!.repCount).toBe(1);
    expect(result!.avgFqi).toBeNull();
    expect(result!.avgRomDeg).toBeNull();
    expect(result!.avgDepthRatio).toBeNull();
  });
});
