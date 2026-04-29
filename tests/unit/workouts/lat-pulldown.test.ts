/**
 * Unit tests for lib/workouts/lat-pulldown.ts — phase FSM, rep boundary,
 * elbow/shoulder co-contraction fault boundaries, and NaN-safe behavior.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  latPulldownDefinition,
  LAT_PULLDOWN_THRESHOLDS,
  type LatPulldownMetrics,
  type LatPulldownPhase,
} from '@/lib/workouts/lat-pulldown';

function angles(override: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 170,
    rightKnee: 170,
    leftElbow: 170,
    rightElbow: 170,
    leftHip: 170,
    rightHip: 170,
    leftShoulder: 150,
    rightShoulder: 150,
    ...override,
  };
}

function metrics(override: Partial<LatPulldownMetrics> = {}): LatPulldownMetrics {
  return {
    avgElbow: 170,
    avgShoulder: 150,
    armsTracked: true,
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
    workoutId: 'lat_pulldown',
    ...override,
  };
}

describe('lat-pulldown: definition metadata', () => {
  test('exposes expected id, category, initial phase, phase set', () => {
    expect(latPulldownDefinition.id).toBe('lat_pulldown');
    expect(latPulldownDefinition.category).toBe('upper_body');
    expect(latPulldownDefinition.initialPhase).toBe('setup');
    const ids = latPulldownDefinition.phases.map((p) => p.id).sort();
    expect(ids).toEqual(['bottom', 'pulling', 'releasing', 'setup', 'top']);
  });

  test('rep boundary is pulling -> top with a non-zero debounce', () => {
    expect(latPulldownDefinition.repBoundary.startPhase).toBe('pulling');
    expect(latPulldownDefinition.repBoundary.endPhase).toBe('top');
    expect(latPulldownDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = latPulldownDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });

  test('thresholds descend top > pulling > bottom', () => {
    expect(LAT_PULLDOWN_THRESHOLDS.topElbow).toBeGreaterThan(LAT_PULLDOWN_THRESHOLDS.pullingStart);
    expect(LAT_PULLDOWN_THRESHOLDS.pullingStart).toBeGreaterThan(LAT_PULLDOWN_THRESHOLDS.bottomElbow);
  });
});

describe('lat-pulldown: phase FSM (getNextPhase)', () => {
  const nextPhase = (cur: LatPulldownPhase, m: LatPulldownMetrics): LatPulldownPhase =>
    latPulldownDefinition.getNextPhase(cur, angles(), m);

  test('armsTracked=false from any phase forces setup', () => {
    const m = metrics({ armsTracked: false });
    (['setup', 'top', 'pulling', 'bottom', 'releasing'] as LatPulldownPhase[]).forEach((p) => {
      expect(nextPhase(p, m)).toBe('setup');
    });
  });

  test('setup -> top when elbow reaches topElbow', () => {
    expect(nextPhase('setup', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.topElbow }))).toBe('top');
    expect(nextPhase('setup', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.topElbow - 1 }))).toBe('setup');
  });

  test('top -> pulling when elbow crosses pullingStart', () => {
    expect(nextPhase('top', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.pullingStart }))).toBe('pulling');
    expect(nextPhase('top', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.pullingStart + 1 }))).toBe('top');
  });

  test('pulling -> bottom when elbow <= bottomElbow + 10 (hysteresis)', () => {
    expect(nextPhase('pulling', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.bottomElbow + 10 }))).toBe('bottom');
    expect(nextPhase('pulling', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.bottomElbow + 11 }))).toBe('pulling');
  });

  test('bottom -> releasing when elbow extends past releasingStart', () => {
    expect(nextPhase('bottom', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.releasingStart }))).toBe('releasing');
    expect(nextPhase('bottom', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.releasingStart - 1 }))).toBe('bottom');
  });

  test('releasing -> top completes the rep at topElbow', () => {
    expect(nextPhase('releasing', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.topElbow }))).toBe('top');
    expect(nextPhase('releasing', metrics({ avgElbow: LAT_PULLDOWN_THRESHOLDS.topElbow - 1 }))).toBe('releasing');
  });
});

describe('lat-pulldown: fault detection at elbow/shoulder boundaries', () => {
  const faultById = (id: string) => latPulldownDefinition.faults.find((f) => f.id === id);

  test('incomplete_lockout fires when minElbow stays above incompleteLockoutMin', () => {
    const fault = faultById('incomplete_lockout');
    expect(fault).toBeDefined();
    const bad = LAT_PULLDOWN_THRESHOLDS.incompleteLockoutMin + 1;
    const good = LAT_PULLDOWN_THRESHOLDS.incompleteLockoutMin;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: bad, rightElbow: bad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: good, rightElbow: good }) }))
    ).toBe(false);
  });

  test('elbows_flare fires when bottom (min) shoulder > elbowsFlareShoulderMax', () => {
    const fault = faultById('elbows_flare');
    expect(fault).toBeDefined();
    const bad = LAT_PULLDOWN_THRESHOLDS.elbowsFlareShoulderMax + 1;
    const good = LAT_PULLDOWN_THRESHOLDS.elbowsFlareShoulderMax;
    expect(
      fault!.condition(
        baseRepContext({ minAngles: angles({ leftShoulder: bad, rightShoulder: bad }) })
      )
    ).toBe(true);
    expect(
      fault!.condition(
        baseRepContext({ minAngles: angles({ leftShoulder: good, rightShoulder: good }) })
      )
    ).toBe(false);
  });

  test('excessive_lean fires when |shoulder delta start->min| > threshold', () => {
    const fault = faultById('excessive_lean');
    expect(fault).toBeDefined();
    const delta = LAT_PULLDOWN_THRESHOLDS.excessiveLeanShoulderDeltaMax + 1;
    const bad = baseRepContext({
      startAngles: angles({ leftShoulder: 160, rightShoulder: 160 }),
      minAngles: angles({ leftShoulder: 160 - delta, rightShoulder: 160 }),
    });
    expect(fault!.condition(bad)).toBe(true);

    const good = baseRepContext({
      startAngles: angles({ leftShoulder: 160, rightShoulder: 160 }),
      minAngles: angles({ leftShoulder: 160 - LAT_PULLDOWN_THRESHOLDS.excessiveLeanShoulderDeltaMax, rightShoulder: 160 }),
    });
    expect(fault!.condition(good)).toBe(false);
  });

  test('asymmetric_pull fires via shared asymmetryCheck helper at % threshold', () => {
    const fault = faultById('asymmetric_pull');
    expect(fault).toBeDefined();
    // left=100 vs right=75 -> diff 25 / 100 larger = 25%, well above 15% threshold.
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: 100, rightElbow: 75 }) }))
    ).toBe(true);
    // Very close: diff 1 / 100 larger = 1% -> no fault.
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: 100, rightElbow: 99 }) }))
    ).toBe(false);
  });

  test('NaN-safe: incomplete_lockout / elbows_flare do not fire on NaN inputs', () => {
    const badCtx = baseRepContext({
      minAngles: angles({ leftElbow: Number.NaN, rightElbow: Number.NaN, leftShoulder: Number.NaN, rightShoulder: Number.NaN }),
    });
    expect(faultById('incomplete_lockout')!.condition(badCtx)).toBe(false);
    expect(faultById('elbows_flare')!.condition(badCtx)).toBe(false);
  });

  test('clean rep triggers no faults', () => {
    const cleanCtx = baseRepContext({
      startAngles: angles({ leftShoulder: 150, rightShoulder: 150, leftElbow: 170, rightElbow: 170 }),
      endAngles: angles({ leftElbow: 170, rightElbow: 170 }),
      minAngles: angles({
        leftElbow: LAT_PULLDOWN_THRESHOLDS.bottomElbow,
        rightElbow: LAT_PULLDOWN_THRESHOLDS.bottomElbow,
        leftShoulder: 110,
        rightShoulder: 110,
      }),
      maxAngles: angles(),
      durationMs: 2500,
    });
    for (const fault of latPulldownDefinition.faults) {
      expect(fault.condition(cleanCtx)).toBe(false);
    }
  });
});

describe('lat-pulldown: calculateMetrics', () => {
  test('averages left/right elbow and shoulder', () => {
    const m = latPulldownDefinition.calculateMetrics(
      angles({ leftElbow: 100, rightElbow: 120, leftShoulder: 140, rightShoulder: 160 })
    );
    expect(m.avgElbow).toBeCloseTo(110, 5);
    expect(m.avgShoulder).toBeCloseTo(150, 5);
  });

  test('armsTracked false when elbow is 0 or 180 (degenerate)', () => {
    expect(
      latPulldownDefinition.calculateMetrics(angles({ leftElbow: 0, rightElbow: 90 })).armsTracked
    ).toBe(false);
    expect(
      latPulldownDefinition.calculateMetrics(angles({ leftElbow: 180, rightElbow: 90 })).armsTracked
    ).toBe(false);
    expect(
      latPulldownDefinition.calculateMetrics(angles({ leftElbow: 90, rightElbow: 90 })).armsTracked
    ).toBe(true);
  });
});
