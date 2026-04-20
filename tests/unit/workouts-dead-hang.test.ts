import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';
import { deadHangDefinition, DEAD_HANG_THRESHOLDS } from '@/lib/workouts/dead-hang';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

test('dead_hang is registered as a detection mode', () => {
  expect(getWorkoutIds()).toContain('dead_hang');
});

test('dead_hang exposes a UI adapter', () => {
  const def = getWorkoutByMode('dead_hang');
  expect(def.id).toBe('dead_hang');
  expect(def.ui).toBeTruthy();
  expect(def.ui?.primaryMetric.key).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Added-in-#438 faults: scapular_retraction, kipping_swing, grip_shift
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 100,
    rightShoulder: 100,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
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
    durationMs: opts.durationMs ?? 5000,
    repNumber: 1,
    workoutId: 'dead_hang',
  };
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
    durationMs: 5000,
    repNumber: 1,
    workoutId: 'dead_hang',
  };
}

function fault(id: string) {
  const f = deadHangDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Dead-hang fault '${id}' not found`);
  return f;
}

test('dead_hang registers 6 faults after extension', () => {
  expect(deadHangDefinition.faults.length).toBe(6);
});

// scapular_retraction
describe('dead_hang fault: scapular_retraction', () => {
  const f = fault('scapular_retraction');

  test('positive: both shoulders below scapularRetractionMin fires fault', () => {
    // scapularRetractionMin = 80
    const c = ctx({ max: { leftShoulder: 70, rightShoulder: 70 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: shoulders packed (>= 80) does not fire', () => {
    const c = ctx({ max: { leftShoulder: 95, rightShoulder: 95 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// kipping_swing
describe('dead_hang fault: kipping_swing', () => {
  const f = fault('kipping_swing');

  test('positive: hip oscillation > kippingOscillationMin fires fault', () => {
    // kippingOscillationMin = 15, leftHip delta = |200? no. start=170, max=190 -> 20 > 15
    const c = ctx({
      start: { leftHip: 170, rightHip: 170, leftShoulder: 100, rightShoulder: 100 },
      max: { leftHip: 190, rightHip: 170, leftShoulder: 100, rightShoulder: 100 },
    });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: steady body (deltas under threshold) does not fire', () => {
    const c = ctx({
      start: { leftHip: 170, rightHip: 170, leftShoulder: 100, rightShoulder: 100 },
      max: { leftHip: 172, rightHip: 172, leftShoulder: 102, rightShoulder: 102 },
    });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// grip_shift
describe('dead_hang fault: grip_shift', () => {
  const f = fault('grip_shift');

  test('positive: left/right elbow delta > gripShiftMaxDiff fires fault', () => {
    // gripShiftMaxDiff = 20; delta = |150 - 180| = 30 > 20
    const c = ctx({ max: { leftElbow: 150, rightElbow: 180 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: elbow delta within threshold does not fire', () => {
    const c = ctx({ max: { leftElbow: 170, rightElbow: 180 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

test('DEAD_HANG_THRESHOLDS exposes added fields', () => {
  expect(DEAD_HANG_THRESHOLDS.scapularRetractionMin).toBeGreaterThan(0);
  expect(DEAD_HANG_THRESHOLDS.kippingOscillationMin).toBeGreaterThan(0);
  expect(DEAD_HANG_THRESHOLDS.gripShiftMaxDiff).toBeGreaterThan(0);
});

