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

// ===========================================================================
// Complementary: phase FSM invalid transitions, load imbalance, edge cases
// ===========================================================================

describe('farmers-walk: phase FSM invalid transitions and idempotence', () => {
  const nextPhase = (cur: FarmersWalkPhase, m: FarmersWalkMetrics): FarmersWalkPhase =>
    farmersWalkDefinition.getNextPhase(cur, angles(), m);

  test('pickup stays put when avgHip remains below standingHip', () => {
    // Athlete still bent over the weights — must not prematurely advance to carry.
    const mid = (FARMERS_WALK_THRESHOLDS.hingeHip + FARMERS_WALK_THRESHOLDS.standingHip) / 2;
    expect(nextPhase('pickup', metrics({ avgHip: mid }))).toBe('pickup');
  });

  test('carry stays put when hip remains above hingeHip (no ghost set_down)', () => {
    const justAboveHinge = FARMERS_WALK_THRESHOLDS.hingeHip + 5;
    expect(nextPhase('carry', metrics({ avgHip: justAboveHinge }))).toBe('carry');
  });

  test('set_down is idempotent while the athlete holds the hinge position', () => {
    // Stays in set_down until a full stand re-emerges.
    const hinge = FARMERS_WALK_THRESHOLDS.hingeHip;
    expect(nextPhase('set_down', metrics({ avgHip: hinge }))).toBe('set_down');
    expect(nextPhase('set_down', metrics({ avgHip: hinge - 1 }))).toBe('set_down');
  });

  test('tracking loss on either arms or legs sends the FSM back to setup from any phase', () => {
    for (const current of ['pickup', 'carry', 'set_down'] as const) {
      expect(nextPhase(current, metrics({ armsTracked: false }))).toBe('setup');
      expect(nextPhase(current, metrics({ legsTracked: false }))).toBe('setup');
    }
  });
});

describe('farmers-walk: load imbalance (asymmetry-as-percent) derivations', () => {
  // The raw metric is an absolute degree difference. Downstream UI often
  // normalizes it to a percentage of the asymmetry threshold so a single
  // threshold-pct readout can be tested regardless of future threshold tuning.
  const shoulderImbalancePct = (m: FarmersWalkMetrics) =>
    (m.shoulderSymmetry / FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax) * 100;
  const hipImbalancePct = (m: FarmersWalkMetrics) =>
    (m.hipSymmetry / FARMERS_WALK_THRESHOLDS.hipAsymmetryMax) * 100;

  test('balanced shoulders produce 0% imbalance', () => {
    const m = farmersWalkDefinition.calculateMetrics(
      angles({ leftShoulder: 90, rightShoulder: 90 }),
    );
    expect(shoulderImbalancePct(m)).toBeCloseTo(0, 5);
  });

  test('shoulders at the asymmetry threshold produce ~100% imbalance', () => {
    const diff = FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax;
    const m = farmersWalkDefinition.calculateMetrics(
      angles({ leftShoulder: 90 - diff / 2, rightShoulder: 90 + diff / 2 }),
    );
    expect(shoulderImbalancePct(m)).toBeCloseTo(100, 5);
  });

  test('hip imbalance scales linearly with lateral diff', () => {
    const halfDiff = FARMERS_WALK_THRESHOLDS.hipAsymmetryMax / 2;
    const m = farmersWalkDefinition.calculateMetrics(
      angles({ leftHip: 170 - halfDiff / 2, rightHip: 170 + halfDiff / 2 }),
    );
    expect(hipImbalancePct(m)).toBeCloseTo(50, 5);
  });

  test('imbalance is direction-agnostic (abs)', () => {
    const m1 = farmersWalkDefinition.calculateMetrics(
      angles({ leftShoulder: 80, rightShoulder: 100 }),
    );
    const m2 = farmersWalkDefinition.calculateMetrics(
      angles({ leftShoulder: 100, rightShoulder: 80 }),
    );
    expect(shoulderImbalancePct(m1)).toBeCloseTo(shoulderImbalancePct(m2), 5);
  });
});

describe('farmers-walk: fault conjunction (dropping proxy via fast pickup)', () => {
  const faultById = (id: string) => farmersWalkDefinition.faults.find((f) => f.id === id);

  test('rushed_pickup AND short_carry together fire for a "drop and bail" attempt', () => {
    // Dropping the weights after a moment of carry presents to the detector as
    // a rushed pickup followed by a short total carry time. Both faults should
    // trigger so the debrief UI can surface "you bailed early".
    const rushed = faultById('rushed_pickup');
    const short = faultById('short_carry');
    const ctx = baseRepContext({ durationMs: 1500 });
    expect(rushed!.condition(ctx)).toBe(true);
    expect(short!.condition(ctx)).toBe(true);
  });

  test('neither fires on a clean 10-second carry', () => {
    const rushed = faultById('rushed_pickup');
    const short = faultById('short_carry');
    const ctx = baseRepContext({ durationMs: 10_000 });
    expect(rushed!.condition(ctx)).toBe(false);
    expect(short!.condition(ctx)).toBe(false);
  });
});
