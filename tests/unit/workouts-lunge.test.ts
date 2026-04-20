import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import { lungeDefinition, LUNGE_THRESHOLDS } from '@/lib/workouts/lunge';
import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

// ---------------------------------------------------------------------------
// Helpers mirroring tests/unit/services/fqi-faults.test.ts
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    // "Neutral" knee / hip values chosen close to the lunge `optimal`
    // and above all fault thresholds so the baseline never fires faults.
    leftKnee: 95,
    rightKnee: 95,
    leftHip: 110,
    rightHip: 110,
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
    startAngles: angles(opts.start),
    endAngles: opts.end ? angles(opts.end) : angles({ leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 }),
    minAngles: angles(opts.min),
    maxAngles: angles(opts.max),
    durationMs: opts.durationMs ?? 2500,
    repNumber: opts.repNumber ?? 1,
    workoutId: opts.workoutId ?? 'lunge',
  };
}

function fault(id: string) {
  const f = lungeDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Lunge fault '${id}' not found`);
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
    workoutId: 'lunge',
  };
}

// ---------------------------------------------------------------------------
// Registration sanity
// ---------------------------------------------------------------------------

describe('lunge registration', () => {
  test('lunge is registered as a detection mode', () => {
    expect(getWorkoutIds()).toContain('lunge');
  });

  test('getWorkoutByMode returns the lunge definition', () => {
    const def = getWorkoutByMode('lunge');
    expect(def.id).toBe('lunge');
    expect(def.displayName).toBe('Lunge');
  });

  test('lunge registers 6 faults', () => {
    expect(lungeDefinition.faults.length).toBe(6);
  });

  test('lunge thresholds are finite', () => {
    for (const [key, val] of Object.entries(LUNGE_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
      // Typescript narrow: all LUNGE_THRESHOLDS values are numeric
      if (typeof val !== 'number') {
        throw new Error(`LUNGE_THRESHOLDS.${key} is not a number`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// shallow_depth
// ---------------------------------------------------------------------------

describe('lunge fault: shallow_depth', () => {
  const f = fault('shallow_depth');

  test('positive: min knee well above parallel+15 fires fault', () => {
    // parallel = 80 by default; 80+15=95, so 120 > 95 ⇒ fault
    const c = ctx({ min: { leftKnee: 120, rightKnee: 120 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min knee at optimal depth does not fire', () => {
    const c = ctx({ min: { leftKnee: 85, rightKnee: 85 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// knee_cave
// ---------------------------------------------------------------------------

describe('lunge fault: knee_cave', () => {
  const f = fault('knee_cave');

  test('positive: left/right knee diff beyond kneeCaveMax fires fault', () => {
    // kneeCaveMax = 25, diff = |60 - 100| = 40 > 25
    const c = ctx({ min: { leftKnee: 60, rightKnee: 100 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: symmetric knees do not fire', () => {
    const c = ctx({ min: { leftKnee: 90, rightKnee: 95 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// heels_off_ground
// ---------------------------------------------------------------------------

describe('lunge fault: heels_off_ground', () => {
  const f = fault('heels_off_ground');

  test('positive: rear-vs-front hip diff exceeding heelOffHipDiffMax fires', () => {
    // heelOffHipDiffMax = 30, diff = |80 - 130| = 50 > 30
    const c = ctx({ min: { leftHip: 80, rightHip: 130 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: hips balanced does not fire', () => {
    const c = ctx({ min: { leftHip: 105, rightHip: 115 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// asymmetric_depth
// ---------------------------------------------------------------------------

describe('lunge fault: asymmetric_depth', () => {
  const f = fault('asymmetric_depth');

  test('positive: one knee well shallower than the other fires (>40% diff)', () => {
    // larger=170, diff=|60-170|=110, pct ≈ 64.7% > 40
    const c = ctx({ min: { leftKnee: 60, rightKnee: 170 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: both knees nearly matched does not fire', () => {
    // larger=100, diff=5, pct=5% < 40
    const c = ctx({ min: { leftKnee: 95, rightKnee: 100 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// forward_knee
// ---------------------------------------------------------------------------

describe('lunge fault: forward_knee', () => {
  const f = fault('forward_knee');

  test('positive: front knee past frontKneeForwardLimit (acute) fires fault', () => {
    // frontKneeForwardLimit = 70, min front = 55 < 70
    const c = ctx({ min: { leftKnee: 55, rightKnee: 90 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: knee at or beyond the limit does not fire', () => {
    // both at/above 70
    const c = ctx({ min: { leftKnee: 80, rightKnee: 95 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hyper_extension
// ---------------------------------------------------------------------------

describe('lunge fault: hyper_extension', () => {
  const f = fault('hyper_extension');

  test('positive: end-rep knee beyond hyperExtensionMax fires fault', () => {
    // hyperExtensionMax = 182, max end = 185 > 182
    const c = ctx({ end: { leftKnee: 185, rightKnee: 170 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: end-rep near lockout but below hyperextension does not fire', () => {
    const c = ctx({ end: { leftKnee: 175, rightKnee: 178 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics / getNextPhase sanity
// ---------------------------------------------------------------------------

describe('lunge definition sanity', () => {
  test('calculateMetrics picks the deeper knee as frontKnee', () => {
    const m = lungeDefinition.calculateMetrics(angles({ leftKnee: 85, rightKnee: 165 }));
    expect(m.frontKnee).toBe(85);
    expect(m.rearKnee).toBe(165);
    expect(m.legsTracked).toBe(true);
  });

  test('getNextPhase transitions setup -> standing at threshold', () => {
    const a = angles({ leftKnee: 170, rightKnee: 170 });
    const m = lungeDefinition.calculateMetrics(a);
    expect(lungeDefinition.getNextPhase('setup', a, m)).toBe('standing');
  });

  test('getNextPhase transitions standing -> descent when knee flexes', () => {
    const a = angles({ leftKnee: 140, rightKnee: 160 });
    const m = lungeDefinition.calculateMetrics(a);
    expect(lungeDefinition.getNextPhase('standing', a, m)).toBe('descent');
  });
});
