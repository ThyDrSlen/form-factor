import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import { overheadPressDefinition, OVERHEAD_PRESS_THRESHOLDS } from '@/lib/workouts/overhead-press';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 95,
    rightShoulder: 95,
    leftKnee: 175,
    rightKnee: 175,
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
    // start: rack — elbows flexed ~90°, hips standing ~175°
    startAngles: opts.start ? angles(opts.start) : angles({ leftElbow: 95, rightElbow: 95 }),
    endAngles: opts.end ? angles(opts.end) : angles({ leftElbow: 95, rightElbow: 95 }),
    // min: rack (elbow flexed)
    minAngles: opts.min ? angles(opts.min) : angles({ leftElbow: 95, rightElbow: 95 }),
    // max: lockout — arms straight overhead (~170°)
    maxAngles: opts.max ? angles(opts.max) : angles({ leftElbow: 170, rightElbow: 170 }),
    durationMs: opts.durationMs ?? 1800,
    repNumber: opts.repNumber ?? 1,
    workoutId: opts.workoutId ?? 'overhead_press',
  };
}

function fault(id: string) {
  const f = overheadPressDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`overhead-press fault '${id}' not found`);
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
    durationMs: 1800,
    repNumber: 1,
    workoutId: 'overhead_press',
  };
}

// ---------------------------------------------------------------------------
// Definition metadata
// ---------------------------------------------------------------------------

describe('overhead-press definition metadata', () => {
  test('has correct id and displayName', () => {
    expect(overheadPressDefinition.id).toBe('overhead_press');
    expect(overheadPressDefinition.displayName).toBe('Overhead Press');
  });

  test('registers 4 faults', () => {
    expect(overheadPressDefinition.faults.length).toBe(4);
  });

  test('thresholds are finite', () => {
    for (const [key, val] of Object.entries(OVERHEAD_PRESS_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
      if (typeof val !== 'number') {
        throw new Error(`OVERHEAD_PRESS_THRESHOLDS.${key} is not a number`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// incomplete_lockout
// ---------------------------------------------------------------------------

describe('overhead-press fault: incomplete_lockout', () => {
  const f = fault('incomplete_lockout');

  test('positive: max-elbow under lockout threshold fires', () => {
    // incompleteLockoutMin = 155; max elbow 140 < 155 ⇒ fault
    const c = ctx({ max: { leftElbow: 140, rightElbow: 140 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: max-elbow at full lockout does not fire', () => {
    const c = ctx({ max: { leftElbow: 170, rightElbow: 170 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// excessive_lean
// ---------------------------------------------------------------------------

describe('overhead-press fault: excessive_lean', () => {
  const f = fault('excessive_lean');

  test('positive: hip-flex drop from start > threshold fires', () => {
    // excessiveLeanHipDeltaMax = 15;
    // start hip 175, min hip 150 → delta 25 > 15 ⇒ fault
    const c = ctx({
      start: { leftElbow: 95, rightElbow: 95, leftHip: 175, rightHip: 175 },
      min: { leftElbow: 95, rightElbow: 95, leftHip: 150, rightHip: 175 },
    });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: hip stays standing → no lean fires', () => {
    const c = ctx({
      start: { leftElbow: 95, rightElbow: 95, leftHip: 175, rightHip: 175 },
      min: { leftElbow: 95, rightElbow: 95, leftHip: 172, rightHip: 174 },
    });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// asymmetric_press
// ---------------------------------------------------------------------------

describe('overhead-press fault: asymmetric_press', () => {
  const f = fault('asymmetric_press');

  test('positive: peak elbow diff > 10% fires', () => {
    // asymmetricPressMaxPct = 10; larger=170, diff=|170-140|=30, pct ≈ 17.6% > 10
    const c = ctx({ max: { leftElbow: 140, rightElbow: 170 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: matched peak elbows do not fire', () => {
    // diff=2, pct ≈ 1.2% < 10
    const c = ctx({ max: { leftElbow: 170, rightElbow: 168 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// core_hyperextension
// ---------------------------------------------------------------------------

describe('overhead-press fault: core_hyperextension', () => {
  const f = fault('core_hyperextension');

  test('positive: peak hip above coreHyperExtensionMax fires', () => {
    // coreHyperExtensionMax = 185; max hip 195 > 185 ⇒ fault
    const c = ctx({ max: { leftElbow: 170, rightElbow: 170, leftHip: 195, rightHip: 180 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: peak hip in normal range does not fire', () => {
    const c = ctx({ max: { leftElbow: 170, rightElbow: 170, leftHip: 178, rightHip: 180 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics / getNextPhase sanity
// ---------------------------------------------------------------------------

describe('overhead-press definition sanity', () => {
  test('calculateMetrics averages elbow/shoulder/hip', () => {
    const m = overheadPressDefinition.calculateMetrics(angles({ leftElbow: 100, rightElbow: 120 }));
    expect(m.avgElbow).toBe(110);
    expect(m.armsTracked).toBe(true);
  });

  test('getNextPhase: setup -> rack at racked-elbow threshold', () => {
    const a = angles({ leftElbow: 95, rightElbow: 95 });
    const m = overheadPressDefinition.calculateMetrics(a);
    expect(overheadPressDefinition.getNextPhase('setup', a, m)).toBe('rack');
  });

  test('getNextPhase: rack -> press when elbow starts extending', () => {
    const a = angles({ leftElbow: 125, rightElbow: 125 });
    const m = overheadPressDefinition.calculateMetrics(a);
    expect(overheadPressDefinition.getNextPhase('rack', a, m)).toBe('press');
  });

  test('getNextPhase: press -> lockout at full extension', () => {
    const a = angles({ leftElbow: 170, rightElbow: 170 });
    const m = overheadPressDefinition.calculateMetrics(a);
    expect(overheadPressDefinition.getNextPhase('press', a, m)).toBe('lockout');
  });
});
