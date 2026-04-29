/**
 * FQI calculator — A5 degenerate meta flag.
 *
 * When every ROM/depth metric scores against a degenerate AngleRange
 * (max <= min or tolerance <= 0), the calculator used to silently return
 * the 100 fallback. Wave-30 introduces:
 *   - a `meta.degenerate: true` flag on the returned FQIResult so UI can
 *     tag the rep as "needs calibration"
 *   - a logError() call under the FormTrackingErrorCode.FQI_DEGENERATE_RANGE
 *     code so telemetry can track the same failure mode across the pipeline
 * The default score itself is unchanged (still 100) for this release.
 */
import { calculateFqi } from '@/lib/services/fqi-calculator';
import { FormTrackingErrorCode } from '@/lib/services/ErrorHandler';
import type { WorkoutDefinition } from '@/lib/types/workout-definitions';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

const ANGLES: JointAngles = {
  leftElbow: 170,
  rightElbow: 170,
  leftShoulder: 90,
  rightShoulder: 90,
  leftKnee: 170,
  rightKnee: 170,
  leftHip: 170,
  rightHip: 170,
};

function makeDefWithDegenerateRange(): WorkoutDefinition {
  return {
    id: 'degenerate-test',
    displayName: 'Degenerate Test',
    description: '',
    category: 'upper_body',
    difficulty: 'beginner',
    phases: [],
    initialPhase: 'idle',
    repBoundary: { startPhase: 'idle', endPhase: 'idle', minDurationMs: 0 },
    thresholds: {},
    // Degenerate: max === min, tolerance === 0. Both ROM and depth scorers
    // should return null from scoreRomAgainstRange / scoreDepthAgainstRange.
    angleRanges: { elbow: { min: 170, max: 170, optimal: 170, tolerance: 0 } },
    faults: [],
    fqiWeights: { rom: 0.5, depth: 0.5, faults: 0 },
    calculateMetrics: () => ({ armsTracked: true }),
    getNextPhase: (phase) => phase,
  };
}

describe('calculateFqi — degenerate meta flag (A5)', () => {
  it('sets meta.degenerate=true when every ROM/depth metric is degenerate', () => {
    const def = makeDefWithDegenerateRange();
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: ANGLES, max: ANGLES },
      1000,
      1,
      def
    );
    expect(result.meta?.degenerate).toBe(true);
    // Default score is preserved for this release.
    expect(result.score).toBeGreaterThan(0);
  });

  it('omits meta.degenerate when at least one scoring metric is healthy', () => {
    const def: WorkoutDefinition = {
      ...makeDefWithDegenerateRange(),
      angleRanges: {
        elbow: { min: 90, max: 170, optimal: 160, tolerance: 10 },
      },
    };
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: ANGLES, max: ANGLES },
      1000,
      1,
      def
    );
    expect(result.meta).toBeUndefined();
  });

  it('exports a FQI_DEGENERATE_RANGE error code for the telemetry contract', () => {
    // Pure contract check — we don't re-mock logError here; the fact that
    // the symbol exists and has the expected value is what downstream UI
    // will gate on.
    expect(FormTrackingErrorCode.FQI_DEGENERATE_RANGE).toBe(
      'FQI_DEGENERATE_RANGE'
    );
  });
});
