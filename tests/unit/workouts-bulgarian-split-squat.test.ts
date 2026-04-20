import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import {
  bulgarianSplitSquatDefinition,
  BULGARIAN_SPLIT_SQUAT_THRESHOLDS,
} from '@/lib/workouts/bulgarian-split-squat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 95,
    rightKnee: 120,
    leftHip: 115,
    rightHip: 125,
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
    startAngles: opts.start ? angles(opts.start) : angles({ leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 }),
    endAngles: opts.end ? angles(opts.end) : angles({ leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 }),
    minAngles: opts.min ? angles(opts.min) : angles(),
    maxAngles: opts.max ? angles(opts.max) : angles({ leftKnee: 175, rightKnee: 175, leftHip: 175, rightHip: 175 }),
    durationMs: opts.durationMs ?? 2500,
    repNumber: opts.repNumber ?? 1,
    workoutId: opts.workoutId ?? 'bulgarian_split_squat',
  };
}

function fault(id: string) {
  const f = bulgarianSplitSquatDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`BSS fault '${id}' not found`);
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
    workoutId: 'bulgarian_split_squat',
  };
}

// ---------------------------------------------------------------------------
// Definition metadata
// ---------------------------------------------------------------------------

describe('bulgarian-split-squat definition metadata', () => {
  test('has correct id and displayName', () => {
    expect(bulgarianSplitSquatDefinition.id).toBe('bulgarian_split_squat');
    expect(bulgarianSplitSquatDefinition.displayName).toBe('Bulgarian Split Squat');
  });

  test('registers 4 faults', () => {
    expect(bulgarianSplitSquatDefinition.faults.length).toBe(4);
  });

  test('thresholds are finite', () => {
    for (const [key, val] of Object.entries(BULGARIAN_SPLIT_SQUAT_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
      if (typeof val !== 'number') {
        throw new Error(`BULGARIAN_SPLIT_SQUAT_THRESHOLDS.${key} is not a number`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// shallow_depth
// ---------------------------------------------------------------------------

describe('bulgarian-split-squat fault: shallow_depth', () => {
  const f = fault('shallow_depth');

  test('positive: deeper-knee above depthFloor fires fault', () => {
    // depthFloor = 115; min-of-two = 125 > 115 ⇒ fault
    const c = ctx({ min: { leftKnee: 125, rightKnee: 140 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: deep front knee (at parallel) does not fire', () => {
    const c = ctx({ min: { leftKnee: 85, rightKnee: 130 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// forward_knee
// ---------------------------------------------------------------------------

describe('bulgarian-split-squat fault: forward_knee', () => {
  const f = fault('forward_knee');

  test('positive: front knee past frontKneeForwardLimit fires fault', () => {
    // frontKneeForwardLimit = 65; min-of-two = 50 < 65 ⇒ fault
    const c = ctx({ min: { leftKnee: 50, rightKnee: 110 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: front knee above the limit does not fire', () => {
    const c = ctx({ min: { leftKnee: 75, rightKnee: 120 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// asymmetric_drive
// ---------------------------------------------------------------------------

describe('bulgarian-split-squat fault: asymmetric_drive', () => {
  const f = fault('asymmetric_drive');

  test('positive: large hip asymmetry at bottom fires', () => {
    // asymmetricDriveMaxPct = 15; larger=130, diff=|130-80|=50, pct ≈ 38% > 15
    const c = ctx({ min: { leftHip: 80, rightHip: 130 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: balanced hip drop does not fire', () => {
    const c = ctx({ min: { leftHip: 118, rightHip: 125 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// heel_collapse
// ---------------------------------------------------------------------------

describe('bulgarian-split-squat fault: heel_collapse', () => {
  const f = fault('heel_collapse');

  test('positive: extreme acute front-knee angle fires', () => {
    // frontKneeForwardLimit - 10 = 55; min-of-two = 40 < 55 ⇒ fault
    const c = ctx({ min: { leftKnee: 40, rightKnee: 115 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: normal front-knee angle does not fire', () => {
    const c = ctx({ min: { leftKnee: 85, rightKnee: 120 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics / getNextPhase sanity
// ---------------------------------------------------------------------------

describe('bulgarian-split-squat definition sanity', () => {
  test('calculateMetrics picks the deeper knee as frontKnee', () => {
    const m = bulgarianSplitSquatDefinition.calculateMetrics(angles({ leftKnee: 90, rightKnee: 130 }));
    expect(m.frontKnee).toBe(90);
    expect(m.rearKnee).toBe(130);
    expect(m.legsTracked).toBe(true);
  });

  test('getNextPhase: setup -> standing at standing threshold', () => {
    const a = angles({ leftKnee: 170, rightKnee: 170 });
    const m = bulgarianSplitSquatDefinition.calculateMetrics(a);
    expect(bulgarianSplitSquatDefinition.getNextPhase('setup', a, m)).toBe('standing');
  });

  test('getNextPhase: standing -> descent when front knee starts flexing', () => {
    const a = angles({ leftKnee: 140, rightKnee: 165 });
    const m = bulgarianSplitSquatDefinition.calculateMetrics(a);
    expect(bulgarianSplitSquatDefinition.getNextPhase('standing', a, m)).toBe('descent');
  });

  test('getNextPhase: descent -> bottom at parallel threshold', () => {
    const a = angles({ leftKnee: 90, rightKnee: 130 });
    const m = bulgarianSplitSquatDefinition.calculateMetrics(a);
    expect(bulgarianSplitSquatDefinition.getNextPhase('descent', a, m)).toBe('bottom');
  });
});
