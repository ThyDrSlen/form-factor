/**
 * Boundary & numerical-edge tests for the FQI calculator.
 *
 * Companion to `fqi-calculator-full.test.ts` and `fqi-faults.test.ts`.
 * Those suites cover happy-path scoring against real workout definitions;
 * this one isolates the arithmetic edge cases the audit flagged
 * (zero-target-ROM, NaN/Infinity propagation, exact thresholds, negative
 * ranges) without relying on a real workout's angle-range table.
 */

import { calculateFqi } from '@/lib/services/fqi-calculator';
import type {
  AngleRange,
  RepAngleWindow,
  WorkoutDefinition,
} from '@/lib/types/workout-definitions';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
    ...overrides,
  };
}

function repWindow(min: Partial<JointAngles>, max: Partial<JointAngles>): RepAngleWindow {
  return {
    start: angles(),
    end: angles(),
    min: angles(min),
    max: angles(max),
  };
}

function buildDef(
  ranges: Record<string, AngleRange>,
  weights = { rom: 0.4, depth: 0.4, faults: 0.2 },
): WorkoutDefinition {
  return {
    id: 'test',
    name: 'Boundary Test',
    description: 'Synthetic workout for boundary testing',
    angleRanges: ranges,
    fqiWeights: weights,
    faults: [],
    cues: [],
    minRepsForSet: 1,
    repCountMethod: 'phase-fsm',
    phases: ['rest'],
  } as unknown as WorkoutDefinition;
}

// ---------------------------------------------------------------------------
// ROM boundary cases
// ---------------------------------------------------------------------------

describe('FQI calculator — ROM boundaries', () => {
  test('zero target ROM does not produce Infinity score (degenerate range skipped)', () => {
    const def = buildDef({
      elbow: { min: 90, max: 90, optimal: 90, tolerance: 5 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 80, rightElbow: 80 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.romScore).toBeGreaterThanOrEqual(0);
    expect(result.romScore).toBeLessThanOrEqual(100);
  });

  test('negative target ROM (max < min) is skipped, not silently scored as negative', () => {
    const def = buildDef({
      elbow: { min: 180, max: 90, optimal: 100, tolerance: 5 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 80, rightElbow: 80 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(result.romScore).toBeGreaterThanOrEqual(0);
    expect(result.romScore).toBeLessThanOrEqual(100);
  });

  test('ROM achievement above target clamps to 100, not >100', () => {
    const def = buildDef({
      elbow: { min: 90, max: 100, optimal: 95, tolerance: 5 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 30, rightElbow: 30 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(result.romScore).toBe(100);
  });

  test('NaN angles produce a finite, in-range score', () => {
    const def = buildDef({
      elbow: { min: 90, max: 170, optimal: 90, tolerance: 5 },
    });
    const result = calculateFqi(
      repWindow({ leftElbow: NaN, rightElbow: NaN }, { leftElbow: NaN, rightElbow: NaN }),
      1500,
      1,
      def,
    );

    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('Infinity angles produce a finite, in-range score', () => {
    const def = buildDef({
      elbow: { min: 90, max: 170, optimal: 90, tolerance: 5 },
    });
    const result = calculateFqi(
      repWindow(
        { leftElbow: Infinity, rightElbow: -Infinity },
        { leftElbow: Infinity, rightElbow: -Infinity },
      ),
      1500,
      1,
      def,
    );

    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('exact-target ROM scores 100 (boundary equality)', () => {
    const def = buildDef({
      elbow: { min: 90, max: 170, optimal: 90, tolerance: 0.001 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 90, rightElbow: 90 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(result.romScore).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Depth boundary cases
// ---------------------------------------------------------------------------

describe('FQI calculator — depth boundaries', () => {
  test('zero tolerance is skipped (degenerate), not silently scored as 100', () => {
    const def = buildDef({
      elbow: { min: 90, max: 170, optimal: 90, tolerance: 0 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 100, rightElbow: 100 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(Number.isFinite(result.depthScore)).toBe(true);
    expect(result.depthScore).toBeGreaterThanOrEqual(0);
    expect(result.depthScore).toBeLessThanOrEqual(100);
  });

  test('negative tolerance is skipped (defensive)', () => {
    const def = buildDef({
      elbow: { min: 90, max: 170, optimal: 90, tolerance: -5 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 100, rightElbow: 100 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(Number.isFinite(result.depthScore)).toBe(true);
    expect(result.depthScore).toBeGreaterThanOrEqual(0);
    expect(result.depthScore).toBeLessThanOrEqual(100);
  });

  test('deviation exactly at tolerance scores 100', () => {
    const def = buildDef({
      elbow: { min: 90, max: 170, optimal: 90, tolerance: 5 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 95, rightElbow: 95 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(result.depthScore).toBe(100);
  });

  test('deviation just past tolerance dips below 100', () => {
    const def = buildDef({
      elbow: { min: 90, max: 170, optimal: 90, tolerance: 5 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 96, rightElbow: 96 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(result.depthScore).toBeLessThan(100);
    expect(result.depthScore).toBeGreaterThanOrEqual(0);
  });

  test('large deviation floors depth score at 0, not negative', () => {
    const def = buildDef({
      elbow: { min: 90, max: 170, optimal: 90, tolerance: 5 },
    });
    const result = calculateFqi(repWindow({ leftElbow: 300, rightElbow: 300 }, { leftElbow: 350, rightElbow: 350 }), 1500, 1, def);

    expect(result.depthScore).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Overall score boundary cases
// ---------------------------------------------------------------------------

describe('FQI calculator — overall score boundaries', () => {
  test('empty angle-range table scores neutral (no crash)', () => {
    const def = buildDef({});
    const result = calculateFqi(repWindow({}, {}), 1500, 1, def);

    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('weights summing to 0 still produce a finite score', () => {
    const def = buildDef(
      { elbow: { min: 90, max: 170, optimal: 90, tolerance: 5 } },
      { rom: 0, depth: 0, faults: 0 },
    );
    const result = calculateFqi(repWindow({ leftElbow: 90, rightElbow: 90 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBe(0);
  });

  test('NaN-producing weights still yield clamped finite score', () => {
    const def = buildDef(
      { elbow: { min: 90, max: 170, optimal: 90, tolerance: 5 } },
      { rom: NaN, depth: 0.5, faults: 0.5 },
    );
    const result = calculateFqi(repWindow({ leftElbow: 90, rightElbow: 90 }, { leftElbow: 170, rightElbow: 170 }), 1500, 1, def);

    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('returns proper structure even for trivial inputs', () => {
    const def = buildDef({ elbow: { min: 90, max: 170, optimal: 90, tolerance: 5 } });
    const result = calculateFqi(repWindow({ leftElbow: 90, rightElbow: 90 }, { leftElbow: 170, rightElbow: 170 }), 0, 0, def);

    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('romScore');
    expect(result).toHaveProperty('depthScore');
    expect(result).toHaveProperty('faultPenalty');
    expect(result).toHaveProperty('detectedFaults');
  });
});
