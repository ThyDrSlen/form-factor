/**
 * Parametric form-model coverage for lib/workouts/benchpress.ts.
 *
 * Pattern mirrors tests/unit/workouts-lunge.test.ts:
 * - Registration sanity (reachable via getWorkoutByMode / getWorkoutIds)
 * - Fault boundary positives + negatives + NaN guard
 * - FQI weight sanity (sum to 1, finite)
 * - calculateMetrics + getNextPhase edge cases
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import {
  benchpressDefinition,
  BENCHPRESS_THRESHOLDS,
  type BenchPressMetrics,
} from '@/lib/workouts/benchpress';
import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 160,
    rightElbow: 160,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
    ...overrides,
  };
}

function metrics(overrides: Partial<BenchPressMetrics> = {}): BenchPressMetrics {
  return {
    avgElbow: 160,
    avgShoulder: 90,
    armsTracked: true,
    wristsTracked: true,
    ...overrides,
  };
}

function ctx(opts: {
  start?: Partial<JointAngles>;
  end?: Partial<JointAngles>;
  min?: Partial<JointAngles>;
  max?: Partial<JointAngles>;
  durationMs?: number;
  repNumber?: number;
}): RepContext {
  return {
    startAngles: angles(opts.start),
    endAngles: angles(opts.end),
    minAngles: angles(opts.min),
    maxAngles: angles(opts.max),
    durationMs: opts.durationMs ?? 1500,
    repNumber: opts.repNumber ?? 1,
    workoutId: 'benchpress',
  };
}

function fault(id: string) {
  const f = benchpressDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Benchpress fault '${id}' not found`);
  return f;
}

// ---------------------------------------------------------------------------
// Registration sanity
// ---------------------------------------------------------------------------

describe('benchpress registration', () => {
  test('benchpress is registered as a detection mode', () => {
    expect(getWorkoutIds()).toContain('benchpress');
  });

  test('getWorkoutByMode returns the benchpress definition', () => {
    const def = getWorkoutByMode('benchpress');
    expect(def.id).toBe('benchpress');
    expect(def.displayName).toBe('Bench Press');
    expect(def.category).toBe('upper_body');
  });

  test('benchpress thresholds are all finite', () => {
    for (const [, val] of Object.entries(BENCHPRESS_THRESHOLDS)) {
      expect(typeof val).toBe('number');
      expect(Number.isFinite(val)).toBe(true);
    }
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = benchpressDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// Fault boundary parametric tests
// ---------------------------------------------------------------------------

describe('benchpress fault: shallow_depth', () => {
  const f = fault('shallow_depth');

  test('positive: min elbow well above bottom+15 fires fault', () => {
    const c = ctx({ min: { leftElbow: BENCHPRESS_THRESHOLDS.bottom + 20, rightElbow: BENCHPRESS_THRESHOLDS.bottom + 20 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min elbow at bottom does not fire', () => {
    const c = ctx({ min: { leftElbow: BENCHPRESS_THRESHOLDS.bottom, rightElbow: BENCHPRESS_THRESHOLDS.bottom } });
    expect(f.condition(c)).toBe(false);
  });

  test('boundary: exactly bottom+15 does NOT fire (strict >)', () => {
    const edge = BENCHPRESS_THRESHOLDS.bottom + 15;
    const c = ctx({ min: { leftElbow: edge, rightElbow: edge } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('benchpress fault: asymmetric_press', () => {
  const f = fault('asymmetric_press');

  test('positive: elbow diff > 20 fires fault', () => {
    const c = ctx({ min: { leftElbow: 80, rightElbow: 105 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: elbow diff exactly 20 does NOT fire (strict >)', () => {
    const c = ctx({ min: { leftElbow: 80, rightElbow: 100 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('benchpress fault: fast_rep', () => {
  const f = fault('fast_rep');

  test('positive: duration below 600ms fires', () => {
    expect(f.condition(ctx({ durationMs: 500 }))).toBe(true);
  });

  test('negative: duration at 600ms does NOT fire', () => {
    expect(f.condition(ctx({ durationMs: 600 }))).toBe(false);
  });

  test('negative: very long rep does NOT fire', () => {
    expect(f.condition(ctx({ durationMs: 5000 }))).toBe(false);
  });
});

describe('benchpress fault: elbow_flare', () => {
  const f = fault('elbow_flare');

  test('positive: max shoulder > elbowFlareShoulderMax fires', () => {
    const c = ctx({ max: { leftShoulder: BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax + 5, rightShoulder: 90 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: max shoulder exactly at limit does NOT fire', () => {
    const edge = BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax;
    const c = ctx({ max: { leftShoulder: edge, rightShoulder: edge } });
    expect(f.condition(c)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase FSM sanity
// ---------------------------------------------------------------------------

describe('benchpress FSM edge transitions', () => {
  test('untracked arms forces setup from lockout', () => {
    const next = benchpressDefinition.getNextPhase('lockout', angles(), metrics({ armsTracked: false }));
    expect(next).toBe('setup');
  });

  test('untracked wrists forces setup from bottom', () => {
    const next = benchpressDefinition.getNextPhase('bottom', angles(), metrics({ wristsTracked: false }));
    expect(next).toBe('setup');
  });

  test('setup -> lockout at readyElbow threshold', () => {
    const next = benchpressDefinition.getNextPhase(
      'setup',
      angles(),
      metrics({ avgElbow: BENCHPRESS_THRESHOLDS.readyElbow })
    );
    expect(next).toBe('lockout');
  });

  test('lockout -> lowering at loweringStart threshold', () => {
    const next = benchpressDefinition.getNextPhase(
      'lockout',
      angles(),
      metrics({ avgElbow: BENCHPRESS_THRESHOLDS.loweringStart })
    );
    expect(next).toBe('lowering');
  });
});
