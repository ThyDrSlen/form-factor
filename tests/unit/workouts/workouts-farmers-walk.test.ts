/**
 * Parametric form-model coverage for lib/workouts/farmers-walk.ts.
 *
 * Farmers walk is about maintaining posture during a carry, not ROM —
 * so tests focus on posture-fault boundaries and phase transitions
 * between pickup -> carry -> set_down.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import {
  farmersWalkDefinition,
  FARMERS_WALK_THRESHOLDS,
  type FarmersWalkMetrics,
} from '@/lib/workouts/farmers-walk';
import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 95,
    rightShoulder: 95,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
    ...overrides,
  };
}

function metrics(overrides: Partial<FarmersWalkMetrics> = {}): FarmersWalkMetrics {
  return {
    avgShoulder: 95,
    avgHip: 170,
    shoulderSymmetry: 0,
    hipSymmetry: 0,
    armsTracked: true,
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
    durationMs: opts.durationMs ?? 6000,
    repNumber: 1,
    workoutId: 'farmers_walk',
  };
}

function fault(id: string) {
  const f = farmersWalkDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`FarmersWalk fault '${id}' not found`);
  return f;
}

describe('farmers_walk registration', () => {
  test('farmers_walk is registered as a detection mode', () => {
    expect(getWorkoutIds()).toContain('farmers_walk');
  });

  test('getWorkoutByMode returns the farmers_walk definition', () => {
    const def = getWorkoutByMode('farmers_walk');
    expect(def.id).toBe('farmers_walk');
    expect(def.category).toBe('full_body');
  });

  test('thresholds are finite and asymmetry thresholds are positive', () => {
    for (const val of Object.values(FARMERS_WALK_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
    }
    expect(FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax).toBeGreaterThan(0);
    expect(FARMERS_WALK_THRESHOLDS.hipAsymmetryMax).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = farmersWalkDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1, 5);
  });
});

describe('farmers_walk fault: lateral_lean', () => {
  const f = fault('lateral_lean');

  test('positive: hip diff > hipAsymmetryMax fires', () => {
    const c = ctx({ min: { leftHip: 150, rightHip: 170 } }); // diff=20 > 15
    expect(f.condition(c)).toBe(true);
  });

  test('negative: hip diff at hipAsymmetryMax does NOT fire (strict >)', () => {
    // diff = exactly hipAsymmetryMax
    const c = ctx({
      min: {
        leftHip: 170,
        rightHip: 170 - FARMERS_WALK_THRESHOLDS.hipAsymmetryMax,
      },
    });
    expect(f.condition(c)).toBe(false);
  });
});

describe('farmers_walk fault: shoulder_shrug', () => {
  const f = fault('shoulder_shrug');

  test('positive: min shoulder below shoulderElevated fires', () => {
    const c = ctx({ min: { leftShoulder: FARMERS_WALK_THRESHOLDS.shoulderElevated - 5, rightShoulder: 90 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min shoulder at shoulderElevated does NOT fire', () => {
    const c = ctx({
      min: {
        leftShoulder: FARMERS_WALK_THRESHOLDS.shoulderElevated,
        rightShoulder: FARMERS_WALK_THRESHOLDS.shoulderElevated,
      },
    });
    expect(f.condition(c)).toBe(false);
  });
});

describe('farmers_walk fault: forward_lean', () => {
  const f = fault('forward_lean');

  test('positive: maxHip below standingHip-15 fires', () => {
    const c = ctx({
      max: {
        leftHip: FARMERS_WALK_THRESHOLDS.standingHip - 20,
        rightHip: FARMERS_WALK_THRESHOLDS.standingHip - 20,
      },
    });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: maxHip at standingHip does NOT fire', () => {
    const c = ctx({
      max: { leftHip: FARMERS_WALK_THRESHOLDS.standingHip, rightHip: FARMERS_WALK_THRESHOLDS.standingHip },
    });
    expect(f.condition(c)).toBe(false);
  });
});

describe('farmers_walk fault: asymmetric_shoulders', () => {
  const f = fault('asymmetric_shoulders');

  test('positive: shoulder diff > shoulderAsymmetryMax fires', () => {
    const c = ctx({ min: { leftShoulder: 80, rightShoulder: 100 } }); // diff=20 > 15
    expect(f.condition(c)).toBe(true);
  });

  test('negative: shoulder diff at shoulderAsymmetryMax does NOT fire', () => {
    const c = ctx({
      min: { leftShoulder: 90, rightShoulder: 90 + FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax },
    });
    expect(f.condition(c)).toBe(false);
  });
});

describe('farmers_walk fault: short_carry', () => {
  const f = fault('short_carry');

  test('positive: duration < 5000ms fires', () => {
    expect(f.condition(ctx({ durationMs: 4000 }))).toBe(true);
  });

  test('negative: duration at 5000ms does NOT fire (strict <)', () => {
    expect(f.condition(ctx({ durationMs: 5000 }))).toBe(false);
  });
});

describe('farmers_walk FSM transitions', () => {
  test('armsTracked=false forces setup', () => {
    const next = farmersWalkDefinition.getNextPhase('carry', angles(), metrics({ armsTracked: false }));
    expect(next).toBe('setup');
  });

  test('legsTracked=false forces setup', () => {
    const next = farmersWalkDefinition.getNextPhase('carry', angles(), metrics({ legsTracked: false }));
    expect(next).toBe('setup');
  });

  test('pickup -> carry when hip reaches standingHip', () => {
    const next = farmersWalkDefinition.getNextPhase(
      'pickup',
      angles(),
      metrics({ avgHip: FARMERS_WALK_THRESHOLDS.standingHip })
    );
    expect(next).toBe('carry');
  });

  test('carry -> set_down when hip drops to hingeHip', () => {
    const next = farmersWalkDefinition.getNextPhase(
      'carry',
      angles(),
      metrics({ avgHip: FARMERS_WALK_THRESHOLDS.hingeHip })
    );
    expect(next).toBe('set_down');
  });
});

describe('farmers_walk calculateMetrics symmetry math', () => {
  test('shoulderSymmetry reflects |left - right|', () => {
    const m = farmersWalkDefinition.calculateMetrics(angles({ leftShoulder: 85, rightShoulder: 105 }));
    expect(m.shoulderSymmetry).toBe(20);
  });

  test('hipSymmetry reflects |left - right|', () => {
    const m = farmersWalkDefinition.calculateMetrics(angles({ leftHip: 160, rightHip: 175 }));
    expect(m.hipSymmetry).toBe(15);
  });
});
