/**
 * Unit tests for lib/workouts/dead-hang.ts — static hold FSM, release
 * triggers, fault thresholds, and headToHand detection logic.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  deadHangDefinition,
  DEAD_HANG_THRESHOLDS,
  type DeadHangMetrics,
  type DeadHangPhase,
} from '@/lib/workouts/dead-hang';

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

function metrics(override: Partial<DeadHangMetrics> = {}): DeadHangMetrics {
  return {
    avgElbow: 170,
    avgShoulder: 90,
    headToHand: DEAD_HANG_THRESHOLDS.handsAboveHead + 0.01,
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
    durationMs: 5000,
    repNumber: 1,
    workoutId: 'dead_hang',
    ...override,
  };
}

describe('dead-hang: definition metadata', () => {
  test('phases are idle / hang / release', () => {
    expect(deadHangDefinition.id).toBe('dead_hang');
    expect(deadHangDefinition.initialPhase).toBe('idle');
    expect(deadHangDefinition.phases.map((p) => p.id).sort()).toEqual([
      'hang',
      'idle',
      'release',
    ]);
  });

  test('thresholds: handsAboveHead > handsReleased (hysteresis gap)', () => {
    expect(DEAD_HANG_THRESHOLDS.handsAboveHead).toBeGreaterThan(DEAD_HANG_THRESHOLDS.handsReleased);
  });

  test('rep boundary hang -> release', () => {
    expect(deadHangDefinition.repBoundary.startPhase).toBe('hang');
    expect(deadHangDefinition.repBoundary.endPhase).toBe('release');
  });

  test('FQI weights sum to 1.0 (ROM = 0 because dead-hang is static)', () => {
    const { rom, depth, faults } = deadHangDefinition.fqiWeights;
    expect(rom).toBe(0);
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });
});

describe('dead-hang: phase FSM', () => {
  const nextPhase = (cur: DeadHangPhase, m: DeadHangMetrics): DeadHangPhase =>
    deadHangDefinition.getNextPhase(cur, angles(), m);

  test('untracked arms while hanging finalize as release (so rep logs)', () => {
    expect(nextPhase('hang', metrics({ armsTracked: false }))).toBe('release');
  });

  test('untracked arms from idle stay idle (nothing to finalize)', () => {
    expect(nextPhase('idle', metrics({ armsTracked: false }))).toBe('idle');
  });

  test('idle -> hang requires handsAboveHead AND elbow extended', () => {
    // Both conditions met
    expect(
      nextPhase(
        'idle',
        metrics({
          avgElbow: DEAD_HANG_THRESHOLDS.elbowExtended,
          headToHand: DEAD_HANG_THRESHOLDS.handsAboveHead + 0.01,
        })
      )
    ).toBe('hang');
    // Only elbow met, hands not above head
    expect(
      nextPhase(
        'idle',
        metrics({
          avgElbow: DEAD_HANG_THRESHOLDS.elbowExtended,
          headToHand: DEAD_HANG_THRESHOLDS.handsAboveHead - 0.01,
        })
      )
    ).toBe('idle');
    // headToHand undefined -> not hanging
    expect(
      nextPhase(
        'idle',
        metrics({ avgElbow: DEAD_HANG_THRESHOLDS.elbowExtended, headToHand: undefined })
      )
    ).toBe('idle');
  });

  test('hang -> release when hands drop below handsReleased', () => {
    expect(
      nextPhase(
        'hang',
        metrics({ headToHand: DEAD_HANG_THRESHOLDS.handsReleased - 0.001 })
      )
    ).toBe('release');
  });

  test('hang -> release on elbow breaking below extension - 15', () => {
    expect(
      nextPhase(
        'hang',
        metrics({
          avgElbow: DEAD_HANG_THRESHOLDS.elbowExtended - 16,
          headToHand: DEAD_HANG_THRESHOLDS.handsAboveHead + 0.1,
        })
      )
    ).toBe('release');
  });

  test('hang stays hang while signals are ambiguous', () => {
    // Hands tracked, elbow fine, hands still above head.
    expect(
      nextPhase(
        'hang',
        metrics({
          avgElbow: DEAD_HANG_THRESHOLDS.elbowExtended + 5,
          headToHand: DEAD_HANG_THRESHOLDS.handsAboveHead + 0.05,
        })
      )
    ).toBe('hang');
  });

  test('hang releases on lost wrist tracking + shrugged shoulder (avoid wedging forever)', () => {
    expect(
      nextPhase(
        'hang',
        metrics({
          wristsTracked: false,
          avgShoulder: DEAD_HANG_THRESHOLDS.shoulderElevation + 16,
        })
      )
    ).toBe('release');
  });

  test('release -> hang allows a quick re-grip', () => {
    expect(
      nextPhase(
        'release',
        metrics({
          avgElbow: DEAD_HANG_THRESHOLDS.elbowExtended,
          headToHand: DEAD_HANG_THRESHOLDS.handsAboveHead + 0.01,
        })
      )
    ).toBe('hang');
  });
});

describe('dead-hang: fault thresholds', () => {
  const faultById = (id: string) => deadHangDefinition.faults.find((f) => f.id === id);

  test('bent_arms: minElbow < elbowExtended - 10', () => {
    const fault = faultById('bent_arms');
    const bad = DEAD_HANG_THRESHOLDS.elbowExtended - 11;
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: bad, rightElbow: bad }) }))).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: DEAD_HANG_THRESHOLDS.elbowExtended - 10, rightElbow: DEAD_HANG_THRESHOLDS.elbowExtended - 10 }) }))
    ).toBe(false);
  });

  test('shrugged_shoulders: maxShoulder > shoulderElevation', () => {
    const fault = faultById('shrugged_shoulders');
    expect(
      fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: DEAD_HANG_THRESHOLDS.shoulderElevation + 1, rightShoulder: DEAD_HANG_THRESHOLDS.shoulderElevation + 1 }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: DEAD_HANG_THRESHOLDS.shoulderElevation, rightShoulder: DEAD_HANG_THRESHOLDS.shoulderElevation }) }))
    ).toBe(false);
  });

  test('short_hold fires below minHoldMs', () => {
    const fault = faultById('short_hold');
    expect(fault!.condition(baseRepContext({ durationMs: DEAD_HANG_THRESHOLDS.minHoldMs - 1 }))).toBe(true);
    expect(fault!.condition(baseRepContext({ durationMs: DEAD_HANG_THRESHOLDS.minHoldMs }))).toBe(false);
  });
});

describe('dead-hang: calculateMetrics', () => {
  test('headToHand is computed when head + both hands tracked', () => {
    const joints = new Map<string, { x: number; y: number; isTracked: boolean }>([
      ['head', { x: 0.5, y: 0.1, isTracked: true }],
      ['left_hand', { x: 0.4, y: 0.3, isTracked: true }],
      ['right_hand', { x: 0.6, y: 0.3, isTracked: true }],
    ]);
    const m = deadHangDefinition.calculateMetrics(angles(), joints);
    expect(m.headToHand).toBeCloseTo(-0.2, 5);
    expect(m.wristsTracked).toBe(true);
  });

  test('headToHand undefined + wristsTracked=false when joints missing', () => {
    const m = deadHangDefinition.calculateMetrics(angles());
    expect(m.headToHand).toBeUndefined();
    expect(m.wristsTracked).toBe(false);
  });

  test('armsTracked detects elbow out of valid range', () => {
    expect(deadHangDefinition.calculateMetrics(angles({ leftElbow: 0 })).armsTracked).toBe(false);
    expect(deadHangDefinition.calculateMetrics(angles({ leftElbow: 180 })).armsTracked).toBe(false);
  });
});
