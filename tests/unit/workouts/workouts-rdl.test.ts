/**
 * Parametric form-model coverage for lib/workouts/rdl.ts (Romanian Deadlift).
 *
 * Pattern mirrors tests/unit/workouts-lunge.test.ts.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import {
  rdlDefinition,
  RDL_THRESHOLDS,
  type RDLMetrics,
} from '@/lib/workouts/rdl';
import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 160,
    rightKnee: 160,
    leftHip: 170,
    rightHip: 170,
    ...overrides,
  };
}

function metrics(overrides: Partial<RDLMetrics> = {}): RDLMetrics {
  return {
    avgHip: 170,
    avgKnee: 160,
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
    durationMs: opts.durationMs ?? 2500,
    repNumber: 1,
    workoutId: 'rdl',
  };
}

function fault(id: string) {
  const f = rdlDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`RDL fault '${id}' not found`);
  return f;
}

describe('rdl registration', () => {
  test('rdl is registered as a detection mode', () => {
    expect(getWorkoutIds()).toContain('rdl');
  });

  test('getWorkoutByMode returns the rdl definition', () => {
    const def = getWorkoutByMode('rdl');
    expect(def.id).toBe('rdl');
    expect(def.displayName).toBe('Romanian Deadlift');
    expect(def.category).toBe('lower_body');
  });

  test('thresholds are finite and form a valid hinge ladder', () => {
    for (const val of Object.values(RDL_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
    }
    expect(RDL_THRESHOLDS.standing).toBeGreaterThan(RDL_THRESHOLDS.hingeStart);
    expect(RDL_THRESHOLDS.hingeStart).toBeGreaterThan(RDL_THRESHOLDS.riseStart);
    expect(RDL_THRESHOLDS.riseStart).toBeGreaterThan(RDL_THRESHOLDS.bottom);
    expect(RDL_THRESHOLDS.kneeSoftBend).toBeGreaterThan(RDL_THRESHOLDS.kneeMinBend);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = rdlDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1, 5);
  });
});

describe('rdl fault: knee_bend_excessive', () => {
  const f = fault('knee_bend_excessive');

  test('positive: min knee below kneeMinBend fires', () => {
    const bad = RDL_THRESHOLDS.kneeMinBend - 10;
    const c = ctx({ min: { leftKnee: bad, rightKnee: bad } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min knee at kneeMinBend does NOT fire (strict <)', () => {
    const c = ctx({
      min: { leftKnee: RDL_THRESHOLDS.kneeMinBend, rightKnee: RDL_THRESHOLDS.kneeMinBend },
    });
    expect(f.condition(c)).toBe(false);
  });
});

describe('rdl fault: shallow_hinge', () => {
  const f = fault('shallow_hinge');

  test('positive: min hip above bottom+20 fires', () => {
    const bad = RDL_THRESHOLDS.bottom + 30;
    const c = ctx({ min: { leftHip: bad, rightHip: bad } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min hip at bottom does NOT fire', () => {
    const c = ctx({ min: { leftHip: RDL_THRESHOLDS.bottom, rightHip: RDL_THRESHOLDS.bottom } });
    expect(f.condition(c)).toBe(false);
  });

  test('boundary: exactly bottom+20 does NOT fire (strict >)', () => {
    const edge = RDL_THRESHOLDS.bottom + 20;
    const c = ctx({ min: { leftHip: edge, rightHip: edge } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('rdl fault: incomplete_lockout', () => {
  const f = fault('incomplete_lockout');

  test('positive: max hip well below standing-10 fires', () => {
    const bad = RDL_THRESHOLDS.standing - 20;
    const c = ctx({ max: { leftHip: bad, rightHip: bad } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: max hip at standing does NOT fire', () => {
    const c = ctx({
      max: { leftHip: RDL_THRESHOLDS.standing, rightHip: RDL_THRESHOLDS.standing },
    });
    expect(f.condition(c)).toBe(false);
  });
});

describe('rdl fault: rounded_back', () => {
  const f = fault('rounded_back');

  test('positive: max shoulder > 130 fires', () => {
    const c = ctx({ max: { leftShoulder: 135, rightShoulder: 90 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: max shoulder at 130 does NOT fire', () => {
    const c = ctx({ max: { leftShoulder: 130, rightShoulder: 130 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('rdl fault: asymmetric_hinge', () => {
  const f = fault('asymmetric_hinge');

  test('positive: hip diff > 20 fires', () => {
    const c = ctx({ min: { leftHip: 80, rightHip: 110 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: hip diff at 20 does NOT fire', () => {
    const c = ctx({ min: { leftHip: 80, rightHip: 100 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('rdl fault: fast_rep', () => {
  const f = fault('fast_rep');

  test('positive: duration < 1500ms fires', () => {
    expect(f.condition(ctx({ durationMs: 1000 }))).toBe(true);
  });

  test('negative: duration at 1500ms does NOT fire', () => {
    expect(f.condition(ctx({ durationMs: 1500 }))).toBe(false);
  });
});

describe('rdl FSM edge transitions', () => {
  test('legsTracked=false forces setup', () => {
    const next = rdlDefinition.getNextPhase('hinge', angles(), metrics({ legsTracked: false }));
    expect(next).toBe('setup');
  });

  test('setup -> standing at standing threshold', () => {
    const next = rdlDefinition.getNextPhase(
      'setup',
      angles(),
      metrics({ avgHip: RDL_THRESHOLDS.standing })
    );
    expect(next).toBe('standing');
  });

  test('standing -> hinge at hingeStart threshold', () => {
    const next = rdlDefinition.getNextPhase(
      'standing',
      angles(),
      metrics({ avgHip: RDL_THRESHOLDS.hingeStart })
    );
    expect(next).toBe('hinge');
  });

  test('bottom -> rise at riseStart threshold', () => {
    const next = rdlDefinition.getNextPhase(
      'bottom',
      angles(),
      metrics({ avgHip: RDL_THRESHOLDS.riseStart })
    );
    expect(next).toBe('rise');
  });

  test('rise -> standing at standing threshold', () => {
    const next = rdlDefinition.getNextPhase(
      'rise',
      angles(),
      metrics({ avgHip: RDL_THRESHOLDS.standing })
    );
    expect(next).toBe('standing');
  });
});

describe('rdl calculateMetrics', () => {
  test('averages hip and knee', () => {
    const m = rdlDefinition.calculateMetrics(angles({ leftHip: 80, rightHip: 120, leftKnee: 150, rightKnee: 170 }));
    expect(m.avgHip).toBe(100);
    expect(m.avgKnee).toBe(160);
  });

  test('armsTracked is always false (RDL has no arm signal)', () => {
    expect(rdlDefinition.calculateMetrics(angles()).armsTracked).toBe(false);
  });
});
