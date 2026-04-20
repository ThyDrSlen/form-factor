import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import { hipThrustDefinition, HIP_THRUST_THRESHOLDS } from '@/lib/workouts/hip-thrust';

// ---------------------------------------------------------------------------
// Helpers mirroring tests/unit/services/fqi-faults.test.ts
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    // Baseline = peak lockout values so faults do NOT fire unless overridden.
    leftKnee: 95,
    rightKnee: 95,
    leftHip: 175,
    rightHip: 175,
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
  workoutId?: string;
}): RepContext {
  return {
    startAngles: opts.start ? angles(opts.start) : angles({ leftHip: 95, rightHip: 95 }),
    endAngles: opts.end ? angles(opts.end) : angles(),
    // bottom of rep — hips flexed to ~95°
    minAngles: opts.min ? angles(opts.min) : angles({ leftHip: 95, rightHip: 95 }),
    // top of rep — hips extended to ~175°
    maxAngles: opts.max ? angles(opts.max) : angles({ leftHip: 175, rightHip: 175 }),
    durationMs: opts.durationMs ?? 2500,
    repNumber: opts.repNumber ?? 1,
    workoutId: opts.workoutId ?? 'hip_thrust',
  };
}

function fault(id: string) {
  const f = hipThrustDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`hip-thrust fault '${id}' not found`);
  return f;
}

const NaNAngles: JointAngles = {
  leftElbow: NaN, rightElbow: NaN, leftShoulder: NaN, rightShoulder: NaN,
  leftKnee: NaN, rightKnee: NaN, leftHip: NaN, rightHip: NaN,
};

function nanCtx(): RepContext {
  return {
    startAngles: NaNAngles,
    endAngles: NaNAngles,
    minAngles: NaNAngles,
    maxAngles: NaNAngles,
    durationMs: 2500,
    repNumber: 1,
    workoutId: 'hip_thrust',
  };
}

// ---------------------------------------------------------------------------
// Definition metadata
// ---------------------------------------------------------------------------

describe('hip-thrust definition metadata', () => {
  test('has correct id and displayName', () => {
    expect(hipThrustDefinition.id).toBe('hip_thrust');
    expect(hipThrustDefinition.displayName).toBe('Hip Thrust');
  });

  test('registers 5 faults', () => {
    expect(hipThrustDefinition.faults.length).toBe(5);
  });

  test('thresholds are finite', () => {
    for (const [key, val] of Object.entries(HIP_THRUST_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
      if (typeof val !== 'number') {
        throw new Error(`HIP_THRUST_THRESHOLDS.${key} is not a number`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// shallow_depth
// ---------------------------------------------------------------------------

describe('hip-thrust fault: shallow_depth', () => {
  const f = fault('shallow_depth');

  test('positive: min hip above depth floor fires', () => {
    // depthFloor = 115; min hip 130 > 115 ⇒ fault
    const c = ctx({ min: { leftHip: 130, rightHip: 130 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min hip at proper depth does not fire', () => {
    const c = ctx({ min: { leftHip: 95, rightHip: 95 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// heel_liftoff
// ---------------------------------------------------------------------------

describe('hip-thrust fault: heel_liftoff', () => {
  const f = fault('heel_liftoff');

  test('positive: peak-knee diff over threshold fires', () => {
    // heelLiftoffKneeDiffMax = 30; diff = |85 - 160| = 75 > 30
    const c = ctx({ max: { leftKnee: 85, rightKnee: 160 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: both knees planted near 90° does not fire', () => {
    const c = ctx({ max: { leftKnee: 92, rightKnee: 98 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// incomplete_lockout
// ---------------------------------------------------------------------------

describe('hip-thrust fault: incomplete_lockout', () => {
  const f = fault('incomplete_lockout');

  test('positive: max hip below lockout threshold fires', () => {
    // incompleteLockoutMin = 155; max hip 140 < 155 ⇒ fault
    const c = ctx({ max: { leftHip: 140, rightHip: 140 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: max hip at full lockout does not fire', () => {
    const c = ctx({ max: { leftHip: 175, rightHip: 175 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// asymmetric_extension
// ---------------------------------------------------------------------------

describe('hip-thrust fault: asymmetric_extension', () => {
  const f = fault('asymmetric_extension');

  test('positive: peak hips with >12% spread fires', () => {
    // asymmetricExtMaxPct = 12; larger=175, diff=|175-140|=35, pct=20% > 12
    const c = ctx({ max: { leftHip: 140, rightHip: 175 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: peak hips within tolerance do not fire', () => {
    // diff=5, pct ~ 2.8% < 12
    const c = ctx({ max: { leftHip: 170, rightHip: 175 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hyperextension
// ---------------------------------------------------------------------------

describe('hip-thrust fault: hyperextension', () => {
  const f = fault('hyperextension');

  test('positive: peak hip over hyperextensionMax fires', () => {
    // hyperExtensionMax = 185; max hip 190 > 185 ⇒ fault
    const c = ctx({ max: { leftHip: 190, rightHip: 175 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: peak hip at full lockout (not over-arched) does not fire', () => {
    const c = ctx({ max: { leftHip: 178, rightHip: 180 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics / getNextPhase sanity
// ---------------------------------------------------------------------------

describe('hip-thrust definition sanity', () => {
  test('calculateMetrics averages hip and knee', () => {
    const m = hipThrustDefinition.calculateMetrics(angles({ leftHip: 100, rightHip: 120 }));
    expect(m.avgHip).toBe(110);
    expect(m.legsTracked).toBe(true);
  });

  test('getNextPhase: setup -> bottom when hips flex below bottomHip', () => {
    const a = angles({ leftHip: 95, rightHip: 95 });
    const m = hipThrustDefinition.calculateMetrics(a);
    expect(hipThrustDefinition.getNextPhase('setup', a, m)).toBe('bottom');
  });

  test('getNextPhase: bottom -> ascent when hips extend above ascentStart', () => {
    const a = angles({ leftHip: 125, rightHip: 125 });
    const m = hipThrustDefinition.calculateMetrics(a);
    expect(hipThrustDefinition.getNextPhase('bottom', a, m)).toBe('ascent');
  });

  test('getNextPhase: ascent -> lockout at full extension', () => {
    const a = angles({ leftHip: 170, rightHip: 170 });
    const m = hipThrustDefinition.calculateMetrics(a);
    expect(hipThrustDefinition.getNextPhase('ascent', a, m)).toBe('lockout');
  });
});
