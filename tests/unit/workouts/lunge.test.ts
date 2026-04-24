/**
 * Unit tests for lib/workouts/lunge.ts — phase FSM, rep boundary, fault
 * thresholds, hysteresis, and NaN-safe metric computation.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  lungeDefinition,
  LUNGE_THRESHOLDS,
  type LungeMetrics,
  type LungePhase,
} from '@/lib/workouts/lunge';

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

function metrics(override: Partial<LungeMetrics> = {}): LungeMetrics {
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
    durationMs: 2000,
    repNumber: 1,
    workoutId: 'lunge',
    ...override,
  };
}

describe('lunge: definition metadata', () => {
  test('exposes expected id, category, initial phase, and phase set', () => {
    expect(lungeDefinition.id).toBe('lunge');
    expect(lungeDefinition.category).toBe('lower_body');
    expect(lungeDefinition.initialPhase).toBe('setup');
    const phaseIds = lungeDefinition.phases.map((p) => p.id).sort();
    expect(phaseIds).toEqual(['ascent', 'bottom', 'descent', 'setup', 'standing']);
  });

  test('rep boundary is descent -> standing with a non-zero debounce', () => {
    expect(lungeDefinition.repBoundary.startPhase).toBe('descent');
    expect(lungeDefinition.repBoundary.endPhase).toBe('standing');
    expect(lungeDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = lungeDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });

  test('thresholds form a sane descent ladder standing > descentStart > parallel', () => {
    expect(LUNGE_THRESHOLDS.standing).toBeGreaterThan(LUNGE_THRESHOLDS.descentStart);
    expect(LUNGE_THRESHOLDS.descentStart).toBeGreaterThan(LUNGE_THRESHOLDS.parallel);
    // forward-knee limit must be below parallel (more acute)
    expect(LUNGE_THRESHOLDS.frontKneeForwardLimit).toBeLessThan(LUNGE_THRESHOLDS.parallel);
  });
});

describe('lunge: phase FSM (getNextPhase)', () => {
  const nextPhase = (cur: LungePhase, m: LungeMetrics): LungePhase =>
    lungeDefinition.getNextPhase(cur, angles(), m);

  test('legsTracked=false from any phase forces setup', () => {
    const m = metrics({ legsTracked: false });
    (['setup', 'standing', 'descent', 'bottom', 'ascent'] as LungePhase[]).forEach((p) => {
      expect(nextPhase(p, m)).toBe('setup');
    });
  });

  test('setup -> standing when knee reaches standing threshold', () => {
    expect(nextPhase('setup', metrics({ frontKnee: LUNGE_THRESHOLDS.standing }))).toBe('standing');
    // Just below the threshold stays in setup.
    expect(nextPhase('setup', metrics({ frontKnee: LUNGE_THRESHOLDS.standing - 1 }))).toBe('setup');
  });

  test('standing -> descent crosses descentStart from above', () => {
    expect(nextPhase('standing', metrics({ frontKnee: LUNGE_THRESHOLDS.descentStart + 1 }))).toBe('standing');
    expect(nextPhase('standing', metrics({ frontKnee: LUNGE_THRESHOLDS.descentStart }))).toBe('descent');
  });

  test('descent -> bottom when knee reaches parallel', () => {
    expect(nextPhase('descent', metrics({ frontKnee: LUNGE_THRESHOLDS.parallel }))).toBe('bottom');
    expect(nextPhase('descent', metrics({ frontKnee: LUNGE_THRESHOLDS.parallel + 1 }))).toBe('descent');
  });

  test('bottom -> ascent when knee extends past the ascent threshold', () => {
    expect(nextPhase('bottom', metrics({ frontKnee: LUNGE_THRESHOLDS.ascent }))).toBe('ascent');
    expect(nextPhase('bottom', metrics({ frontKnee: LUNGE_THRESHOLDS.ascent - 1 }))).toBe('bottom');
  });

  test('ascent -> standing completes a rep at finish threshold', () => {
    expect(nextPhase('ascent', metrics({ frontKnee: LUNGE_THRESHOLDS.finish }))).toBe('standing');
    // Small hysteresis: just below finish remains in ascent.
    expect(nextPhase('ascent', metrics({ frontKnee: LUNGE_THRESHOLDS.finish - 1 }))).toBe('ascent');
  });
});

describe('lunge: fault detection at threshold boundaries', () => {
  const faultById = (id: string) => lungeDefinition.faults.find((f) => f.id === id);

  test('shallow_depth fires when min front-knee stays above parallel + 15', () => {
    const fault = faultById('shallow_depth');
    expect(fault).toBeDefined();
    const bad = LUNGE_THRESHOLDS.parallel + 16;
    const good = LUNGE_THRESHOLDS.parallel + 15;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: bad, rightKnee: bad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: good, rightKnee: good }) }))
    ).toBe(false);
  });

  test('forward_knee fires when min front-knee drops below frontKneeForwardLimit', () => {
    const fault = faultById('forward_knee');
    expect(fault).toBeDefined();
    const bad = LUNGE_THRESHOLDS.frontKneeForwardLimit - 1;
    const good = LUNGE_THRESHOLDS.frontKneeForwardLimit;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: bad, rightKnee: 120 }) }))
    ).toBe(true);
    // At the boundary value, NOT a fault (strict <).
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: good, rightKnee: 120 }) }))
    ).toBe(false);
  });

  test('knee_cave fires when left/right knee diff exceeds kneeCaveMax', () => {
    const fault = faultById('knee_cave');
    expect(fault).toBeDefined();
    const diffBad = LUNGE_THRESHOLDS.kneeCaveMax + 1;
    const diffGood = LUNGE_THRESHOLDS.kneeCaveMax;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: 90, rightKnee: 90 + diffBad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: 90, rightKnee: 90 + diffGood }) }))
    ).toBe(false);
  });

  test('hyper_extension fires when end-rep knee > hyperExtensionMax', () => {
    const fault = faultById('hyper_extension');
    expect(fault).toBeDefined();
    const bad = LUNGE_THRESHOLDS.hyperExtensionMax + 1;
    const good = LUNGE_THRESHOLDS.hyperExtensionMax;
    expect(
      fault!.condition(baseRepContext({ endAngles: angles({ leftKnee: bad, rightKnee: 170 }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ endAngles: angles({ leftKnee: good, rightKnee: 170 }) }))
    ).toBe(false);
  });

  test('NaN-safe: shallow_depth / forward_knee / knee_cave do not fire on NaN input', () => {
    const badCtx = baseRepContext({
      minAngles: angles({ leftKnee: Number.NaN, rightKnee: Number.NaN }),
    });
    expect(faultById('shallow_depth')!.condition(badCtx)).toBe(false);
    expect(faultById('forward_knee')!.condition(badCtx)).toBe(false);
    expect(faultById('knee_cave')!.condition(badCtx)).toBe(false);
  });

  test('clean rep triggers no faults', () => {
    const cleanCtx = baseRepContext({
      startAngles: angles({ leftKnee: LUNGE_THRESHOLDS.standing, rightKnee: LUNGE_THRESHOLDS.standing }),
      endAngles: angles({ leftKnee: LUNGE_THRESHOLDS.standing, rightKnee: LUNGE_THRESHOLDS.standing }),
      minAngles: angles({
        leftKnee: LUNGE_THRESHOLDS.parallel,
        rightKnee: LUNGE_THRESHOLDS.parallel + 5,
        leftHip: 100,
        rightHip: 100,
      }),
      maxAngles: angles({ leftKnee: LUNGE_THRESHOLDS.standing, rightKnee: LUNGE_THRESHOLDS.standing }),
      durationMs: 2500,
    });
    for (const fault of lungeDefinition.faults) {
      expect(fault.condition(cleanCtx)).toBe(false);
    }
  });
});

describe('lunge: calculateMetrics', () => {
  test('frontKnee = min(left,right), rearKnee = max(left,right)', () => {
    const m = lungeDefinition.calculateMetrics(angles({ leftKnee: 80, rightKnee: 120 }));
    expect(m.frontKnee).toBe(80);
    expect(m.rearKnee).toBe(120);
  });

  test('avgHip averages left/right hip', () => {
    const m = lungeDefinition.calculateMetrics(angles({ leftHip: 100, rightHip: 120 }));
    expect(m.avgHip).toBeCloseTo(110, 5);
  });

  test('legsTracked is false when any leg joint is degenerate (0 or 180)', () => {
    // Knee at 0 — degenerate
    expect(lungeDefinition.calculateMetrics(angles({ leftKnee: 0 })).legsTracked).toBe(false);
    // Hip at 180 — boundary, treated as not-tracked per `> 0 && < 180` check
    expect(lungeDefinition.calculateMetrics(angles({ leftHip: 180 })).legsTracked).toBe(false);
    // Normal values — tracked
    expect(lungeDefinition.calculateMetrics(angles()).legsTracked).toBe(true);
  });
});
