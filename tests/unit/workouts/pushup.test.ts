/**
 * Unit tests for lib/workouts/pushup.ts — phase FSM, rep boundary, hip-drop
 * metric, fault thresholds, hysteresis.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  pushupDefinition,
  PUSHUP_THRESHOLDS,
  type PushUpMetrics,
  type PushUpPhase,
} from '@/lib/workouts/pushup';

function angles(override: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 170,
    rightKnee: 170,
    leftElbow: 160,
    rightElbow: 160,
    leftHip: 175,
    rightHip: 175,
    leftShoulder: 90,
    rightShoulder: 90,
    ...override,
  };
}

function metrics(override: Partial<PushUpMetrics> = {}): PushUpMetrics {
  return {
    avgElbow: 160,
    hipDrop: 0.05,
    armsTracked: true,
    wristsTracked: true,
    ...override,
  };
}

function baseRepContext(override: Partial<RepContext> = {}): RepContext {
  const a = angles();
  return {
    startAngles: a,
    endAngles: a,
    minAngles: a,
    maxAngles: a,
    durationMs: 1500,
    repNumber: 1,
    workoutId: 'pushup',
    ...override,
  };
}

describe('pushup: definition metadata', () => {
  test('phases', () => {
    expect(pushupDefinition.id).toBe('pushup');
    expect(pushupDefinition.initialPhase).toBe('setup');
    expect(pushupDefinition.phases.map((p) => p.id).sort()).toEqual([
      'bottom',
      'lowering',
      'plank',
      'press',
      'setup',
    ]);
  });

  test('rep boundary lowering -> plank', () => {
    expect(pushupDefinition.repBoundary.startPhase).toBe('lowering');
    expect(pushupDefinition.repBoundary.endPhase).toBe('plank');
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = pushupDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });
});

describe('pushup: phase FSM', () => {
  const nextPhase = (cur: PushUpPhase, m: PushUpMetrics): PushUpPhase =>
    pushupDefinition.getNextPhase(cur, angles(), m);

  test('armsTracked=false OR wristsTracked=false forces setup', () => {
    expect(nextPhase('plank', metrics({ armsTracked: false }))).toBe('setup');
    expect(nextPhase('lowering', metrics({ wristsTracked: false }))).toBe('setup');
  });

  test('setup -> plank only when elbow >= readyElbow AND hips stable', () => {
    // Unstable hips (hipDrop > hipSagMax) blocks transition.
    expect(
      nextPhase(
        'setup',
        metrics({ avgElbow: PUSHUP_THRESHOLDS.readyElbow, hipDrop: PUSHUP_THRESHOLDS.hipSagMax + 0.01 })
      )
    ).toBe('setup');
    // null hipDrop is treated as stable.
    expect(
      nextPhase('setup', metrics({ avgElbow: PUSHUP_THRESHOLDS.readyElbow, hipDrop: null }))
    ).toBe('plank');
  });

  test('plank -> lowering at loweringStart', () => {
    expect(nextPhase('plank', metrics({ avgElbow: PUSHUP_THRESHOLDS.loweringStart }))).toBe('lowering');
    expect(nextPhase('plank', metrics({ avgElbow: PUSHUP_THRESHOLDS.loweringStart + 1 }))).toBe('plank');
  });

  test('lowering -> bottom at bottom', () => {
    expect(nextPhase('lowering', metrics({ avgElbow: PUSHUP_THRESHOLDS.bottom }))).toBe('bottom');
  });

  test('bottom -> press at press threshold', () => {
    expect(nextPhase('bottom', metrics({ avgElbow: PUSHUP_THRESHOLDS.press }))).toBe('press');
  });

  test('press -> plank at finish AND hips stable (completes rep)', () => {
    // Unstable hips blocks rep completion.
    expect(
      nextPhase(
        'press',
        metrics({ avgElbow: PUSHUP_THRESHOLDS.finish, hipDrop: PUSHUP_THRESHOLDS.hipSagMax + 0.01 })
      )
    ).toBe('press');
    expect(
      nextPhase('press', metrics({ avgElbow: PUSHUP_THRESHOLDS.finish, hipDrop: 0.05 }))
    ).toBe('plank');
  });

  test('hipDrop=null means stable (no false negatives when joints missing)', () => {
    expect(
      nextPhase('press', metrics({ avgElbow: PUSHUP_THRESHOLDS.finish, hipDrop: null }))
    ).toBe('plank');
  });
});

describe('pushup: fault thresholds', () => {
  const faultById = (id: string) => pushupDefinition.faults.find((f) => f.id === id);

  test('hip_sag fires when avgHip < 160', () => {
    const fault = faultById('hip_sag');
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftHip: 159, rightHip: 159 }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftHip: 160, rightHip: 160 }) }))).toBe(false);
  });

  test('incomplete_lockout: endElbow < readyElbow - 10', () => {
    const fault = faultById('incomplete_lockout');
    const bad = PUSHUP_THRESHOLDS.readyElbow - 11;
    const good = PUSHUP_THRESHOLDS.readyElbow - 10;
    expect(fault!.condition(baseRepContext({ endAngles: angles({ leftElbow: bad, rightElbow: bad }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ endAngles: angles({ leftElbow: good, rightElbow: good }) }))).toBe(false);
  });

  test('shallow_depth: minElbow > bottom + 15', () => {
    const fault = faultById('shallow_depth');
    const bad = PUSHUP_THRESHOLDS.bottom + 16;
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: bad, rightElbow: bad }) }))).toBe(true);
  });

  test('asymmetric_press: elbow diff > 20', () => {
    const fault = faultById('asymmetric_press');
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: 80, rightElbow: 101 }) }))).toBe(true);
  });

  test('fast_rep: durationMs < 600', () => {
    const fault = faultById('fast_rep');
    expect(fault!.condition(baseRepContext({ durationMs: 599 }))).toBe(true);
  });

  test('elbow_flare: maxShoulder > 120', () => {
    const fault = faultById('elbow_flare');
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: 121, rightShoulder: 121 }) }))).toBe(true);
  });
});

describe('pushup: calculateMetrics (hipDrop ratio)', () => {
  test('hipDrop is null when joints are not provided', () => {
    const m = pushupDefinition.calculateMetrics(angles());
    expect(m.hipDrop).toBeNull();
  });

  test('hipDrop is normalized by torso length (shoulder-to-ankle)', () => {
    const joints = new Map<string, { x: number; y: number; isTracked: boolean }>([
      ['left_shoulder', { x: 0.4, y: 0.3, isTracked: true }],
      ['right_shoulder', { x: 0.6, y: 0.3, isTracked: true }],
      ['left_upLeg', { x: 0.44, y: 0.5, isTracked: true }],
      ['right_upLeg', { x: 0.56, y: 0.5, isTracked: true }],
      ['left_foot', { x: 0.44, y: 0.9, isTracked: true }],
      ['right_foot', { x: 0.56, y: 0.9, isTracked: true }],
    ]);
    const m = pushupDefinition.calculateMetrics(angles(), joints);
    // |hipY - shoulderY| / |shoulderY - ankleY| = |0.5 - 0.3| / |0.3 - 0.9| = 0.2 / 0.6 = 0.333...
    expect(m.hipDrop).toBeCloseTo(0.333, 2);
  });

  test('hipDrop is null when any required joint is not tracked', () => {
    const joints = new Map<string, { x: number; y: number; isTracked: boolean }>([
      ['left_shoulder', { x: 0.4, y: 0.3, isTracked: false }],
      ['right_shoulder', { x: 0.6, y: 0.3, isTracked: true }],
      ['left_hip', { x: 0.44, y: 0.5, isTracked: true }],
      ['right_hip', { x: 0.56, y: 0.5, isTracked: true }],
      ['left_ankle', { x: 0.44, y: 0.9, isTracked: true }],
      ['right_ankle', { x: 0.56, y: 0.9, isTracked: true }],
    ]);
    const m = pushupDefinition.calculateMetrics(angles(), joints);
    expect(m.hipDrop).toBeNull();
  });
});
