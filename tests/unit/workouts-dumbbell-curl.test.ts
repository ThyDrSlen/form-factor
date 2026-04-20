import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import { dumbbellCurlDefinition, DUMBBELL_CURL_THRESHOLDS } from '@/lib/workouts/dumbbell-curl';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 90,
    rightShoulder: 90,
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
    // start: standing, arms extended
    startAngles: opts.start ? angles(opts.start) : angles(),
    endAngles: opts.end ? angles(opts.end) : angles(),
    // min: peak curl — elbow flexed ~60°, hips still standing
    minAngles: opts.min ? angles(opts.min) : angles({ leftElbow: 60, rightElbow: 60 }),
    // max: bottom/extended
    maxAngles: opts.max ? angles(opts.max) : angles(),
    durationMs: opts.durationMs ?? 1500,
    repNumber: opts.repNumber ?? 1,
    workoutId: opts.workoutId ?? 'dumbbell_curl',
  };
}

function fault(id: string) {
  const f = dumbbellCurlDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`dumbbell-curl fault '${id}' not found`);
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
    durationMs: 1500,
    repNumber: 1,
    workoutId: 'dumbbell_curl',
  };
}

// ---------------------------------------------------------------------------
// Definition metadata
// ---------------------------------------------------------------------------

describe('dumbbell-curl definition metadata', () => {
  test('has correct id and displayName', () => {
    expect(dumbbellCurlDefinition.id).toBe('dumbbell_curl');
    expect(dumbbellCurlDefinition.displayName).toBe('Dumbbell Curl');
  });

  test('registers 3 faults', () => {
    expect(dumbbellCurlDefinition.faults.length).toBe(3);
  });

  test('thresholds are finite', () => {
    for (const [key, val] of Object.entries(DUMBBELL_CURL_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
      if (typeof val !== 'number') {
        throw new Error(`DUMBBELL_CURL_THRESHOLDS.${key} is not a number`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// swinging
// ---------------------------------------------------------------------------

describe('dumbbell-curl fault: swinging', () => {
  const f = fault('swinging');

  test('positive: hip-flex drop > threshold fires', () => {
    // swingingHipDeltaMax = 15; start hip 175, min hip 150 → delta 25 > 15
    const c = ctx({
      start: { leftHip: 175, rightHip: 175 },
      min: { leftElbow: 60, rightElbow: 60, leftHip: 150, rightHip: 175 },
    });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: hips stay standing (small delta) does not fire', () => {
    const c = ctx({
      start: { leftHip: 175, rightHip: 175 },
      min: { leftElbow: 60, rightElbow: 60, leftHip: 170, rightHip: 173 },
    });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// incomplete_lockout
// ---------------------------------------------------------------------------

describe('dumbbell-curl fault: incomplete_lockout', () => {
  const f = fault('incomplete_lockout');

  test('positive: peak-curl elbow above incompleteLockoutMin fires', () => {
    // incompleteLockoutMin = 80; min elbow 100 > 80 ⇒ fault
    const c = ctx({ min: { leftElbow: 100, rightElbow: 100 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: full-curl elbow does not fire', () => {
    const c = ctx({ min: { leftElbow: 60, rightElbow: 60 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// asymmetric_curl
// ---------------------------------------------------------------------------

describe('dumbbell-curl fault: asymmetric_curl', () => {
  const f = fault('asymmetric_curl');

  test('positive: peak-curl elbow diff > 15% fires', () => {
    // larger=120, diff=|55-120|=65, pct ≈ 54% > 15
    const c = ctx({ min: { leftElbow: 55, rightElbow: 120 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: matched peak-curl elbows do not fire', () => {
    const c = ctx({ min: { leftElbow: 60, rightElbow: 65 } });
    expect(f.condition(c)).toBe(false);
  });

  test('NaN-angles guard: returns false on NaN angles', () => {
    expect(f.condition(nanCtx())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics / getNextPhase sanity
// ---------------------------------------------------------------------------

describe('dumbbell-curl definition sanity', () => {
  test('calculateMetrics averages elbow/shoulder/hip', () => {
    const m = dumbbellCurlDefinition.calculateMetrics(angles({ leftElbow: 100, rightElbow: 120 }));
    expect(m.avgElbow).toBe(110);
    expect(m.armsTracked).toBe(true);
  });

  test('getNextPhase: setup -> bottom when arms extended', () => {
    const a = angles({ leftElbow: 170, rightElbow: 170 });
    const m = dumbbellCurlDefinition.calculateMetrics(a);
    expect(dumbbellCurlDefinition.getNextPhase('setup', a, m)).toBe('bottom');
  });

  test('getNextPhase: bottom -> curling as elbow flexes', () => {
    const a = angles({ leftElbow: 135, rightElbow: 135 });
    const m = dumbbellCurlDefinition.calculateMetrics(a);
    expect(dumbbellCurlDefinition.getNextPhase('bottom', a, m)).toBe('curling');
  });

  test('getNextPhase: curling -> top at peak curl', () => {
    const a = angles({ leftElbow: 65, rightElbow: 65 });
    const m = dumbbellCurlDefinition.calculateMetrics(a);
    expect(dumbbellCurlDefinition.getNextPhase('curling', a, m)).toBe('top');
  });
});
