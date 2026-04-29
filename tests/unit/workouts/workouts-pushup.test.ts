/**
 * Parametric form-model coverage for lib/workouts/pushup.ts.
 *
 * Pattern mirrors tests/unit/workouts-lunge.test.ts.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import {
  pushupDefinition,
  PUSHUP_THRESHOLDS,
  type PushUpMetrics,
} from '@/lib/workouts/pushup';
import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 160,
    rightElbow: 160,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 175,
    rightHip: 175,
    ...overrides,
  };
}

function metrics(overrides: Partial<PushUpMetrics> = {}): PushUpMetrics {
  return {
    avgElbow: 160,
    hipDrop: 0,
    armsTracked: true,
    wristsTracked: true,
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
    durationMs: opts.durationMs ?? 1500,
    repNumber: 1,
    workoutId: 'pushup',
  };
}

function fault(id: string) {
  const f = pushupDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Pushup fault '${id}' not found`);
  return f;
}

describe('pushup registration', () => {
  test('pushup is registered as a detection mode', () => {
    expect(getWorkoutIds()).toContain('pushup');
  });

  test('getWorkoutByMode returns the pushup definition', () => {
    const def = getWorkoutByMode('pushup');
    expect(def.id).toBe('pushup');
    expect(def.displayName).toBe('Push-Up');
    expect(def.category).toBe('upper_body');
    expect(def.difficulty).toBe('beginner');
  });

  test('thresholds are finite and form a valid descent ladder', () => {
    for (const val of Object.values(PUSHUP_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
    }
    expect(PUSHUP_THRESHOLDS.readyElbow).toBeGreaterThan(PUSHUP_THRESHOLDS.loweringStart);
    expect(PUSHUP_THRESHOLDS.loweringStart).toBeGreaterThan(PUSHUP_THRESHOLDS.press);
    expect(PUSHUP_THRESHOLDS.press).toBeGreaterThan(PUSHUP_THRESHOLDS.bottom);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = pushupDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1, 5);
  });
});

describe('pushup fault: hip_sag', () => {
  const f = fault('hip_sag');

  test('positive: min hip below 160 fires', () => {
    const c = ctx({ min: { leftHip: 150, rightHip: 150 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min hip at 160 does NOT fire (strict <)', () => {
    const c = ctx({ min: { leftHip: 160, rightHip: 160 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('pushup fault: shallow_depth', () => {
  const f = fault('shallow_depth');

  test('positive: min elbow above bottom+15 fires', () => {
    const c = ctx({ min: { leftElbow: PUSHUP_THRESHOLDS.bottom + 20, rightElbow: PUSHUP_THRESHOLDS.bottom + 20 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min elbow at bottom does NOT fire', () => {
    const c = ctx({ min: { leftElbow: PUSHUP_THRESHOLDS.bottom, rightElbow: PUSHUP_THRESHOLDS.bottom } });
    expect(f.condition(c)).toBe(false);
  });

  test('boundary: exactly bottom+15 does NOT fire', () => {
    const edge = PUSHUP_THRESHOLDS.bottom + 15;
    const c = ctx({ min: { leftElbow: edge, rightElbow: edge } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('pushup fault: asymmetric_press', () => {
  const f = fault('asymmetric_press');

  test('positive: elbow diff > 20 fires', () => {
    const c = ctx({ min: { leftElbow: 80, rightElbow: 105 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: elbow diff exactly 20 does NOT fire', () => {
    const c = ctx({ min: { leftElbow: 80, rightElbow: 100 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('pushup fault: fast_rep', () => {
  const f = fault('fast_rep');

  test('positive: duration < 600 fires', () => {
    expect(f.condition(ctx({ durationMs: 500 }))).toBe(true);
  });

  test('negative: duration at 600 does NOT fire', () => {
    expect(f.condition(ctx({ durationMs: 600 }))).toBe(false);
  });
});

describe('pushup fault: elbow_flare', () => {
  const f = fault('elbow_flare');

  test('positive: max shoulder > 120 fires', () => {
    const c = ctx({ max: { leftShoulder: 125, rightShoulder: 90 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: max shoulder at 120 does NOT fire', () => {
    const c = ctx({ max: { leftShoulder: 120, rightShoulder: 120 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('pushup FSM edge transitions', () => {
  test('armsTracked=false forces setup', () => {
    const next = pushupDefinition.getNextPhase('bottom', angles(), metrics({ armsTracked: false }));
    expect(next).toBe('setup');
  });

  test('wristsTracked=false forces setup', () => {
    const next = pushupDefinition.getNextPhase('plank', angles(), metrics({ wristsTracked: false }));
    expect(next).toBe('setup');
  });

  test('setup -> plank at readyElbow threshold (when hip stable)', () => {
    const next = pushupDefinition.getNextPhase(
      'setup',
      angles(),
      metrics({ avgElbow: PUSHUP_THRESHOLDS.readyElbow, hipDrop: 0 })
    );
    expect(next).toBe('plank');
  });

  test('plank -> lowering at loweringStart threshold', () => {
    const next = pushupDefinition.getNextPhase(
      'plank',
      angles(),
      metrics({ avgElbow: PUSHUP_THRESHOLDS.loweringStart })
    );
    expect(next).toBe('lowering');
  });

  test('press -> plank at finish threshold (completes rep)', () => {
    const next = pushupDefinition.getNextPhase(
      'press',
      angles(),
      metrics({ avgElbow: PUSHUP_THRESHOLDS.finish, hipDrop: 0 })
    );
    expect(next).toBe('plank');
  });

  test('press -> stays in press when hipDrop exceeds hipSagMax (hip instability blocks lockout)', () => {
    const next = pushupDefinition.getNextPhase(
      'press',
      angles(),
      metrics({ avgElbow: PUSHUP_THRESHOLDS.finish, hipDrop: PUSHUP_THRESHOLDS.hipSagMax + 0.05 })
    );
    expect(next).toBe('press');
  });
});

describe('pushup calculateMetrics', () => {
  test('averages elbow', () => {
    const m = pushupDefinition.calculateMetrics(angles({ leftElbow: 80, rightElbow: 120 }));
    expect(m.avgElbow).toBe(100);
  });

  test('hipDrop is null when no joints map provided', () => {
    const m = pushupDefinition.calculateMetrics(angles());
    expect(m.hipDrop).toBeNull();
  });
});
