/**
 * Unit tests for lib/workouts/squat.ts — phase FSM, rep boundary, faults,
 * hysteresis, and metric computation.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  squatDefinition,
  SQUAT_THRESHOLDS,
  type SquatMetrics,
  type SquatPhase,
} from '@/lib/workouts/squat';

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

function metrics(override: Partial<SquatMetrics> = {}): SquatMetrics {
  return {
    avgKnee: 170,
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
    workoutId: 'squat',
    ...override,
  };
}

describe('squat: definition metadata', () => {
  test('category and phases', () => {
    expect(squatDefinition.id).toBe('squat');
    expect(squatDefinition.category).toBe('lower_body');
    expect(squatDefinition.initialPhase).toBe('setup');
    expect(squatDefinition.phases.map((p) => p.id).sort()).toEqual([
      'ascent',
      'bottom',
      'descent',
      'setup',
      'standing',
    ]);
  });

  test('thresholds form a valid depth ladder: standing > ascent > parallel > deep', () => {
    expect(SQUAT_THRESHOLDS.standing).toBeGreaterThan(SQUAT_THRESHOLDS.descentStart);
    expect(SQUAT_THRESHOLDS.descentStart).toBeGreaterThan(SQUAT_THRESHOLDS.ascent);
    expect(SQUAT_THRESHOLDS.ascent).toBeGreaterThan(SQUAT_THRESHOLDS.parallel);
    expect(SQUAT_THRESHOLDS.parallel).toBeGreaterThan(SQUAT_THRESHOLDS.deep);
  });

  test('finish <= standing (safety: finish must be achievable before crossing standing gate)', () => {
    expect(SQUAT_THRESHOLDS.finish).toBeLessThanOrEqual(SQUAT_THRESHOLDS.standing);
  });

  test('rep boundary descent -> standing with debounce', () => {
    expect(squatDefinition.repBoundary.startPhase).toBe('descent');
    expect(squatDefinition.repBoundary.endPhase).toBe('standing');
    expect(squatDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = squatDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });
});

describe('squat: phase FSM (getNextPhase)', () => {
  const nextPhase = (cur: SquatPhase, m: SquatMetrics): SquatPhase =>
    squatDefinition.getNextPhase(cur, angles(), m);

  test('legsTracked=false forces setup from any phase', () => {
    const m = metrics({ legsTracked: false });
    (['setup', 'standing', 'descent', 'bottom', 'ascent'] as SquatPhase[]).forEach((p) => {
      expect(nextPhase(p, m)).toBe('setup');
    });
  });

  test('setup -> standing at standing threshold', () => {
    expect(nextPhase('setup', metrics({ avgKnee: SQUAT_THRESHOLDS.standing }))).toBe('standing');
    expect(nextPhase('setup', metrics({ avgKnee: SQUAT_THRESHOLDS.standing - 1 }))).toBe('setup');
  });

  test('standing -> descent when knee crosses descentStart', () => {
    expect(nextPhase('standing', metrics({ avgKnee: SQUAT_THRESHOLDS.descentStart }))).toBe('descent');
    expect(nextPhase('standing', metrics({ avgKnee: SQUAT_THRESHOLDS.descentStart + 1 }))).toBe('standing');
  });

  test('descent -> bottom at parallel threshold', () => {
    expect(nextPhase('descent', metrics({ avgKnee: SQUAT_THRESHOLDS.parallel }))).toBe('bottom');
    expect(nextPhase('descent', metrics({ avgKnee: SQUAT_THRESHOLDS.parallel + 1 }))).toBe('descent');
  });

  test('bottom -> ascent at ascent threshold (hysteresis above parallel)', () => {
    expect(nextPhase('bottom', metrics({ avgKnee: SQUAT_THRESHOLDS.ascent }))).toBe('ascent');
    expect(nextPhase('bottom', metrics({ avgKnee: SQUAT_THRESHOLDS.ascent - 1 }))).toBe('bottom');
  });

  test('ascent -> standing at finish threshold', () => {
    expect(nextPhase('ascent', metrics({ avgKnee: SQUAT_THRESHOLDS.finish }))).toBe('standing');
    expect(nextPhase('ascent', metrics({ avgKnee: SQUAT_THRESHOLDS.finish - 1 }))).toBe('ascent');
  });

  test('hysteresis: bouncing between parallel and ascent thresholds does not flip bottom<->ascent rapidly', () => {
    // After entering bottom, wiggling back up to ascent threshold should transition, but
    // small jitter right below ascent stays in bottom.
    let phase: SquatPhase = 'bottom';
    phase = nextPhase(phase, metrics({ avgKnee: SQUAT_THRESHOLDS.ascent - 5 }));
    expect(phase).toBe('bottom');
    phase = nextPhase(phase, metrics({ avgKnee: SQUAT_THRESHOLDS.ascent + 2 }));
    expect(phase).toBe('ascent');
    // Now in ascent, dipping back just below ascent should not return to bottom immediately
    // (the reverse transition happens via 'standing' -> 'descent' cycle).
    phase = nextPhase(phase, metrics({ avgKnee: SQUAT_THRESHOLDS.ascent - 3 }));
    expect(phase).toBe('ascent');
  });

  test('invalid transition: setup never jumps to bottom directly', () => {
    expect(nextPhase('setup', metrics({ avgKnee: SQUAT_THRESHOLDS.parallel - 5 }))).toBe('setup');
  });
});

describe('squat: fault detection at threshold boundaries', () => {
  const faultById = (id: string) => squatDefinition.faults.find((f) => f.id === id);

  test('shallow_depth fires when minKnee > parallel + 15', () => {
    const fault = faultById('shallow_depth');
    expect(fault).toBeDefined();
    const bad = SQUAT_THRESHOLDS.parallel + 16;
    const good = SQUAT_THRESHOLDS.parallel + 15;
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: bad, rightKnee: bad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ minAngles: angles({ leftKnee: good, rightKnee: good }) }))
    ).toBe(false);
  });

  test('incomplete_lockout fires when endKnee < standing - 10', () => {
    const fault = faultById('incomplete_lockout');
    expect(fault).toBeDefined();
    const bad = SQUAT_THRESHOLDS.standing - 11;
    const good = SQUAT_THRESHOLDS.standing - 10;
    expect(
      fault!.condition(baseRepContext({ endAngles: angles({ leftKnee: bad, rightKnee: bad }) }))
    ).toBe(true);
    expect(
      fault!.condition(baseRepContext({ endAngles: angles({ leftKnee: good, rightKnee: good }) }))
    ).toBe(false);
  });

  test('knee_valgus fires when knee diff > kneeValgusMax', () => {
    const fault = faultById('knee_valgus');
    expect(fault).toBeDefined();
    expect(
      fault!.condition(
        baseRepContext({
          minAngles: angles({ leftKnee: 80, rightKnee: 80 + SQUAT_THRESHOLDS.kneeValgusMax + 1 }),
        })
      )
    ).toBe(true);
    expect(
      fault!.condition(
        baseRepContext({
          minAngles: angles({ leftKnee: 80, rightKnee: 80 + SQUAT_THRESHOLDS.kneeValgusMax }),
        })
      )
    ).toBe(false);
  });

  test('fast_rep fires below 1000ms', () => {
    const fault = faultById('fast_rep');
    expect(fault).toBeDefined();
    expect(fault!.condition(baseRepContext({ durationMs: 999 }))).toBe(true);
    expect(fault!.condition(baseRepContext({ durationMs: 1000 }))).toBe(false);
  });

  test('hip_shift fires on hip diff > 20', () => {
    const fault = faultById('hip_shift');
    expect(fault).toBeDefined();
    expect(
      fault!.condition(
        baseRepContext({ minAngles: angles({ leftHip: 80, rightHip: 101 }) })
      )
    ).toBe(true);
  });

  test('forward_lean fires when avgHip < avgKnee - 25', () => {
    const fault = faultById('forward_lean');
    expect(fault).toBeDefined();
    expect(
      fault!.condition(
        baseRepContext({
          minAngles: angles({
            leftHip: 80,
            rightHip: 80,
            leftKnee: 110,
            rightKnee: 110,
          }),
        })
      )
    ).toBe(true);
  });

  test('clean rep triggers no faults', () => {
    const clean = baseRepContext({
      startAngles: angles({ leftKnee: SQUAT_THRESHOLDS.standing, rightKnee: SQUAT_THRESHOLDS.standing }),
      endAngles: angles({ leftKnee: SQUAT_THRESHOLDS.standing, rightKnee: SQUAT_THRESHOLDS.standing }),
      minAngles: angles({
        leftKnee: SQUAT_THRESHOLDS.parallel,
        rightKnee: SQUAT_THRESHOLDS.parallel,
        leftHip: SQUAT_THRESHOLDS.parallel,
        rightHip: SQUAT_THRESHOLDS.parallel,
      }),
      maxAngles: angles(),
      durationMs: 2000,
    });
    for (const f of squatDefinition.faults) {
      expect(f.condition(clean)).toBe(false);
    }
  });
});

describe('squat: calculateMetrics', () => {
  test('legsTracked true only when all hip+knee angles are within (0, 180)', () => {
    expect(squatDefinition.calculateMetrics(angles()).legsTracked).toBe(true);
    expect(
      squatDefinition.calculateMetrics(angles({ leftKnee: 0 })).legsTracked
    ).toBe(false);
    expect(
      squatDefinition.calculateMetrics(angles({ rightHip: 180 })).legsTracked
    ).toBe(false);
  });

  test('avgKnee / avgHip averaging', () => {
    const m = squatDefinition.calculateMetrics(
      angles({ leftKnee: 100, rightKnee: 140, leftHip: 120, rightHip: 140 })
    );
    expect(m.avgKnee).toBeCloseTo(120, 5);
    expect(m.avgHip).toBeCloseTo(130, 5);
  });

  test('armsTracked always false (squat does not use arm tracking)', () => {
    expect(squatDefinition.calculateMetrics(angles()).armsTracked).toBe(false);
  });
});
