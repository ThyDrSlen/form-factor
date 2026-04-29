/**
 * Unit tests for lib/workouts/hip-thrust.ts — phase FSM, lockout thresholds,
 * descent phase, and NaN-safe fault detection.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  hipThrustDefinition,
  HIP_THRUST_THRESHOLDS,
  type HipThrustMetrics,
  type HipThrustPhase,
} from '@/lib/workouts/hip-thrust';

function angles(override: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 90,
    rightKnee: 90,
    leftElbow: 170,
    rightElbow: 170,
    leftHip: 170,
    rightHip: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    ...override,
  };
}

function metrics(override: Partial<HipThrustMetrics> = {}): HipThrustMetrics {
  return {
    avgHip: 170,
    avgKnee: 90,
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
    durationMs: 1500,
    repNumber: 1,
    workoutId: 'hip_thrust',
    ...override,
  };
}

describe('hip-thrust: definition metadata', () => {
  test('exposes expected id, category, initial phase, phase set', () => {
    expect(hipThrustDefinition.id).toBe('hip_thrust');
    expect(hipThrustDefinition.category).toBe('lower_body');
    expect(hipThrustDefinition.initialPhase).toBe('setup');
    const ids = hipThrustDefinition.phases.map((p) => p.id).sort();
    expect(ids).toEqual(['ascent', 'bottom', 'descent', 'lockout', 'setup']);
  });

  test('rep boundary is ascent -> lockout with non-zero debounce', () => {
    expect(hipThrustDefinition.repBoundary.startPhase).toBe('ascent');
    expect(hipThrustDefinition.repBoundary.endPhase).toBe('lockout');
    expect(hipThrustDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = hipThrustDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });

  test('thresholds ascend bottomHip < ascentStart < lockoutHip < hyperExtensionMax', () => {
    expect(HIP_THRUST_THRESHOLDS.bottomHip).toBeLessThan(HIP_THRUST_THRESHOLDS.ascentStart);
    expect(HIP_THRUST_THRESHOLDS.ascentStart).toBeLessThan(HIP_THRUST_THRESHOLDS.lockoutHip);
    expect(HIP_THRUST_THRESHOLDS.lockoutHip).toBeLessThan(HIP_THRUST_THRESHOLDS.hyperExtensionMax);
  });
});

describe('hip-thrust: phase FSM (getNextPhase)', () => {
  const nextPhase = (cur: HipThrustPhase, m: HipThrustMetrics): HipThrustPhase =>
    hipThrustDefinition.getNextPhase(cur, angles(), m);

  test('legsTracked=false forces setup from any phase', () => {
    const m = metrics({ legsTracked: false });
    (['setup', 'bottom', 'ascent', 'lockout', 'descent'] as HipThrustPhase[]).forEach((p) => {
      expect(nextPhase(p, m)).toBe('setup');
    });
  });

  test('setup -> bottom when hip drops to bottomHip', () => {
    expect(nextPhase('setup', metrics({ avgHip: HIP_THRUST_THRESHOLDS.bottomHip }))).toBe('bottom');
    expect(nextPhase('setup', metrics({ avgHip: HIP_THRUST_THRESHOLDS.bottomHip + 1 }))).toBe('setup');
  });

  test('bottom -> ascent when hip crosses ascentStart', () => {
    expect(nextPhase('bottom', metrics({ avgHip: HIP_THRUST_THRESHOLDS.ascentStart }))).toBe('ascent');
    expect(nextPhase('bottom', metrics({ avgHip: HIP_THRUST_THRESHOLDS.ascentStart - 1 }))).toBe('bottom');
  });

  test('ascent -> lockout at lockoutHip threshold', () => {
    expect(nextPhase('ascent', metrics({ avgHip: HIP_THRUST_THRESHOLDS.lockoutHip }))).toBe('lockout');
    expect(nextPhase('ascent', metrics({ avgHip: HIP_THRUST_THRESHOLDS.lockoutHip - 1 }))).toBe('ascent');
  });

  test('lockout -> descent when hip drops back below ascentStart', () => {
    expect(nextPhase('lockout', metrics({ avgHip: HIP_THRUST_THRESHOLDS.ascentStart }))).toBe('descent');
    expect(nextPhase('lockout', metrics({ avgHip: HIP_THRUST_THRESHOLDS.ascentStart + 1 }))).toBe('lockout');
  });

  test('descent -> bottom when hip returns to bottomHip', () => {
    expect(nextPhase('descent', metrics({ avgHip: HIP_THRUST_THRESHOLDS.bottomHip }))).toBe('bottom');
    expect(nextPhase('descent', metrics({ avgHip: HIP_THRUST_THRESHOLDS.bottomHip + 1 }))).toBe('descent');
  });
});

describe('hip-thrust: fault detection at hip/knee boundaries', () => {
  const faultById = (id: string) => hipThrustDefinition.faults.find((f) => f.id === id);

  test('shallow_depth fires when minHip stays above depthFloor', () => {
    const fault = faultById('shallow_depth');
    expect(fault).toBeDefined();
    const bad = HIP_THRUST_THRESHOLDS.depthFloor + 1;
    const good = HIP_THRUST_THRESHOLDS.depthFloor;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftHip: bad, rightHip: bad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftHip: good, rightHip: good }) }))
    ).toBe(false);
  });

  test('incomplete_lockout fires when maxHip falls short of incompleteLockoutMin', () => {
    const fault = faultById('incomplete_lockout');
    expect(fault).toBeDefined();
    const bad = HIP_THRUST_THRESHOLDS.incompleteLockoutMin - 1;
    const good = HIP_THRUST_THRESHOLDS.incompleteLockoutMin;
    expect(
      fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: bad, rightHip: bad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: good, rightHip: good }) }))
    ).toBe(false);
  });

  test('hyperextension fires when maxHip exceeds hyperExtensionMax', () => {
    const fault = faultById('hyperextension');
    expect(fault).toBeDefined();
    const bad = HIP_THRUST_THRESHOLDS.hyperExtensionMax + 1;
    const good = HIP_THRUST_THRESHOLDS.hyperExtensionMax;
    expect(
      fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: bad, rightHip: 170 }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ maxAngles: angles({ leftHip: good, rightHip: 170 }) }))
    ).toBe(false);
  });

  test('heel_liftoff fires when |left-right knee diff| > heelLiftoffKneeDiffMax at max', () => {
    const fault = faultById('heel_liftoff');
    expect(fault).toBeDefined();
    const diffBad = HIP_THRUST_THRESHOLDS.heelLiftoffKneeDiffMax + 1;
    const diffGood = HIP_THRUST_THRESHOLDS.heelLiftoffKneeDiffMax;
    expect(
      fault!.condition(baseRepContext({ maxAngles: angles({ leftKnee: 90, rightKnee: 90 + diffBad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ maxAngles: angles({ leftKnee: 90, rightKnee: 90 + diffGood }) }))
    ).toBe(false);
  });

  test('NaN-safe: shallow_depth / hyperextension / heel_liftoff do not fire on NaN', () => {
    const badCtx = baseRepContext({
      minAngles: angles({ leftHip: Number.NaN, rightHip: Number.NaN }),
      maxAngles: angles({
        leftHip: Number.NaN,
        rightHip: Number.NaN,
        leftKnee: Number.NaN,
        rightKnee: Number.NaN,
      }),
    });
    expect(faultById('shallow_depth')!.condition(badCtx)).toBe(false);
    expect(faultById('hyperextension')!.condition(badCtx)).toBe(false);
    expect(faultById('heel_liftoff')!.condition(badCtx)).toBe(false);
    expect(faultById('incomplete_lockout')!.condition(badCtx)).toBe(false);
  });

  test('clean rep triggers no faults', () => {
    const cleanCtx = baseRepContext({
      startAngles: angles(),
      endAngles: angles(),
      minAngles: angles({ leftHip: HIP_THRUST_THRESHOLDS.bottomHip, rightHip: HIP_THRUST_THRESHOLDS.bottomHip }),
      maxAngles: angles({
        leftHip: HIP_THRUST_THRESHOLDS.lockoutHip + 5,
        rightHip: HIP_THRUST_THRESHOLDS.lockoutHip + 5,
        leftKnee: 90,
        rightKnee: 92,
      }),
      durationMs: 2000,
    });
    for (const fault of hipThrustDefinition.faults) {
      expect(fault.condition(cleanCtx)).toBe(false);
    }
  });
});

describe('hip-thrust: calculateMetrics', () => {
  test('averages left/right hip and knee', () => {
    const m = hipThrustDefinition.calculateMetrics(
      angles({ leftHip: 100, rightHip: 120, leftKnee: 80, rightKnee: 100 })
    );
    expect(m.avgHip).toBeCloseTo(110, 5);
    expect(m.avgKnee).toBeCloseTo(90, 5);
  });

  test('legsTracked false when any leg joint degenerate (0 or 180)', () => {
    expect(hipThrustDefinition.calculateMetrics(angles({ leftKnee: 0 })).legsTracked).toBe(false);
    expect(hipThrustDefinition.calculateMetrics(angles({ rightHip: 180 })).legsTracked).toBe(false);
    expect(hipThrustDefinition.calculateMetrics(angles()).legsTracked).toBe(true);
  });
});
