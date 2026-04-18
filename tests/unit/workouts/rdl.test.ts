/**
 * Unit tests for lib/workouts/rdl.ts — phase FSM, rep boundary, faults,
 * and key differences from a conventional deadlift (hip hinge, knees fixed).
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  rdlDefinition,
  RDL_THRESHOLDS,
  type RDLMetrics,
  type RDLPhase,
} from '@/lib/workouts/rdl';

function angles(override: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 160,
    rightKnee: 160,
    leftElbow: 170,
    rightElbow: 170,
    leftHip: 170,
    rightHip: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    ...override,
  };
}

function metrics(override: Partial<RDLMetrics> = {}): RDLMetrics {
  return {
    avgHip: 170,
    avgKnee: 160,
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
    workoutId: 'rdl',
    ...override,
  };
}

describe('rdl: definition metadata', () => {
  test('phases', () => {
    expect(rdlDefinition.id).toBe('rdl');
    expect(rdlDefinition.phases.map((p) => p.id).sort()).toEqual([
      'bottom',
      'hinge',
      'rise',
      'setup',
      'standing',
    ]);
  });

  test('threshold ordering: standing > hingeStart > riseStart > bottom', () => {
    expect(RDL_THRESHOLDS.standing).toBeGreaterThan(RDL_THRESHOLDS.hingeStart);
    expect(RDL_THRESHOLDS.hingeStart).toBeGreaterThan(RDL_THRESHOLDS.riseStart);
    expect(RDL_THRESHOLDS.riseStart).toBeGreaterThan(RDL_THRESHOLDS.bottom);
  });

  test('knee threshold ordering: kneeSoftBend > kneeMinBend', () => {
    expect(RDL_THRESHOLDS.kneeSoftBend).toBeGreaterThan(RDL_THRESHOLDS.kneeMinBend);
  });

  test('rep boundary hinge -> standing', () => {
    expect(rdlDefinition.repBoundary.startPhase).toBe('hinge');
    expect(rdlDefinition.repBoundary.endPhase).toBe('standing');
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = rdlDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });
});

describe('rdl: phase FSM', () => {
  const nextPhase = (cur: RDLPhase, m: RDLMetrics): RDLPhase =>
    rdlDefinition.getNextPhase(cur, angles(), m);

  test('legsTracked=false forces setup', () => {
    expect(nextPhase('hinge', metrics({ legsTracked: false }))).toBe('setup');
  });

  test('setup -> standing at standing threshold', () => {
    expect(nextPhase('setup', metrics({ avgHip: RDL_THRESHOLDS.standing }))).toBe('standing');
  });

  test('standing -> hinge at hingeStart', () => {
    expect(nextPhase('standing', metrics({ avgHip: RDL_THRESHOLDS.hingeStart }))).toBe('hinge');
    expect(nextPhase('standing', metrics({ avgHip: RDL_THRESHOLDS.hingeStart + 1 }))).toBe('standing');
  });

  test('hinge -> bottom at bottom', () => {
    expect(nextPhase('hinge', metrics({ avgHip: RDL_THRESHOLDS.bottom }))).toBe('bottom');
  });

  test('hinge -> standing if athlete aborts and stands back up', () => {
    expect(nextPhase('hinge', metrics({ avgHip: RDL_THRESHOLDS.standing }))).toBe('standing');
  });

  test('bottom -> rise at riseStart', () => {
    expect(nextPhase('bottom', metrics({ avgHip: RDL_THRESHOLDS.riseStart }))).toBe('rise');
  });

  test('rise -> standing at standing (rep completes)', () => {
    expect(nextPhase('rise', metrics({ avgHip: RDL_THRESHOLDS.standing }))).toBe('standing');
  });

  test('rise -> bottom if athlete re-descends during rise', () => {
    expect(nextPhase('rise', metrics({ avgHip: RDL_THRESHOLDS.bottom }))).toBe('bottom');
  });
});

describe('rdl: fault thresholds', () => {
  const faultById = (id: string) => rdlDefinition.faults.find((f) => f.id === id);

  test('knee_bend_excessive fires when minKnee < kneeMinBend', () => {
    const fault = faultById('knee_bend_excessive');
    const bad = RDL_THRESHOLDS.kneeMinBend - 1;
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: bad, rightKnee: bad }) }))).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: RDL_THRESHOLDS.kneeMinBend, rightKnee: RDL_THRESHOLDS.kneeMinBend }) }))
    ).toBe(false);
  });

  test('shallow_hinge fires when minHip > bottom + 20', () => {
    const fault = faultById('shallow_hinge');
    const bad = RDL_THRESHOLDS.bottom + 21;
    const good = RDL_THRESHOLDS.bottom + 20;
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftHip: bad, rightHip: bad }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftHip: good, rightHip: good }) }))).toBe(false);
  });

  test('incomplete_lockout fires when maxHip < standing - 10', () => {
    const fault = faultById('incomplete_lockout');
    const bad = RDL_THRESHOLDS.standing - 11;
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: bad, rightHip: bad }) }))).toBe(true);
  });

  test('rounded_back fires when maxShoulder > 130', () => {
    const fault = faultById('rounded_back');
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: 131, rightShoulder: 131 }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: 130, rightShoulder: 130 }) }))).toBe(false);
  });

  test('asymmetric_hinge fires when hip diff > 20', () => {
    const fault = faultById('asymmetric_hinge');
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftHip: 80, rightHip: 101 }) }))).toBe(true);
  });

  test('fast_rep fires below 1500ms', () => {
    const fault = faultById('fast_rep');
    expect(fault!.condition(baseRepContext({ durationMs: 1499 }))).toBe(true);
    expect(fault!.condition(baseRepContext({ durationMs: 1500 }))).toBe(false);
  });
});

describe('rdl: calculateMetrics', () => {
  test('legsTracked requires all hip + knee joints within (0, 180)', () => {
    expect(rdlDefinition.calculateMetrics(angles()).legsTracked).toBe(true);
    expect(rdlDefinition.calculateMetrics(angles({ leftHip: 0 })).legsTracked).toBe(false);
  });

  test('avg hip + knee are simple means', () => {
    const m = rdlDefinition.calculateMetrics(
      angles({ leftHip: 100, rightHip: 120, leftKnee: 150, rightKnee: 160 })
    );
    expect(m.avgHip).toBeCloseTo(110, 5);
    expect(m.avgKnee).toBeCloseTo(155, 5);
  });
});
