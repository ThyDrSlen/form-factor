import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import { barbellRowDefinition, BARBELL_ROW_THRESHOLDS } from '@/lib/workouts/barbell-row';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 165,
    rightElbow: 165,
    leftShoulder: 95,
    rightShoulder: 95,
    leftKnee: 145,
    rightKnee: 145,
    leftHip: 105,
    rightHip: 105,
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
    startAngles: opts.start ? angles(opts.start) : angles(),
    endAngles: opts.end ? angles(opts.end) : angles(),
    // peak pull — elbows flexed ~80°
    minAngles: opts.min ? angles(opts.min) : angles({ leftElbow: 80, rightElbow: 80 }),
    // start of rep — elbows extended
    maxAngles: opts.max ? angles(opts.max) : angles({ leftElbow: 165, rightElbow: 165, leftShoulder: 100, rightShoulder: 100 }),
    durationMs: opts.durationMs ?? 2000,
    repNumber: opts.repNumber ?? 1,
    workoutId: opts.workoutId ?? 'barbell_row',
  };
}

function fault(id: string) {
  const f = barbellRowDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`barbell-row fault '${id}' not found`);
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
    durationMs: 2000,
    repNumber: 1,
    workoutId: 'barbell_row',
  };
}

// ---------------------------------------------------------------------------
// Definition metadata
// ---------------------------------------------------------------------------

describe('barbell-row definition metadata', () => {
  test('has correct id and displayName', () => {
    expect(barbellRowDefinition.id).toBe('barbell_row');
    expect(barbellRowDefinition.displayName).toBe('Barbell Row');
  });

  test('registers 4 faults', () => {
    expect(barbellRowDefinition.faults.length).toBe(4);
  });

  test('thresholds are finite', () => {
    for (const [key, val] of Object.entries(BARBELL_ROW_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
      if (typeof val !== 'number') {
        throw new Error(`BARBELL_ROW_THRESHOLDS.${key} is not a number`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// incomplete_lockout
// ---------------------------------------------------------------------------

describe('barbell-row fault: incomplete_lockout', () => {
  const f = fault('incomplete_lockout');

  test('positive: peak-pull elbow above incompleteLockoutMin fires', () => {
    // incompleteLockoutMin = 100; min elbow 120 > 100 ⇒ fault
    const c = ctx({ min: { leftElbow: 120, rightElbow: 120 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: peak-pull elbow at full contraction does not fire', () => {
    const c = ctx({ min: { leftElbow: 78, rightElbow: 82 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rounded_back
// ---------------------------------------------------------------------------

describe('barbell-row fault: rounded_back', () => {
  const f = fault('rounded_back');

  test('positive: shoulder delta outpaces hip delta at peak fires', () => {
    // Hip stays roughly flat, shoulder delta large → rounded back
    // hip delta max=5, shoulder delta max=25 → sequenceCheck fires + >15
    const c = ctx({
      min: { leftElbow: 80, rightElbow: 80, leftHip: 105, rightHip: 105, leftShoulder: 85, rightShoulder: 85 },
      max: { leftElbow: 165, rightElbow: 165, leftHip: 110, rightHip: 110, leftShoulder: 125, rightShoulder: 120 },
    });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: hip-led rise (hip delta > shoulder delta) does not fire', () => {
    // hip delta 25 > shoulder delta 10 → no fault
    const c = ctx({
      min: { leftElbow: 80, rightElbow: 80, leftHip: 100, rightHip: 100, leftShoulder: 90, rightShoulder: 90 },
      max: { leftElbow: 165, rightElbow: 165, leftHip: 125, rightHip: 125, leftShoulder: 100, rightShoulder: 100 },
    });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// asymmetric_pull
// ---------------------------------------------------------------------------

describe('barbell-row fault: asymmetric_pull', () => {
  const f = fault('asymmetric_pull');

  test('positive: peak-pull elbow diff > 15% of larger fires', () => {
    // larger=120, diff=|70-120|=50, pct ≈ 42% > 15
    const c = ctx({ min: { leftElbow: 70, rightElbow: 120 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: matched elbows do not fire', () => {
    // larger=85, diff=5, pct ≈ 6% < 15
    const c = ctx({ min: { leftElbow: 80, rightElbow: 85 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// elbows_high
// ---------------------------------------------------------------------------

describe('barbell-row fault: elbows_high', () => {
  const f = fault('elbows_high');

  test('positive: peak shoulder-abduction above threshold fires', () => {
    // elbowsHighShoulderMax = 115; max shoulder 130 > 115 ⇒ fault
    const c = ctx({ max: { leftShoulder: 130, rightShoulder: 115 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: shoulder tucked at peak does not fire', () => {
    const c = ctx({ max: { leftShoulder: 100, rightShoulder: 105 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics / getNextPhase sanity
// ---------------------------------------------------------------------------

describe('barbell-row definition sanity', () => {
  test('calculateMetrics averages elbow/shoulder/hip', () => {
    const m = barbellRowDefinition.calculateMetrics(angles({ leftElbow: 90, rightElbow: 110, leftHip: 100, rightHip: 110 }));
    expect(m.avgElbow).toBe(100);
    expect(m.avgHip).toBe(105);
    expect(m.armsTracked).toBe(true);
  });

  test('getNextPhase: setup -> hinged when hinged + extended', () => {
    const a = angles({ leftHip: 105, rightHip: 105, leftElbow: 165, rightElbow: 165 });
    const m = barbellRowDefinition.calculateMetrics(a);
    expect(barbellRowDefinition.getNextPhase('setup', a, m)).toBe('hinged');
  });

  test('getNextPhase: hinged -> pulling as elbow flexes', () => {
    const a = angles({ leftElbow: 135, rightElbow: 135 });
    const m = barbellRowDefinition.calculateMetrics(a);
    expect(barbellRowDefinition.getNextPhase('hinged', a, m)).toBe('pulling');
  });

  test('getNextPhase: pulling -> top at peak pull', () => {
    const a = angles({ leftElbow: 82, rightElbow: 82 });
    const m = barbellRowDefinition.calculateMetrics(a);
    expect(barbellRowDefinition.getNextPhase('pulling', a, m)).toBe('top');
  });
});
