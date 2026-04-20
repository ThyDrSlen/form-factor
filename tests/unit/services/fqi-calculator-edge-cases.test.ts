/**
 * FQI-calculator edge-case regression tests.
 *
 * Exercises the non-happy branches of `calculateRomScore` and
 * `calculateDepthScore` in `lib/services/fqi-calculator.ts`:
 *   - scoringMetrics extract returning {min: NaN, max: finite} -> metric skipped
 *   - Partial finite: `left.min` finite, `right.min = Infinity` -> short-circuit
 *   - `scoringMetrics: []` -> falls back to elbow/hip/knee code path without throwing on L86 `scores.length === 0`
 *   - depth tolerance boundary: deviation === tolerance scores 100 (not penalty)
 *   - fqiWeights { rom: 0, depth: 0, faults: 0 } -> rawScore 0, no NaN
 *   - durationMs: 0 -> fast_rep fires (if any), score still finite
 */
import { calculateFqi } from '@/lib/services/fqi-calculator';
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

const MIN_ANGLES: JointAngles = {
  leftElbow: 160,
  rightElbow: 160,
  leftShoulder: 90,
  rightShoulder: 90,
  leftKnee: 170,
  rightKnee: 170,
  leftHip: 170,
  rightHip: 170,
};

const MAX_ANGLES: JointAngles = {
  leftElbow: 175,
  rightElbow: 175,
  leftShoulder: 90,
  rightShoulder: 90,
  leftKnee: 170,
  rightKnee: 170,
  leftHip: 170,
  rightHip: 170,
};

function makeDef(
  overrides: Partial<WorkoutDefinition> = {}
): WorkoutDefinition {
  const base: WorkoutDefinition = {
    id: 'test',
    displayName: 'Test',
    description: '',
    category: 'upper_body',
    difficulty: 'beginner',
    phases: [],
    initialPhase: 'idle',
    repBoundary: { startPhase: 'idle', endPhase: 'idle', minDurationMs: 0 },
    thresholds: {},
    angleRanges: { elbow: { min: 160, max: 175, optimal: 170, tolerance: 5 } },
    faults: [],
    fqiWeights: { rom: 0.5, depth: 0.5, faults: 0 },
    calculateMetrics: () => ({ armsTracked: true }),
    getNextPhase: (phase) => phase,
    scoringMetrics: [
      {
        id: 'elbow',
        extract: (rep, side) =>
          side === 'left'
            ? {
                start: rep.start.leftElbow,
                end: rep.end.leftElbow,
                min: rep.min.leftElbow,
                max: rep.max.leftElbow,
              }
            : {
                start: rep.start.rightElbow,
                end: rep.end.rightElbow,
                min: rep.min.rightElbow,
                max: rep.max.rightElbow,
              },
      },
    ],
  };
  return { ...base, ...overrides };
}

describe('FQI edge cases', () => {
  test('scoringMetrics extract returning NaN min -> metric skipped, scores.length === 0 yields 100 (romScore)', () => {
    const def = makeDef({
      scoringMetrics: [
        {
          id: 'elbow',
          extract: () => ({ start: 170, end: 170, min: Number.NaN, max: 120 }),
        },
      ],
      fqiWeights: { rom: 1, depth: 0, faults: 0 },
    });
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: MIN_ANGLES, max: MAX_ANGLES },
      1000,
      1,
      def
    );
    // All metrics skipped -> scores.length === 0 -> returns 100 per L86
    expect(result.romScore).toBe(100);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  test('partial finite: right.min = Infinity -> metric skipped, not Infinity/2 averaging', () => {
    const def = makeDef({
      scoringMetrics: [
        {
          id: 'elbow',
          extract: (_rep, side) =>
            side === 'left'
              ? { start: 170, end: 170, min: 90, max: 170 }
              : { start: 170, end: 170, min: Number.POSITIVE_INFINITY, max: 170 },
        },
      ],
      fqiWeights: { rom: 1, depth: 0, faults: 0 },
    });
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: MIN_ANGLES, max: MAX_ANGLES },
      1000,
      1,
      def
    );
    // Metric skipped entirely -> scores.length === 0 -> 100
    expect(result.romScore).toBe(100);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  test('empty scoringMetrics: [] -> falls back to legacy elbow/hip/knee path', () => {
    const def = makeDef({
      scoringMetrics: [],
      angleRanges: { elbow: { min: 160, max: 175, optimal: 170, tolerance: 5 } },
      fqiWeights: { rom: 1, depth: 0, faults: 0 },
    });
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: MIN_ANGLES, max: MAX_ANGLES },
      1000,
      1,
      def
    );
    // Legacy path: actualRom = |175 - 160| = 15, targetRom = 15, romPercentage = 1 -> 100
    expect(result.romScore).toBe(100);
  });

  test('no angleRanges and empty scoringMetrics -> scores empty, returns 100 (L132 fallback)', () => {
    const def = makeDef({
      scoringMetrics: [],
      angleRanges: {},
      fqiWeights: { rom: 1, depth: 0, faults: 0 },
    });
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: MIN_ANGLES, max: MAX_ANGLES },
      1000,
      1,
      def
    );
    expect(result.romScore).toBe(100);
    expect(result.depthScore).toBe(100);
  });

  test('depth tolerance boundary: deviation === tolerance scores 100 (L169), NOT penalty', () => {
    // optimal = 170, tolerance = 5 -> deviation = 5 must score 100
    // avgMin = 165 (deviation 5). Use scoringMetrics path to target exact branch.
    const def = makeDef({
      scoringMetrics: [
        {
          id: 'elbow',
          extract: (_rep, _side) => ({ start: 170, end: 170, min: 165, max: 170 }),
        },
      ],
      angleRanges: { elbow: { min: 160, max: 175, optimal: 170, tolerance: 5 } },
      fqiWeights: { rom: 0, depth: 1, faults: 0 },
    });
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: MIN_ANGLES, max: MAX_ANGLES },
      1000,
      1,
      def
    );
    expect(result.depthScore).toBe(100);
  });

  test('depth tolerance + 1 scores less than 100 (penalty applies)', () => {
    const def = makeDef({
      scoringMetrics: [
        {
          id: 'elbow',
          extract: (_rep, _side) => ({ start: 170, end: 170, min: 164, max: 170 }),
        },
      ],
      angleRanges: { elbow: { min: 160, max: 175, optimal: 170, tolerance: 5 } },
      fqiWeights: { rom: 0, depth: 1, faults: 0 },
    });
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: MIN_ANGLES, max: MAX_ANGLES },
      1000,
      1,
      def
    );
    // deviation 6, penalty (6-5)*2 = 2, score 98
    expect(result.depthScore).toBe(98);
  });

  test('fqiWeights { rom:0, depth:0, faults:0 } -> rawScore 0, returns finite 0', () => {
    const def = makeDef({ fqiWeights: { rom: 0, depth: 0, faults: 0 } });
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: MIN_ANGLES, max: MAX_ANGLES },
      1000,
      1,
      def
    );
    expect(result.score).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  test('durationMs: 0 -> fast_rep fires, score remains finite (no division-by-zero propagation)', () => {
    const def = makeDef({
      fqiWeights: { rom: 0.3, depth: 0.3, faults: 0.4 },
      faults: [
        {
          id: 'fast_rep',
          displayName: 'Rushed',
          condition: (ctx) => ctx.durationMs < 1000,
          severity: 1,
          dynamicCue: 'Slow it down.',
          fqiPenalty: 10,
        },
      ],
    });
    const result = calculateFqi(
      { start: ANGLES, end: ANGLES, min: MIN_ANGLES, max: MAX_ANGLES },
      0,
      1,
      def
    );
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.detectedFaults).toContain('fast_rep');
    expect(result.faultPenalty).toBe(10);
  });
});
