/**
 * Parametric form-model coverage for lib/workouts/deadlift.ts.
 *
 * Pattern mirrors tests/unit/workouts-lunge.test.ts.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import {
  deadliftDefinition,
  DEADLIFT_THRESHOLDS,
  type DeadliftMetrics,
} from '@/lib/workouts/deadlift';
import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

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

function metrics(overrides: Partial<DeadliftMetrics> = {}): DeadliftMetrics {
  return {
    avgHip: 170,
    avgKnee: 170,
    avgShoulder: 90,
    armsTracked: false,
    legsTracked: true,
    ...overrides,
  };
}

function ctx(opts: {
  start?: Partial<JointAngles>;
  end?: Partial<JointAngles>;
  min?: Partial<JointAngles>;
  max?: Partial<JointAngles>;
  durationMs?: number;
}): RepContext {
  return {
    startAngles: angles(opts.start),
    endAngles: angles(opts.end),
    minAngles: angles(opts.min),
    maxAngles: angles(opts.max),
    durationMs: opts.durationMs ?? 2000,
    repNumber: 1,
    workoutId: 'deadlift',
  };
}

function fault(id: string) {
  const f = deadliftDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Deadlift fault '${id}' not found`);
  return f;
}

// ---------------------------------------------------------------------------

describe('deadlift registration', () => {
  test('deadlift is registered as a detection mode', () => {
    expect(getWorkoutIds()).toContain('deadlift');
  });

  test('getWorkoutByMode returns the deadlift definition', () => {
    const def = getWorkoutByMode('deadlift');
    expect(def.id).toBe('deadlift');
    expect(def.displayName).toBe('Deadlift');
    expect(def.category).toBe('lower_body');
  });

  test('deadlift thresholds are all finite', () => {
    for (const val of Object.values(DEADLIFT_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
    }
  });

  test('FQI weights sum to 1.0 and prioritize faults (safety)', () => {
    const { rom, depth, faults } = deadliftDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1, 5);
    // Deadlift cares more about faults (safety) than rom/depth individually.
    expect(faults).toBeGreaterThanOrEqual(rom);
    expect(faults).toBeGreaterThanOrEqual(depth);
  });
});

describe('deadlift fault: incomplete_lockout', () => {
  const f = fault('incomplete_lockout');

  test('positive: maxHip well below lockout-10 fires', () => {
    const bad = DEADLIFT_THRESHOLDS.lockout - 20;
    const c = ctx({ max: { leftHip: bad, rightHip: bad } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: maxHip at lockout does NOT fire', () => {
    const c = ctx({ max: { leftHip: DEADLIFT_THRESHOLDS.lockout, rightHip: DEADLIFT_THRESHOLDS.lockout } });
    expect(f.condition(c)).toBe(false);
  });

  test('boundary: exactly lockout-10 does NOT fire (strict <)', () => {
    const edge = DEADLIFT_THRESHOLDS.lockout - 10;
    const c = ctx({ max: { leftHip: edge, rightHip: edge } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('deadlift fault: rounded_back', () => {
  const f = fault('rounded_back');

  test('positive: maxShoulder > 120 fires', () => {
    const c = ctx({ max: { leftShoulder: 125, rightShoulder: 90 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: maxShoulder exactly 120 does NOT fire (strict >)', () => {
    const c = ctx({ max: { leftShoulder: 120, rightShoulder: 120 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('deadlift fault: asymmetric_pull', () => {
  const f = fault('asymmetric_pull');

  test('positive: hip diff > 20 fires', () => {
    const c = ctx({ max: { leftHip: 140, rightHip: 165 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: hip diff exactly 20 does NOT fire', () => {
    const c = ctx({ max: { leftHip: 150, rightHip: 170 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('deadlift fault: fast_descent', () => {
  const f = fault('fast_descent');

  test('positive: duration below 1200ms fires', () => {
    expect(f.condition(ctx({ durationMs: 1000 }))).toBe(true);
  });

  test('negative: duration at 1200ms does NOT fire', () => {
    expect(f.condition(ctx({ durationMs: 1200 }))).toBe(false);
  });
});

describe('deadlift FSM edge transitions', () => {
  test('legsTracked=false forces setup', () => {
    const next = deadliftDefinition.getNextPhase('pull', angles(), metrics({ legsTracked: false }));
    expect(next).toBe('setup');
  });

  test('setup -> address when hip <= address threshold', () => {
    const next = deadliftDefinition.getNextPhase(
      'setup',
      angles(),
      metrics({ avgHip: DEADLIFT_THRESHOLDS.address })
    );
    expect(next).toBe('address');
  });

  test('setup -> lockout when already standing', () => {
    const next = deadliftDefinition.getNextPhase(
      'setup',
      angles(),
      metrics({ avgHip: DEADLIFT_THRESHOLDS.lockout })
    );
    expect(next).toBe('lockout');
  });

  test('pull -> lockout at lockout threshold', () => {
    const next = deadliftDefinition.getNextPhase(
      'pull',
      angles(),
      metrics({ avgHip: DEADLIFT_THRESHOLDS.lockout })
    );
    expect(next).toBe('lockout');
  });
});

describe('deadlift calculateMetrics', () => {
  test('averages hip and knee', () => {
    const m = deadliftDefinition.calculateMetrics(angles({ leftHip: 80, rightHip: 100, leftKnee: 120, rightKnee: 140 }));
    expect(m.avgHip).toBe(90);
    expect(m.avgKnee).toBe(130);
  });

  test('armsTracked is always false (deadlift has no arm signal)', () => {
    expect(deadliftDefinition.calculateMetrics(angles()).armsTracked).toBe(false);
  });

  test('legsTracked=false when any hip/knee is at boundary (0 or 180)', () => {
    expect(deadliftDefinition.calculateMetrics(angles({ leftHip: 0 })).legsTracked).toBe(false);
    expect(deadliftDefinition.calculateMetrics(angles({ rightKnee: 180 })).legsTracked).toBe(false);
  });
});
