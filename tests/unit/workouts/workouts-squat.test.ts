/**
 * Parametric form-model coverage for lib/workouts/squat.ts.
 *
 * Pattern mirrors tests/unit/workouts-lunge.test.ts.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import {
  squatDefinition,
  SQUAT_THRESHOLDS,
  type SquatMetrics,
} from '@/lib/workouts/squat';
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

function metrics(overrides: Partial<SquatMetrics> = {}): SquatMetrics {
  return {
    avgKnee: 170,
    avgHip: 170,
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
    workoutId: 'squat',
  };
}

function fault(id: string) {
  const f = squatDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Squat fault '${id}' not found`);
  return f;
}

describe('squat registration', () => {
  test('squat is registered as a detection mode', () => {
    expect(getWorkoutIds()).toContain('squat');
  });

  test('getWorkoutByMode returns the squat definition', () => {
    const def = getWorkoutByMode('squat');
    expect(def.id).toBe('squat');
    expect(def.category).toBe('lower_body');
  });

  test('thresholds are finite and form a valid descent ladder', () => {
    for (const val of Object.values(SQUAT_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
    }
    expect(SQUAT_THRESHOLDS.standing).toBeGreaterThan(SQUAT_THRESHOLDS.descentStart);
    expect(SQUAT_THRESHOLDS.descentStart).toBeGreaterThan(SQUAT_THRESHOLDS.ascent);
    expect(SQUAT_THRESHOLDS.ascent).toBeGreaterThan(SQUAT_THRESHOLDS.parallel);
    expect(SQUAT_THRESHOLDS.parallel).toBeGreaterThan(SQUAT_THRESHOLDS.deep);
  });

  test('FQI weights sum to 1.0 and depth carries the most weight', () => {
    const { rom, depth, faults } = squatDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1, 5);
    expect(depth).toBeGreaterThanOrEqual(rom);
    expect(depth).toBeGreaterThanOrEqual(faults);
  });
});

describe('squat fault: shallow_depth', () => {
  const f = fault('shallow_depth');

  test('positive: min knee above parallel+15 fires', () => {
    const bad = SQUAT_THRESHOLDS.parallel + 25;
    const c = ctx({ min: { leftKnee: bad, rightKnee: bad } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min knee at parallel does NOT fire', () => {
    const c = ctx({
      min: { leftKnee: SQUAT_THRESHOLDS.parallel, rightKnee: SQUAT_THRESHOLDS.parallel },
    });
    expect(f.condition(c)).toBe(false);
  });

  test('boundary: exactly parallel+15 does NOT fire (strict >)', () => {
    const edge = SQUAT_THRESHOLDS.parallel + 15;
    const c = ctx({ min: { leftKnee: edge, rightKnee: edge } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('squat fault: knee_valgus', () => {
  const f = fault('knee_valgus');

  test('positive: knee diff > kneeValgusMax fires', () => {
    const c = ctx({ min: { leftKnee: 60, rightKnee: 60 + SQUAT_THRESHOLDS.kneeValgusMax + 5 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: knee diff at kneeValgusMax does NOT fire (strict >)', () => {
    const c = ctx({ min: { leftKnee: 90, rightKnee: 90 + SQUAT_THRESHOLDS.kneeValgusMax } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('squat fault: fast_rep', () => {
  const f = fault('fast_rep');

  test('positive: duration < 1000ms fires', () => {
    expect(f.condition(ctx({ durationMs: 800 }))).toBe(true);
  });

  test('negative: duration at 1000ms does NOT fire', () => {
    expect(f.condition(ctx({ durationMs: 1000 }))).toBe(false);
  });
});

describe('squat fault: hip_shift', () => {
  const f = fault('hip_shift');

  test('positive: hip diff > 20 fires', () => {
    const c = ctx({ min: { leftHip: 80, rightHip: 110 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: hip diff at 20 does NOT fire', () => {
    const c = ctx({ min: { leftHip: 80, rightHip: 100 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('squat fault: forward_lean', () => {
  const f = fault('forward_lean');

  test('positive: avgHip < avgKnee-25 fires', () => {
    const c = ctx({ min: { leftHip: 60, rightHip: 60, leftKnee: 90, rightKnee: 90 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: avgHip equal to avgKnee does NOT fire', () => {
    const c = ctx({ min: { leftHip: 90, rightHip: 90, leftKnee: 90, rightKnee: 90 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('squat FSM edge transitions', () => {
  test('legsTracked=false forces setup', () => {
    const next = squatDefinition.getNextPhase('descent', angles(), metrics({ legsTracked: false }));
    expect(next).toBe('setup');
  });

  test('setup -> standing at standing threshold', () => {
    const next = squatDefinition.getNextPhase(
      'setup',
      angles(),
      metrics({ avgKnee: SQUAT_THRESHOLDS.standing })
    );
    expect(next).toBe('standing');
  });

  test('standing -> descent at descentStart threshold', () => {
    const next = squatDefinition.getNextPhase(
      'standing',
      angles(),
      metrics({ avgKnee: SQUAT_THRESHOLDS.descentStart })
    );
    expect(next).toBe('descent');
  });

  test('descent -> bottom at parallel threshold', () => {
    const next = squatDefinition.getNextPhase(
      'descent',
      angles(),
      metrics({ avgKnee: SQUAT_THRESHOLDS.parallel })
    );
    expect(next).toBe('bottom');
  });

  test('ascent -> standing at finish threshold', () => {
    const next = squatDefinition.getNextPhase(
      'ascent',
      angles(),
      metrics({ avgKnee: SQUAT_THRESHOLDS.finish })
    );
    expect(next).toBe('standing');
  });
});

describe('squat calculateMetrics', () => {
  test('averages knee and hip', () => {
    const m = squatDefinition.calculateMetrics(angles({ leftKnee: 80, rightKnee: 120, leftHip: 90, rightHip: 110 }));
    expect(m.avgKnee).toBe(100);
    expect(m.avgHip).toBe(100);
  });

  test('armsTracked is always false', () => {
    expect(squatDefinition.calculateMetrics(angles()).armsTracked).toBe(false);
  });

  test('legsTracked=false when any leg joint is at boundary', () => {
    expect(squatDefinition.calculateMetrics(angles({ leftKnee: 0 })).legsTracked).toBe(false);
    expect(squatDefinition.calculateMetrics(angles({ rightHip: 180 })).legsTracked).toBe(false);
  });
});
