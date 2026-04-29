/**
 * Unit tests for lib/workouts/dumbbell-curl.ts — elbow-pin phase FSM, momentum
 * (swinging) fault detection, and NaN-safe behavior.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  dumbbellCurlDefinition,
  DUMBBELL_CURL_THRESHOLDS,
  type DumbbellCurlMetrics,
  type DumbbellCurlPhase,
} from '@/lib/workouts/dumbbell-curl';

function angles(override: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 170,
    rightKnee: 170,
    leftElbow: 170,
    rightElbow: 170,
    leftHip: 175,
    rightHip: 175,
    leftShoulder: 90,
    rightShoulder: 90,
    ...override,
  };
}

function metrics(override: Partial<DumbbellCurlMetrics> = {}): DumbbellCurlMetrics {
  return {
    avgElbow: 170,
    avgShoulder: 90,
    avgHip: 175,
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
    durationMs: 1500,
    repNumber: 1,
    workoutId: 'dumbbell_curl',
    ...override,
  };
}

describe('dumbbell-curl: definition metadata', () => {
  test('exposes expected id, category, initial phase, phase set', () => {
    expect(dumbbellCurlDefinition.id).toBe('dumbbell_curl');
    expect(dumbbellCurlDefinition.category).toBe('upper_body');
    expect(dumbbellCurlDefinition.initialPhase).toBe('setup');
    const ids = dumbbellCurlDefinition.phases.map((p) => p.id).sort();
    expect(ids).toEqual(['bottom', 'curling', 'lowering', 'setup', 'top']);
  });

  test('rep boundary is curling -> bottom with non-zero debounce', () => {
    expect(dumbbellCurlDefinition.repBoundary.startPhase).toBe('curling');
    expect(dumbbellCurlDefinition.repBoundary.endPhase).toBe('bottom');
    expect(dumbbellCurlDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = dumbbellCurlDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });

  test('thresholds descend bottomElbow > curlingStart > loweringStart > topElbow', () => {
    expect(DUMBBELL_CURL_THRESHOLDS.bottomElbow).toBeGreaterThan(DUMBBELL_CURL_THRESHOLDS.curlingStart);
    expect(DUMBBELL_CURL_THRESHOLDS.curlingStart).toBeGreaterThan(DUMBBELL_CURL_THRESHOLDS.loweringStart);
    expect(DUMBBELL_CURL_THRESHOLDS.loweringStart).toBeGreaterThan(DUMBBELL_CURL_THRESHOLDS.topElbow);
  });
});

describe('dumbbell-curl: phase FSM (getNextPhase)', () => {
  const nextPhase = (cur: DumbbellCurlPhase, m: DumbbellCurlMetrics): DumbbellCurlPhase =>
    dumbbellCurlDefinition.getNextPhase(cur, angles(), m);

  test('armsTracked=false forces setup from any phase', () => {
    const m = metrics({ armsTracked: false });
    (['setup', 'bottom', 'curling', 'top', 'lowering'] as DumbbellCurlPhase[]).forEach((p) => {
      expect(nextPhase(p, m)).toBe('setup');
    });
  });

  test('setup -> bottom when elbow reaches bottomElbow', () => {
    expect(nextPhase('setup', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.bottomElbow }))).toBe('bottom');
    expect(nextPhase('setup', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.bottomElbow - 1 }))).toBe('setup');
  });

  test('bottom -> curling when elbow crosses curlingStart', () => {
    expect(nextPhase('bottom', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.curlingStart }))).toBe('curling');
    expect(nextPhase('bottom', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.curlingStart + 1 }))).toBe('bottom');
  });

  test('curling -> top when elbow <= topElbow + 10 (hysteresis)', () => {
    expect(nextPhase('curling', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.topElbow + 10 }))).toBe('top');
    expect(nextPhase('curling', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.topElbow + 11 }))).toBe('curling');
  });

  test('top -> lowering when elbow extends past loweringStart', () => {
    expect(nextPhase('top', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.loweringStart }))).toBe('lowering');
    expect(nextPhase('top', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.loweringStart - 1 }))).toBe('top');
  });

  test('lowering -> bottom completes rep at bottomElbow', () => {
    expect(nextPhase('lowering', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.bottomElbow }))).toBe('bottom');
    expect(nextPhase('lowering', metrics({ avgElbow: DUMBBELL_CURL_THRESHOLDS.bottomElbow - 1 }))).toBe('lowering');
  });
});

describe('dumbbell-curl: fault detection (momentum + pin)', () => {
  const faultById = (id: string) => dumbbellCurlDefinition.faults.find((f) => f.id === id);

  test('swinging fires when hip-flex delta start->min exceeds swingingHipDeltaMax', () => {
    const fault = faultById('swinging');
    expect(fault).toBeDefined();
    const delta = DUMBBELL_CURL_THRESHOLDS.swingingHipDeltaMax + 1;
    const bad = baseRepContext({
      startAngles: angles({ leftHip: 175, rightHip: 175 }),
      minAngles: angles({ leftHip: 175 - delta, rightHip: 175 }),
    });
    expect(fault!.condition(bad)).toBe(true);

    const good = baseRepContext({
      startAngles: angles({ leftHip: 175, rightHip: 175 }),
      minAngles: angles({ leftHip: 175 - DUMBBELL_CURL_THRESHOLDS.swingingHipDeltaMax, rightHip: 175 }),
    });
    expect(fault!.condition(good)).toBe(false);
  });

  test('incomplete_lockout fires when minElbow stays above incompleteLockoutMin', () => {
    const fault = faultById('incomplete_lockout');
    expect(fault).toBeDefined();
    const bad = DUMBBELL_CURL_THRESHOLDS.incompleteLockoutMin + 1;
    const good = DUMBBELL_CURL_THRESHOLDS.incompleteLockoutMin;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: bad, rightElbow: bad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: good, rightElbow: good }) }))
    ).toBe(false);
  });

  test('asymmetric_curl fires when left/right elbow asymmetry exceeds %-threshold', () => {
    const fault = faultById('asymmetric_curl');
    expect(fault).toBeDefined();
    // 60 vs 90 -> diff 30 / 90 larger = 33% >> 15% threshold
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: 60, rightElbow: 90 }) }))
    ).toBe(true);
    // 80 vs 82 -> diff 2 / 82 = 2.4% — well under threshold
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: 80, rightElbow: 82 }) }))
    ).toBe(false);
  });

  test('NaN-safe: incomplete_lockout / swinging / asymmetric_curl do not fire on NaN', () => {
    const badCtx = baseRepContext({
      startAngles: angles({ leftHip: Number.NaN, rightHip: Number.NaN }),
      minAngles: angles({
        leftElbow: Number.NaN,
        rightElbow: Number.NaN,
        leftHip: Number.NaN,
        rightHip: Number.NaN,
      }),
    });
    expect(faultById('swinging')!.condition(badCtx)).toBe(false);
    expect(faultById('incomplete_lockout')!.condition(badCtx)).toBe(false);
    expect(faultById('asymmetric_curl')!.condition(badCtx)).toBe(false);
  });

  test('clean rep (elbows pinned, no hip swing, symmetric) triggers no faults', () => {
    const cleanCtx = baseRepContext({
      startAngles: angles({ leftHip: 175, rightHip: 175 }),
      endAngles: angles(),
      minAngles: angles({
        leftElbow: DUMBBELL_CURL_THRESHOLDS.topElbow,
        rightElbow: DUMBBELL_CURL_THRESHOLDS.topElbow,
        leftHip: 173,
        rightHip: 173,
      }),
      maxAngles: angles(),
      durationMs: 1800,
    });
    for (const fault of dumbbellCurlDefinition.faults) {
      expect(fault.condition(cleanCtx)).toBe(false);
    }
  });
});

describe('dumbbell-curl: calculateMetrics', () => {
  test('averages elbow, shoulder, hip', () => {
    const m = dumbbellCurlDefinition.calculateMetrics(
      angles({ leftElbow: 80, rightElbow: 100, leftShoulder: 85, rightShoulder: 95, leftHip: 170, rightHip: 180 })
    );
    expect(m.avgElbow).toBeCloseTo(90, 5);
    expect(m.avgShoulder).toBeCloseTo(90, 5);
    expect(m.avgHip).toBeCloseTo(175, 5);
  });

  test('armsTracked false when elbow degenerate (0 or 180)', () => {
    expect(
      dumbbellCurlDefinition.calculateMetrics(angles({ leftElbow: 0, rightElbow: 90 })).armsTracked
    ).toBe(false);
    expect(
      dumbbellCurlDefinition.calculateMetrics(angles({ leftElbow: 180, rightElbow: 90 })).armsTracked
    ).toBe(false);
    expect(dumbbellCurlDefinition.calculateMetrics(angles()).armsTracked).toBe(true);
  });
});
