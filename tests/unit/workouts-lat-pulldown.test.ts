import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import { latPulldownDefinition, LAT_PULLDOWN_THRESHOLDS } from '@/lib/workouts/lat-pulldown';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 165,
    rightElbow: 165,
    leftShoulder: 150,
    rightShoulder: 150,
    leftKnee: 95,
    rightKnee: 95,
    leftHip: 95,
    rightHip: 95,
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
    // start: arms overhead (elbow ~165°, shoulder ~150°)
    startAngles: opts.start ? angles(opts.start) : angles(),
    endAngles: opts.end ? angles(opts.end) : angles(),
    // min: peak pull (elbow ~80°, shoulder still ~115°)
    minAngles: opts.min ? angles(opts.min) : angles({ leftElbow: 80, rightElbow: 80, leftShoulder: 115, rightShoulder: 115 }),
    // max: start of rep
    maxAngles: opts.max ? angles(opts.max) : angles({ leftElbow: 170, rightElbow: 170, leftShoulder: 160, rightShoulder: 160 }),
    durationMs: opts.durationMs ?? 2200,
    repNumber: opts.repNumber ?? 1,
    workoutId: opts.workoutId ?? 'lat_pulldown',
  };
}

function fault(id: string) {
  const f = latPulldownDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`lat-pulldown fault '${id}' not found`);
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
    durationMs: 2200,
    repNumber: 1,
    workoutId: 'lat_pulldown',
  };
}

// ---------------------------------------------------------------------------
// Definition metadata
// ---------------------------------------------------------------------------

describe('lat-pulldown definition metadata', () => {
  test('has correct id and displayName', () => {
    expect(latPulldownDefinition.id).toBe('lat_pulldown');
    expect(latPulldownDefinition.displayName).toBe('Lat Pulldown');
  });

  test('registers 4 faults', () => {
    expect(latPulldownDefinition.faults.length).toBe(4);
  });

  test('thresholds are finite', () => {
    for (const [key, val] of Object.entries(LAT_PULLDOWN_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
      if (typeof val !== 'number') {
        throw new Error(`LAT_PULLDOWN_THRESHOLDS.${key} is not a number`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// incomplete_lockout
// ---------------------------------------------------------------------------

describe('lat-pulldown fault: incomplete_lockout', () => {
  const f = fault('incomplete_lockout');

  test('positive: peak-pull elbow above 105 fires', () => {
    // incompleteLockoutMin = 105; min elbow 115 > 105 ⇒ fault
    const c = ctx({ min: { leftElbow: 115, rightElbow: 115 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: peak-pull elbow at full contraction does not fire', () => {
    const c = ctx({ min: { leftElbow: 80, rightElbow: 82 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// excessive_lean
// ---------------------------------------------------------------------------

describe('lat-pulldown fault: excessive_lean', () => {
  const f = fault('excessive_lean');

  test('positive: shoulder drop from start to min above threshold fires', () => {
    // excessiveLeanShoulderDeltaMax = 60;
    // start shoulder 150, min shoulder 80 → delta 70 > 60 ⇒ fault
    const c = ctx({
      start: { leftShoulder: 150, rightShoulder: 150 },
      min: { leftElbow: 80, rightElbow: 80, leftShoulder: 80, rightShoulder: 80 },
    });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: normal shoulder path (small delta) does not fire', () => {
    const c = ctx({
      start: { leftShoulder: 150, rightShoulder: 150 },
      min: { leftElbow: 80, rightElbow: 80, leftShoulder: 115, rightShoulder: 115 },
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

describe('lat-pulldown fault: asymmetric_pull', () => {
  const f = fault('asymmetric_pull');

  test('positive: peak-pull elbow diff > 15% fires', () => {
    // larger=120, diff=|75-120|=45, pct ≈ 37% > 15
    const c = ctx({ min: { leftElbow: 75, rightElbow: 120 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: matched elbows do not fire', () => {
    const c = ctx({ min: { leftElbow: 80, rightElbow: 85 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// elbows_flare
// ---------------------------------------------------------------------------

describe('lat-pulldown fault: elbows_flare', () => {
  const f = fault('elbows_flare');

  test('positive: peak shoulder-abduction above threshold fires', () => {
    // elbowsFlareShoulderMax = 125; max shoulder 140 > 125 ⇒ fault
    const c = ctx({ max: { leftShoulder: 140, rightShoulder: 120 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: shoulder at optimal path does not fire', () => {
    const c = ctx({ max: { leftShoulder: 120, rightShoulder: 115 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics / getNextPhase sanity
// ---------------------------------------------------------------------------

describe('lat-pulldown definition sanity', () => {
  test('calculateMetrics averages elbow and shoulder', () => {
    const m = latPulldownDefinition.calculateMetrics(angles({ leftElbow: 100, rightElbow: 120, leftShoulder: 110, rightShoulder: 130 }));
    expect(m.avgElbow).toBe(110);
    expect(m.avgShoulder).toBe(120);
    expect(m.armsTracked).toBe(true);
  });

  test('getNextPhase: setup -> top at arms-extended threshold', () => {
    const a = angles({ leftElbow: 170, rightElbow: 170 });
    const m = latPulldownDefinition.calculateMetrics(a);
    expect(latPulldownDefinition.getNextPhase('setup', a, m)).toBe('top');
  });

  test('getNextPhase: top -> pulling as elbow flexes', () => {
    const a = angles({ leftElbow: 140, rightElbow: 140 });
    const m = latPulldownDefinition.calculateMetrics(a);
    expect(latPulldownDefinition.getNextPhase('top', a, m)).toBe('pulling');
  });

  test('getNextPhase: pulling -> bottom at peak pull', () => {
    const a = angles({ leftElbow: 85, rightElbow: 85 });
    const m = latPulldownDefinition.calculateMetrics(a);
    expect(latPulldownDefinition.getNextPhase('pulling', a, m)).toBe('bottom');
  });
});
