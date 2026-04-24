/**
 * Unit tests for lib/workouts/bulgarian-split-squat.ts — phase FSM, rear-foot
 * occlusion (legsTracked) behavior, depth detection, and NaN-safe faults.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  bulgarianSplitSquatDefinition,
  BULGARIAN_SPLIT_SQUAT_THRESHOLDS,
  type BulgarianSplitSquatMetrics,
  type BulgarianSplitSquatPhase,
} from '@/lib/workouts/bulgarian-split-squat';

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

function metrics(override: Partial<BulgarianSplitSquatMetrics> = {}): BulgarianSplitSquatMetrics {
  return {
    frontKnee: 170,
    rearKnee: 170,
    avgHip: 170,
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
    durationMs: 2200,
    repNumber: 1,
    workoutId: 'bulgarian_split_squat',
    ...override,
  };
}

describe('bulgarian-split-squat: definition metadata', () => {
  test('exposes expected id, category, initial phase, phase set', () => {
    expect(bulgarianSplitSquatDefinition.id).toBe('bulgarian_split_squat');
    expect(bulgarianSplitSquatDefinition.category).toBe('lower_body');
    expect(bulgarianSplitSquatDefinition.initialPhase).toBe('setup');
    const ids = bulgarianSplitSquatDefinition.phases.map((p) => p.id).sort();
    expect(ids).toEqual(['ascent', 'bottom', 'descent', 'setup', 'standing']);
  });

  test('rep boundary is descent -> standing with non-zero debounce', () => {
    expect(bulgarianSplitSquatDefinition.repBoundary.startPhase).toBe('descent');
    expect(bulgarianSplitSquatDefinition.repBoundary.endPhase).toBe('standing');
    expect(bulgarianSplitSquatDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = bulgarianSplitSquatDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });

  test('heel_collapse threshold sits below frontKneeForwardLimit (more acute)', () => {
    // heel_collapse fires at frontKneeForwardLimit - 10, so it must be below the
    // forward_knee fault's threshold — this ordering is load-bearing.
    expect(
      BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit - 10
    ).toBeLessThan(BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit);
  });
});

describe('bulgarian-split-squat: phase FSM (getNextPhase)', () => {
  const nextPhase = (
    cur: BulgarianSplitSquatPhase,
    m: BulgarianSplitSquatMetrics
  ): BulgarianSplitSquatPhase =>
    bulgarianSplitSquatDefinition.getNextPhase(cur, angles(), m);

  test('legsTracked=false (rear-foot occlusion) forces setup from any phase', () => {
    const m = metrics({ legsTracked: false });
    (['setup', 'standing', 'descent', 'bottom', 'ascent'] as BulgarianSplitSquatPhase[]).forEach((p) => {
      expect(nextPhase(p, m)).toBe('setup');
    });
  });

  test('setup -> standing when front-knee reaches standing threshold', () => {
    expect(
      nextPhase('setup', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.standing }))
    ).toBe('standing');
    expect(
      nextPhase('setup', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.standing - 1 }))
    ).toBe('setup');
  });

  test('standing -> descent when knee drops to descentStart', () => {
    expect(
      nextPhase('standing', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.descentStart }))
    ).toBe('descent');
    expect(
      nextPhase('standing', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.descentStart + 1 }))
    ).toBe('standing');
  });

  test('descent -> bottom at parallel threshold', () => {
    expect(
      nextPhase('descent', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.parallel }))
    ).toBe('bottom');
    expect(
      nextPhase('descent', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.parallel + 1 }))
    ).toBe('descent');
  });

  test('bottom -> ascent when knee extends to ascent threshold', () => {
    expect(
      nextPhase('bottom', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.ascent }))
    ).toBe('ascent');
    expect(
      nextPhase('bottom', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.ascent - 1 }))
    ).toBe('bottom');
  });

  test('ascent -> standing completes rep at finish', () => {
    expect(
      nextPhase('ascent', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.finish }))
    ).toBe('standing');
    expect(
      nextPhase('ascent', metrics({ frontKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.finish - 1 }))
    ).toBe('ascent');
  });
});

describe('bulgarian-split-squat: fault detection (depth + knee tracking)', () => {
  const faultById = (id: string) => bulgarianSplitSquatDefinition.faults.find((f) => f.id === id);

  test('shallow_depth fires when minFront > depthFloor', () => {
    const fault = faultById('shallow_depth');
    expect(fault).toBeDefined();
    const bad = BULGARIAN_SPLIT_SQUAT_THRESHOLDS.depthFloor + 1;
    const good = BULGARIAN_SPLIT_SQUAT_THRESHOLDS.depthFloor;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: bad, rightKnee: bad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: good, rightKnee: good }) }))
    ).toBe(false);
  });

  test('forward_knee fires below frontKneeForwardLimit', () => {
    const fault = faultById('forward_knee');
    expect(fault).toBeDefined();
    const bad = BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit - 1;
    const good = BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: bad, rightKnee: 120 }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: good, rightKnee: 120 }) }))
    ).toBe(false);
  });

  test('heel_collapse fires below (frontKneeForwardLimit - 10) — proxy for arch collapse', () => {
    const fault = faultById('heel_collapse');
    expect(fault).toBeDefined();
    const bad = BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit - 11;
    const good = BULGARIAN_SPLIT_SQUAT_THRESHOLDS.frontKneeForwardLimit - 10;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: bad, rightKnee: 120 }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: good, rightKnee: 120 }) }))
    ).toBe(false);
  });

  test('asymmetric_drive fires when hip asymmetry exceeds %-threshold', () => {
    const fault = faultById('asymmetric_drive');
    expect(fault).toBeDefined();
    // left=100 vs right=70 -> 30 / 100 = 30% > 15%
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftHip: 100, rightHip: 70 }) }))
    ).toBe(true);
    // left=100 vs right=99 -> 1% well below threshold
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftHip: 100, rightHip: 99 }) }))
    ).toBe(false);
  });

  test('NaN-safe: depth / forward_knee / heel_collapse do not fire on NaN', () => {
    const badCtx = baseRepContext({
      minAngles: angles({
        leftKnee: Number.NaN,
        rightKnee: Number.NaN,
        leftHip: Number.NaN,
        rightHip: Number.NaN,
      }),
    });
    expect(faultById('shallow_depth')!.condition(badCtx)).toBe(false);
    expect(faultById('forward_knee')!.condition(badCtx)).toBe(false);
    expect(faultById('heel_collapse')!.condition(badCtx)).toBe(false);
  });

  test('clean rep triggers no faults', () => {
    const cleanCtx = baseRepContext({
      startAngles: angles(),
      endAngles: angles(),
      minAngles: angles({
        leftKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.parallel,
        rightKnee: BULGARIAN_SPLIT_SQUAT_THRESHOLDS.parallel + 5,
        leftHip: 110,
        rightHip: 112,
      }),
      maxAngles: angles(),
      durationMs: 2500,
    });
    for (const fault of bulgarianSplitSquatDefinition.faults) {
      expect(fault.condition(cleanCtx)).toBe(false);
    }
  });
});

describe('bulgarian-split-squat: calculateMetrics', () => {
  test('frontKnee = min(left,right), rearKnee = max(left,right) — front-leg approximation', () => {
    const m = bulgarianSplitSquatDefinition.calculateMetrics(
      angles({ leftKnee: 85, rightKnee: 140 })
    );
    expect(m.frontKnee).toBe(85);
    expect(m.rearKnee).toBe(140);
  });

  test('legsTracked flips to false if either leg joint is degenerate', () => {
    // Rear-foot-occlusion proxy: one hip at 0 / 180 boundary flips legsTracked off.
    expect(
      bulgarianSplitSquatDefinition.calculateMetrics(angles({ leftHip: 0 })).legsTracked
    ).toBe(false);
    expect(
      bulgarianSplitSquatDefinition.calculateMetrics(angles({ rightKnee: 180 })).legsTracked
    ).toBe(false);
    expect(bulgarianSplitSquatDefinition.calculateMetrics(angles()).legsTracked).toBe(true);
  });
});
