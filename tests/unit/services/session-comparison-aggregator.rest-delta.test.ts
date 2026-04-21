/**
 * Focused tests for the new rest/reps delta fields on
 * session-comparison-aggregator. Kept in a sibling file so the original
 * aggregator suite stays untouched.
 */
import {
  buildSessionComparison,
  summarizeSessionFromReps,
  type ExerciseSessionSummary,
} from '@/lib/services/session-comparison-aggregator';

function summary(overrides: Partial<ExerciseSessionSummary> = {}): ExerciseSessionSummary {
  return {
    sessionId: overrides.sessionId ?? 'sess_curr',
    exerciseId: 'pullup',
    completedAt: '2026-04-21T12:00:00.000Z',
    repCount: 10,
    avgFqi: 80,
    avgRomDeg: 100,
    avgDepthRatio: 0.9,
    avgSymmetryDeg: 4,
    avgRestSec: 45,
    faultCounts: {},
    ...overrides,
  };
}

describe('buildSessionComparison — rep + rest deltas', () => {
  it('computes repCountDelta and restDeltaSec when both sides have values', () => {
    const current = summary({ repCount: 12, avgRestSec: 42 });
    const prior = summary({ sessionId: 'sess_prev', repCount: 10, avgRestSec: 60 });
    const comparison = buildSessionComparison(current, prior);
    expect(comparison.repCountDelta).toBe(2);
    expect(comparison.restDeltaSec).toBe(-18);
  });

  it('returns null restDeltaSec when either side is missing avgRestSec', () => {
    const current = summary({ avgRestSec: null });
    const prior = summary({ sessionId: 'sess_prev', avgRestSec: 50 });
    const comparison = buildSessionComparison(current, prior);
    expect(comparison.restDeltaSec).toBeNull();
  });

  it('tolerates callers that omit avgRestSec entirely (back-compat)', () => {
    const current: ExerciseSessionSummary = summary();
    delete current.avgRestSec;
    const prior: ExerciseSessionSummary = summary({ sessionId: 'sess_prev' });
    delete prior.avgRestSec;
    const comparison = buildSessionComparison(current, prior);
    expect(comparison.restDeltaSec).toBeNull();
  });

  it('baseline (no prior) leaves repCountDelta and restDeltaSec null', () => {
    const current = summary({ repCount: 5, avgRestSec: 30 });
    const comparison = buildSessionComparison(current, null);
    expect(comparison.repCountDelta).toBeNull();
    expect(comparison.restDeltaSec).toBeNull();
  });
});

describe('summarizeSessionFromReps — avgRestSec', () => {
  it('computes avg rest seconds from the gaps between reps', () => {
    const result = summarizeSessionFromReps({
      rows: [
        {
          session_id: 'sess_1',
          exercise: 'pullup',
          start_ts: '2026-04-21T12:00:00.000Z',
          end_ts: '2026-04-21T12:00:04.000Z',
          fqi: 80,
          features: {},
          faults_detected: [],
        },
        {
          session_id: 'sess_1',
          exercise: 'pullup',
          start_ts: '2026-04-21T12:00:10.000Z', // 6s gap
          end_ts: '2026-04-21T12:00:14.000Z',
          fqi: 82,
          features: {},
          faults_detected: [],
        },
        {
          session_id: 'sess_1',
          exercise: 'pullup',
          start_ts: '2026-04-21T12:00:24.000Z', // 10s gap
          end_ts: '2026-04-21T12:00:28.000Z',
          fqi: 78,
          features: {},
          faults_detected: [],
        },
      ],
      sessionId: 'sess_1',
      exerciseId: 'pullup',
    });
    expect(result).not.toBeNull();
    // mean(6, 10) = 8.0s
    expect(result?.avgRestSec).toBe(8);
  });

  it('returns null avgRestSec for a single-rep session', () => {
    const result = summarizeSessionFromReps({
      rows: [
        {
          session_id: 'sess_1',
          exercise: 'pullup',
          start_ts: '2026-04-21T12:00:00.000Z',
          end_ts: '2026-04-21T12:00:04.000Z',
          fqi: 80,
          features: {},
          faults_detected: [],
        },
      ],
      sessionId: 'sess_1',
      exerciseId: 'pullup',
    });
    expect(result?.avgRestSec).toBeNull();
  });

  it('skips malformed (negative) gaps', () => {
    const result = summarizeSessionFromReps({
      rows: [
        {
          session_id: 'sess_1',
          exercise: 'pullup',
          start_ts: '2026-04-21T12:00:00.000Z',
          end_ts: '2026-04-21T12:00:10.000Z',
          fqi: 80,
          features: {},
          faults_detected: [],
        },
        {
          session_id: 'sess_1',
          exercise: 'pullup',
          // Overlap with the previous rep — gap would be -5s, skipped.
          start_ts: '2026-04-21T12:00:05.000Z',
          end_ts: '2026-04-21T12:00:14.000Z',
          fqi: 82,
          features: {},
          faults_detected: [],
        },
      ],
      sessionId: 'sess_1',
      exerciseId: 'pullup',
    });
    expect(result?.avgRestSec).toBeNull();
  });
});
