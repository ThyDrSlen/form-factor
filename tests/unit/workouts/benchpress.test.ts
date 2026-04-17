/**
 * Unit tests for lib/workouts/benchpress.ts — phase FSM, rep boundary,
 * fault thresholds, hysteresis, and metric computation.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  benchpressDefinition,
  BENCHPRESS_THRESHOLDS,
  type BenchPressMetrics,
  type BenchPressPhase,
} from '@/lib/workouts/benchpress';

function angles(override: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 170,
    rightKnee: 170,
    leftElbow: 160,
    rightElbow: 160,
    leftHip: 170,
    rightHip: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    ...override,
  };
}

function metrics(override: Partial<BenchPressMetrics> = {}): BenchPressMetrics {
  return {
    avgElbow: 160,
    avgShoulder: 90,
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
    workoutId: 'benchpress',
    ...override,
  };
}

describe('benchpress: definition metadata', () => {
  test('id + category + phases', () => {
    expect(benchpressDefinition.id).toBe('benchpress');
    expect(benchpressDefinition.category).toBe('upper_body');
    expect(benchpressDefinition.initialPhase).toBe('setup');
    expect(benchpressDefinition.phases.map((p) => p.id).sort()).toEqual([
      'bottom',
      'lockout',
      'lowering',
      'press',
      'setup',
    ]);
  });

  test('thresholds are ordered for a valid cycle', () => {
    // readyElbow/finish at top; loweringStart > press > bottom for descent.
    expect(BENCHPRESS_THRESHOLDS.readyElbow).toBeGreaterThan(BENCHPRESS_THRESHOLDS.loweringStart);
    expect(BENCHPRESS_THRESHOLDS.loweringStart).toBeGreaterThan(BENCHPRESS_THRESHOLDS.press);
    expect(BENCHPRESS_THRESHOLDS.press).toBeGreaterThan(BENCHPRESS_THRESHOLDS.bottom);
    expect(BENCHPRESS_THRESHOLDS.finish).toBeGreaterThanOrEqual(BENCHPRESS_THRESHOLDS.readyElbow);
  });

  test('rep boundary lowering -> lockout with debounce', () => {
    expect(benchpressDefinition.repBoundary.startPhase).toBe('lowering');
    expect(benchpressDefinition.repBoundary.endPhase).toBe('lockout');
    expect(benchpressDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = benchpressDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });
});

describe('benchpress: phase FSM', () => {
  const nextPhase = (cur: BenchPressPhase, m: BenchPressMetrics): BenchPressPhase =>
    benchpressDefinition.getNextPhase(cur, angles(), m);

  test('untracked arms OR wrists forces setup', () => {
    (['setup', 'lockout', 'lowering', 'bottom', 'press'] as BenchPressPhase[]).forEach((p) => {
      expect(nextPhase(p, metrics({ armsTracked: false }))).toBe('setup');
      expect(nextPhase(p, metrics({ wristsTracked: false }))).toBe('setup');
    });
  });

  test('setup -> lockout at readyElbow', () => {
    expect(nextPhase('setup', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.readyElbow }))).toBe('lockout');
    expect(nextPhase('setup', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.readyElbow - 1 }))).toBe('setup');
  });

  test('lockout -> lowering at loweringStart', () => {
    expect(nextPhase('lockout', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.loweringStart }))).toBe('lowering');
    expect(nextPhase('lockout', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.loweringStart + 1 }))).toBe('lockout');
  });

  test('lowering -> bottom at bottom threshold', () => {
    expect(nextPhase('lowering', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.bottom }))).toBe('bottom');
    expect(nextPhase('lowering', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.bottom + 1 }))).toBe('lowering');
  });

  test('bottom -> press at press threshold', () => {
    expect(nextPhase('bottom', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.press }))).toBe('press');
    expect(nextPhase('bottom', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.press - 1 }))).toBe('bottom');
  });

  test('press -> lockout at finish threshold', () => {
    expect(nextPhase('press', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.finish }))).toBe('lockout');
    expect(nextPhase('press', metrics({ avgElbow: BENCHPRESS_THRESHOLDS.finish - 1 }))).toBe('press');
  });

  test('hysteresis: noise around loweringStart in lockout does not oscillate', () => {
    let phase: BenchPressPhase = 'lockout';
    phase = nextPhase(phase, metrics({ avgElbow: BENCHPRESS_THRESHOLDS.loweringStart + 2 }));
    expect(phase).toBe('lockout');
    phase = nextPhase(phase, metrics({ avgElbow: BENCHPRESS_THRESHOLDS.loweringStart }));
    expect(phase).toBe('lowering');
    // Already in lowering: jittering +/-3 around loweringStart keeps us in lowering (we only exit via bottom).
    phase = nextPhase(phase, metrics({ avgElbow: BENCHPRESS_THRESHOLDS.loweringStart + 3 }));
    expect(phase).toBe('lowering');
  });
});

describe('benchpress: fault thresholds', () => {
  const faultById = (id: string) => benchpressDefinition.faults.find((f) => f.id === id);

  test('incomplete_lockout: endElbow < readyElbow - 10', () => {
    const fault = faultById('incomplete_lockout');
    const bad = BENCHPRESS_THRESHOLDS.readyElbow - 11;
    const good = BENCHPRESS_THRESHOLDS.readyElbow - 10;
    expect(fault!.condition(baseRepContext({ endAngles: angles({ leftElbow: bad, rightElbow: bad }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ endAngles: angles({ leftElbow: good, rightElbow: good }) }))).toBe(false);
  });

  test('shallow_depth: minElbow > bottom + 15', () => {
    const fault = faultById('shallow_depth');
    const bad = BENCHPRESS_THRESHOLDS.bottom + 16;
    const good = BENCHPRESS_THRESHOLDS.bottom + 15;
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: bad, rightElbow: bad }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: good, rightElbow: good }) }))).toBe(false);
  });

  test('asymmetric_press: elbow diff > 20', () => {
    const fault = faultById('asymmetric_press');
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: 80, rightElbow: 101 }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ minAngles: angles({ leftElbow: 80, rightElbow: 100 }) }))).toBe(false);
  });

  test('fast_rep: durationMs < 600', () => {
    const fault = faultById('fast_rep');
    expect(fault!.condition(baseRepContext({ durationMs: 599 }))).toBe(true);
    expect(fault!.condition(baseRepContext({ durationMs: 600 }))).toBe(false);
  });

  test('elbow_flare: maxShoulder > elbowFlareShoulderMax', () => {
    const fault = faultById('elbow_flare');
    const bad = BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax + 1;
    const good = BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax;
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: bad, rightShoulder: bad }) }))).toBe(true);
    expect(fault!.condition(baseRepContext({ maxAngles: angles({ leftShoulder: good, rightShoulder: good }) }))).toBe(false);
  });
});

describe('benchpress: calculateMetrics', () => {
  test('wristsTracked=false when joint map is missing hands', () => {
    const m = benchpressDefinition.calculateMetrics(angles(), undefined);
    expect(m.wristsTracked).toBe(false);
    expect(m.armsTracked).toBe(true);
  });

  test('wristsTracked=true when both hand joints tracked', () => {
    const joints = new Map<string, { x: number; y: number; isTracked: boolean }>([
      ['left_hand', { x: 0.4, y: 0.3, isTracked: true }],
      ['right_hand', { x: 0.6, y: 0.3, isTracked: true }],
    ]);
    const m = benchpressDefinition.calculateMetrics(angles(), joints);
    expect(m.wristsTracked).toBe(true);
  });

  test('wristsTracked=false when one hand is not tracked', () => {
    const joints = new Map<string, { x: number; y: number; isTracked: boolean }>([
      ['left_hand', { x: 0.4, y: 0.3, isTracked: true }],
      ['right_hand', { x: 0.6, y: 0.3, isTracked: false }],
    ]);
    const m = benchpressDefinition.calculateMetrics(angles(), joints);
    expect(m.wristsTracked).toBe(false);
  });
});
