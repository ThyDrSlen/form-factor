/**
 * Unit tests for lib/workouts/deadlift.ts — phase FSM, rep boundary, faults,
 * threshold ladder, and metric computation.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  deadliftDefinition,
  DEADLIFT_THRESHOLDS,
  type DeadliftMetrics,
  type DeadliftPhase,
} from '@/lib/workouts/deadlift';

function angles(override: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 170,
    rightKnee: 170,
    leftElbow: 170,
    rightElbow: 170,
    leftHip: 170,
    rightHip: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    ...override,
  };
}

function metrics(override: Partial<DeadliftMetrics> = {}): DeadliftMetrics {
  return {
    avgHip: 170,
    avgKnee: 170,
    avgShoulder: 90,
    armsTracked: false,
    legsTracked: true,
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
    durationMs: 2000,
    repNumber: 1,
    workoutId: 'deadlift',
    ...override,
  };
}

describe('deadlift: definition metadata', () => {
  test('phases', () => {
    expect(deadliftDefinition.id).toBe('deadlift');
    expect(deadliftDefinition.initialPhase).toBe('setup');
    expect(deadliftDefinition.phases.map((p) => p.id).sort()).toEqual([
      'address',
      'descent',
      'lockout',
      'pull',
      'setup',
    ]);
  });

  test('threshold ordering: lockout > descentStart > address > bottom', () => {
    expect(DEADLIFT_THRESHOLDS.lockout).toBeGreaterThan(DEADLIFT_THRESHOLDS.descentStart);
    expect(DEADLIFT_THRESHOLDS.descentStart).toBeGreaterThan(DEADLIFT_THRESHOLDS.address);
    expect(DEADLIFT_THRESHOLDS.address).toBeGreaterThan(DEADLIFT_THRESHOLDS.bottom);
  });

  test('rep boundary pull -> lockout', () => {
    expect(deadliftDefinition.repBoundary.startPhase).toBe('pull');
    expect(deadliftDefinition.repBoundary.endPhase).toBe('lockout');
    expect(deadliftDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = deadliftDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });
});

describe('deadlift: phase FSM', () => {
  const nextPhase = (cur: DeadliftPhase, m: DeadliftMetrics): DeadliftPhase =>
    deadliftDefinition.getNextPhase(cur, angles(), m);

  test('legsTracked=false forces setup from every state', () => {
    (['setup', 'address', 'pull', 'lockout', 'descent'] as DeadliftPhase[]).forEach((p) => {
      expect(nextPhase(p, metrics({ legsTracked: false }))).toBe('setup');
    });
  });

  test('setup -> address when hip <= address', () => {
    expect(nextPhase('setup', metrics({ avgHip: DEADLIFT_THRESHOLDS.address }))).toBe('address');
    expect(nextPhase('setup', metrics({ avgHip: DEADLIFT_THRESHOLDS.address + 1 }))).toBe('setup');
  });

  test('setup -> lockout when already standing', () => {
    expect(nextPhase('setup', metrics({ avgHip: DEADLIFT_THRESHOLDS.lockout }))).toBe('lockout');
  });

  test('address -> pull when hip exceeds address threshold', () => {
    expect(nextPhase('address', metrics({ avgHip: DEADLIFT_THRESHOLDS.address + 1 }))).toBe('pull');
    expect(nextPhase('address', metrics({ avgHip: DEADLIFT_THRESHOLDS.address }))).toBe('address');
  });

  test('pull -> lockout when hip reaches lockout', () => {
    expect(nextPhase('pull', metrics({ avgHip: DEADLIFT_THRESHOLDS.lockout }))).toBe('lockout');
  });

  test('pull -> address if athlete drops back to bottom', () => {
    expect(nextPhase('pull', metrics({ avgHip: DEADLIFT_THRESHOLDS.bottom }))).toBe('address');
  });

  test('lockout -> descent at descentStart', () => {
    expect(nextPhase('lockout', metrics({ avgHip: DEADLIFT_THRESHOLDS.descentStart }))).toBe('descent');
    expect(nextPhase('lockout', metrics({ avgHip: DEADLIFT_THRESHOLDS.descentStart + 1 }))).toBe('lockout');
  });

  test('descent -> address when returning to bottom', () => {
    expect(nextPhase('descent', metrics({ avgHip: DEADLIFT_THRESHOLDS.address }))).toBe('address');
  });

  test('descent -> lockout on bounce-up during descent', () => {
    // Non-ideal but the FSM allows it — verifies code path.
    expect(nextPhase('descent', metrics({ avgHip: DEADLIFT_THRESHOLDS.lockout }))).toBe('lockout');
  });
});

describe('deadlift: fault conditions', () => {
  const faultById = (id: string) => deadliftDefinition.faults.find((f) => f.id === id);

  test('incomplete_lockout: maxHip < lockout - 10', () => {
    const fault = faultById('incomplete_lockout');
    const bad = DEADLIFT_THRESHOLDS.lockout - 11;
    const good = DEADLIFT_THRESHOLDS.lockout - 10;
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: bad, rightHip: bad }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: good, rightHip: good }) }))).toBe(false);
  });

  test('rounded_back: maxShoulder > 120', () => {
    const fault = faultById('rounded_back');
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: 121, rightShoulder: 121 }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: 120, rightShoulder: 120 }) }))).toBe(false);
  });

  test('hips_rise_first: hipChange > kneeChange + 30', () => {
    const fault = faultById('hips_rise_first');
    // start: hip=80, knee=80. max: hip=160, knee=90 -> hipChange=80, kneeChange=10. Diff=70 > 30 -> fire.
    expect(
      fault!.condition(
        baseRepContext({
          startAngles: angles({ leftHip: 80, leftKnee: 80 }),
          maxAngles: angles({ leftHip: 160, leftKnee: 90 }),
        })
      )
    ).toBe(true);
    // Balanced: hipChange=50, kneeChange=40. Diff=10 not > 30 -> no fire.
    expect(
      fault!.condition(
        baseRepContext({
          startAngles: angles({ leftHip: 80, leftKnee: 80 }),
          maxAngles: angles({ leftHip: 130, leftKnee: 120 }),
        })
      )
    ).toBe(false);
  });

  test('asymmetric_pull: hip diff > 20', () => {
    const fault = faultById('asymmetric_pull');
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: 150, rightHip: 171 }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: 150, rightHip: 170 }) }))).toBe(false);
  });

  test('fast_descent: durationMs < 1200', () => {
    const fault = faultById('fast_descent');
    expect(fault!.condition(baseRepContext({ durationMs: 1199 }))).toBe(true);
    expect(fault!.condition(baseRepContext({ durationMs: 1200 }))).toBe(false);
  });
});

describe('deadlift: calculateMetrics', () => {
  test('legsTracked requires all hip + knee joints within (0, 180)', () => {
    expect(deadliftDefinition.calculateMetrics(angles()).legsTracked).toBe(true);
    expect(
      deadliftDefinition.calculateMetrics(angles({ leftKnee: 0 })).legsTracked
    ).toBe(false);
    expect(
      deadliftDefinition.calculateMetrics(angles({ leftHip: 180 })).legsTracked
    ).toBe(false);
  });

  test('armsTracked is always false', () => {
    expect(deadliftDefinition.calculateMetrics(angles()).armsTracked).toBe(false);
  });
});
