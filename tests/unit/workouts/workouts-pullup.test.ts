/**
 * Parametric form-model coverage for lib/workouts/pullup.ts.
 *
 * Pattern mirrors tests/unit/workouts-lunge.test.ts.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import {
  pullupDefinition,
  PULLUP_THRESHOLDS,
  type PullUpMetrics,
} from '@/lib/workouts/pullup';
import { getWorkoutByMode, getWorkoutIds } from '@/lib/workouts';

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 160,
    rightElbow: 160,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
    ...overrides,
  };
}

function metrics(overrides: Partial<PullUpMetrics> = {}): PullUpMetrics {
  return {
    avgElbow: 160,
    avgShoulder: 90,
    armsTracked: true,
    ...overrides,
  };
}

function ctx(opts: {
  start?: Partial<JointAngles>;
  end?: Partial<JointAngles>;
  min?: Partial<JointAngles>;
  max?: Partial<JointAngles>;
  durationMs?: number;
}): RepContext {
  return {
    startAngles: angles(opts.start),
    endAngles: angles(opts.end),
    minAngles: angles(opts.min),
    maxAngles: angles(opts.max),
    durationMs: opts.durationMs ?? 2000,
    repNumber: 1,
    workoutId: 'pullup',
  };
}

function fault(id: string) {
  const f = pullupDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Pullup fault '${id}' not found`);
  return f;
}

describe('pullup registration', () => {
  test('pullup is registered as a detection mode', () => {
    expect(getWorkoutIds()).toContain('pullup');
  });

  test('getWorkoutByMode returns the pullup definition', () => {
    const def = getWorkoutByMode('pullup');
    expect(def.id).toBe('pullup');
    expect(def.category).toBe('upper_body');
    expect(def.initialPhase).toBe('idle');
  });

  test('thresholds are finite and form a valid engagement ladder', () => {
    for (const val of Object.values(PULLUP_THRESHOLDS)) {
      expect(Number.isFinite(val)).toBe(true);
    }
    expect(PULLUP_THRESHOLDS.hang).toBeGreaterThan(PULLUP_THRESHOLDS.engage);
    expect(PULLUP_THRESHOLDS.engage).toBeGreaterThanOrEqual(PULLUP_THRESHOLDS.release);
    expect(PULLUP_THRESHOLDS.release).toBeGreaterThan(PULLUP_THRESHOLDS.top);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = pullupDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1, 5);
  });
});

describe('pullup fault: incomplete_rom', () => {
  const f = fault('incomplete_rom');

  test('positive: min elbow above top+15 fires', () => {
    const bad = PULLUP_THRESHOLDS.top + 20;
    const c = ctx({ min: { leftElbow: bad, rightElbow: bad } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: min elbow at top does NOT fire', () => {
    const c = ctx({ min: { leftElbow: PULLUP_THRESHOLDS.top, rightElbow: PULLUP_THRESHOLDS.top } });
    expect(f.condition(c)).toBe(false);
  });

  test('boundary: exactly top+15 does NOT fire (strict >)', () => {
    const edge = PULLUP_THRESHOLDS.top + 15;
    const c = ctx({ min: { leftElbow: edge, rightElbow: edge } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('pullup fault: incomplete_extension', () => {
  const f = fault('incomplete_extension');

  test('positive: start elbow below hang-10 fires', () => {
    const bad = PULLUP_THRESHOLDS.hang - 20;
    const c = ctx({ start: { leftElbow: bad, rightElbow: bad } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: start elbow at hang does NOT fire', () => {
    const c = ctx({ start: { leftElbow: PULLUP_THRESHOLDS.hang, rightElbow: PULLUP_THRESHOLDS.hang } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('pullup fault: shoulder_elevation', () => {
  const f = fault('shoulder_elevation');

  test('positive: max shoulder > shoulderElevation fires', () => {
    const c = ctx({ max: { leftShoulder: PULLUP_THRESHOLDS.shoulderElevation + 5, rightShoulder: 90 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: max shoulder at shoulderElevation does NOT fire (strict >)', () => {
    const c = ctx({
      max: {
        leftShoulder: PULLUP_THRESHOLDS.shoulderElevation,
        rightShoulder: PULLUP_THRESHOLDS.shoulderElevation,
      },
    });
    expect(f.condition(c)).toBe(false);
  });
});

describe('pullup fault: asymmetric_pull', () => {
  const f = fault('asymmetric_pull');

  test('positive: elbow diff > 20 fires', () => {
    const c = ctx({ min: { leftElbow: 70, rightElbow: 100 } });
    expect(f.condition(c)).toBe(true);
  });

  test('negative: elbow diff exactly 20 does NOT fire', () => {
    const c = ctx({ min: { leftElbow: 80, rightElbow: 100 } });
    expect(f.condition(c)).toBe(false);
  });
});

describe('pullup fault: fast_descent', () => {
  const f = fault('fast_descent');

  test('positive: duration < 800ms fires', () => {
    expect(f.condition(ctx({ durationMs: 700 }))).toBe(true);
  });

  test('negative: duration at 800ms does NOT fire', () => {
    expect(f.condition(ctx({ durationMs: 800 }))).toBe(false);
  });
});

describe('pullup FSM edge transitions', () => {
  test('armsTracked=false forces idle from any phase', () => {
    for (const phase of ['idle', 'hang', 'pull', 'top'] as const) {
      const next = pullupDefinition.getNextPhase(phase, angles(), metrics({ armsTracked: false }));
      expect(next).toBe('idle');
    }
  });

  test('hang -> pull at engage threshold', () => {
    const next = pullupDefinition.getNextPhase(
      'hang',
      angles(),
      metrics({ avgElbow: PULLUP_THRESHOLDS.engage })
    );
    expect(next).toBe('pull');
  });

  test('pull -> top at top threshold', () => {
    const next = pullupDefinition.getNextPhase(
      'pull',
      angles(),
      metrics({ avgElbow: PULLUP_THRESHOLDS.top })
    );
    expect(next).toBe('top');
  });

  test('pull -> hang when athlete re-extends past hang threshold', () => {
    const next = pullupDefinition.getNextPhase(
      'pull',
      angles(),
      metrics({ avgElbow: PULLUP_THRESHOLDS.hang })
    );
    expect(next).toBe('hang');
  });
});

describe('pullup calculateMetrics', () => {
  test('averages elbow and shoulder', () => {
    const m = pullupDefinition.calculateMetrics(angles({ leftElbow: 80, rightElbow: 120, leftShoulder: 85, rightShoulder: 95 }));
    expect(m.avgElbow).toBe(100);
    expect(m.avgShoulder).toBe(90);
  });

  test('armsTracked=false for degenerate elbow 0/180', () => {
    expect(pullupDefinition.calculateMetrics(angles({ leftElbow: 0 })).armsTracked).toBe(false);
    expect(pullupDefinition.calculateMetrics(angles({ rightElbow: 180 })).armsTracked).toBe(false);
  });
});
