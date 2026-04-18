/**
 * Unit tests for lib/workouts/farmers-walk.ts — the one exercise that is a
 * symmetry-oriented *carry* rather than a rep cycle.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  farmersWalkDefinition,
  FARMERS_WALK_THRESHOLDS,
  type FarmersWalkMetrics,
  type FarmersWalkPhase,
} from '@/lib/workouts/farmers-walk';

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

function metrics(override: Partial<FarmersWalkMetrics> = {}): FarmersWalkMetrics {
  return {
    avgShoulder: 90,
    avgHip: 170,
    shoulderSymmetry: 0,
    hipSymmetry: 0,
    armsTracked: true,
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
    durationMs: 10000,
    repNumber: 1,
    workoutId: 'farmers_walk',
    ...override,
  };
}

describe('farmers-walk: definition metadata', () => {
  test('phases', () => {
    expect(farmersWalkDefinition.id).toBe('farmers_walk');
    expect(farmersWalkDefinition.category).toBe('full_body');
    expect(farmersWalkDefinition.phases.map((p) => p.id).sort()).toEqual([
      'carry',
      'pickup',
      'set_down',
      'setup',
    ]);
  });

  test('threshold ordering: standingHip > hingeHip', () => {
    expect(FARMERS_WALK_THRESHOLDS.standingHip).toBeGreaterThan(FARMERS_WALK_THRESHOLDS.hingeHip);
  });

  test('rep boundary pickup -> set_down with long minDurationMs (>=3s)', () => {
    expect(farmersWalkDefinition.repBoundary.startPhase).toBe('pickup');
    expect(farmersWalkDefinition.repBoundary.endPhase).toBe('set_down');
    expect(farmersWalkDefinition.repBoundary.minDurationMs).toBeGreaterThanOrEqual(3000);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = farmersWalkDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });
});

describe('farmers-walk: phase FSM', () => {
  const nextPhase = (cur: FarmersWalkPhase, m: FarmersWalkMetrics): FarmersWalkPhase =>
    farmersWalkDefinition.getNextPhase(cur, angles(), m);

  test('untracked arms or legs forces setup', () => {
    expect(nextPhase('carry', metrics({ armsTracked: false }))).toBe('setup');
    expect(nextPhase('carry', metrics({ legsTracked: false }))).toBe('setup');
  });

  test('setup -> pickup at hingeHip', () => {
    expect(nextPhase('setup', metrics({ avgHip: FARMERS_WALK_THRESHOLDS.hingeHip }))).toBe('pickup');
  });

  test('setup -> carry when starting fully standing', () => {
    expect(nextPhase('setup', metrics({ avgHip: FARMERS_WALK_THRESHOLDS.standingHip }))).toBe('carry');
  });

  test('pickup -> carry at standingHip', () => {
    expect(nextPhase('pickup', metrics({ avgHip: FARMERS_WALK_THRESHOLDS.standingHip }))).toBe('carry');
    expect(nextPhase('pickup', metrics({ avgHip: FARMERS_WALK_THRESHOLDS.standingHip - 1 }))).toBe('pickup');
  });

  test('carry -> set_down at hingeHip', () => {
    expect(nextPhase('carry', metrics({ avgHip: FARMERS_WALK_THRESHOLDS.hingeHip }))).toBe('set_down');
  });

  test('set_down -> carry when standing back up', () => {
    expect(nextPhase('set_down', metrics({ avgHip: FARMERS_WALK_THRESHOLDS.standingHip }))).toBe('carry');
  });

  test('set_down stays until athlete stands back up (no direct transition to pickup)', () => {
    // Below standingHip but above hingeHip: remain in set_down.
    expect(nextPhase('set_down', metrics({ avgHip: (FARMERS_WALK_THRESHOLDS.standingHip + FARMERS_WALK_THRESHOLDS.hingeHip) / 2 }))).toBe('set_down');
  });
});

describe('farmers-walk: fault thresholds', () => {
  const faultById = (id: string) => farmersWalkDefinition.faults.find((f) => f.id === id);

  test('lateral_lean fires when hip diff > hipAsymmetryMax', () => {
    const fault = faultById('lateral_lean');
    const bad = FARMERS_WALK_THRESHOLDS.hipAsymmetryMax + 1;
    const good = FARMERS_WALK_THRESHOLDS.hipAsymmetryMax;
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftHip: 100, rightHip: 100 + bad }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftHip: 100, rightHip: 100 + good }) }))).toBe(false);
  });

  test('shoulder_shrug fires when minShoulder < shoulderElevated', () => {
    const fault = faultById('shoulder_shrug');
    const bad = FARMERS_WALK_THRESHOLDS.shoulderElevated - 1;
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftShoulder: bad, rightShoulder: bad }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftShoulder: FARMERS_WALK_THRESHOLDS.shoulderElevated, rightShoulder: FARMERS_WALK_THRESHOLDS.shoulderElevated }) }))).toBe(false);
  });

  test('forward_lean fires when maxHip < standingHip - 15', () => {
    const fault = faultById('forward_lean');
    const bad = FARMERS_WALK_THRESHOLDS.standingHip - 16;
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: bad, rightHip: bad }) }))).toBe(true);
  });

  test('asymmetric_shoulders fires when shoulder diff > shoulderAsymmetryMax', () => {
    const fault = faultById('asymmetric_shoulders');
    const bad = FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax + 1;
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftShoulder: 80, rightShoulder: 80 + bad }) }))).toBe(true);
  });

  test('short_carry fires below 5000ms', () => {
    const fault = faultById('short_carry');
    expect(fault!.condition(baseRepContext({ durationMs: 4999 }))).toBe(true);
    expect(fault!.condition(baseRepContext({ durationMs: 5000 }))).toBe(false);
  });

  test('rushed_pickup fires below 3000ms', () => {
    const fault = faultById('rushed_pickup');
    expect(fault!.condition(baseRepContext({ durationMs: 2999 }))).toBe(true);
    expect(fault!.condition(baseRepContext({ durationMs: 3000 }))).toBe(false);
  });
});

describe('farmers-walk: calculateMetrics', () => {
  test('shoulderSymmetry / hipSymmetry are absolute differences', () => {
    const m = farmersWalkDefinition.calculateMetrics(
      angles({ leftShoulder: 85, rightShoulder: 95, leftHip: 170, rightHip: 160 })
    );
    expect(m.shoulderSymmetry).toBeCloseTo(10, 5);
    expect(m.hipSymmetry).toBeCloseTo(10, 5);
  });

  test('averages', () => {
    const m = farmersWalkDefinition.calculateMetrics(
      angles({ leftShoulder: 80, rightShoulder: 100, leftHip: 160, rightHip: 180 })
    );
    expect(m.avgShoulder).toBeCloseTo(90, 5);
    expect(m.avgHip).toBeCloseTo(170, 5);
  });

  test('realtime cues in carry phase warn on asymmetry', () => {
    const cues = farmersWalkDefinition.ui!.getRealtimeCues!({
      phaseId: 'carry',
      metrics: metrics({ shoulderSymmetry: FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax + 5 }),
    });
    expect(cues?.some((m) => /shoulders/i.test(m))).toBe(true);
  });
});
