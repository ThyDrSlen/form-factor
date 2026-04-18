/**
 * Unit tests for lib/workouts/pullup.ts — phase FSM, rep boundary, faults,
 * thresholds, hysteresis, and metric computation.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';
import {
  pullupDefinition,
  PULLUP_THRESHOLDS,
  type PullUpMetrics,
  type PullUpPhase,
} from '@/lib/workouts/pullup';

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

function metrics(override: Partial<PullUpMetrics> = {}): PullUpMetrics {
  return {
    avgElbow: 160,
    avgShoulder: 90,
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
    workoutId: 'pullup',
    ...override,
  };
}

describe('pullup: definition metadata', () => {
  test('exposes expected id, category, initial phase, and phase set', () => {
    expect(pullupDefinition.id).toBe('pullup');
    expect(pullupDefinition.category).toBe('upper_body');
    expect(pullupDefinition.initialPhase).toBe('idle');
    const phaseIds = pullupDefinition.phases.map((p) => p.id).sort();
    expect(phaseIds).toEqual(['hang', 'idle', 'pull', 'top']);
  });

  test('rep boundary is pull -> top with a non-zero debounce', () => {
    expect(pullupDefinition.repBoundary.startPhase).toBe('pull');
    expect(pullupDefinition.repBoundary.endPhase).toBe('top');
    expect(pullupDefinition.repBoundary.minDurationMs).toBeGreaterThan(0);
  });

  test('thresholds form a monotonically descending engagement ladder', () => {
    // hang > engage > release >= top: the detector relies on this ordering.
    expect(PULLUP_THRESHOLDS.hang).toBeGreaterThan(PULLUP_THRESHOLDS.engage);
    expect(PULLUP_THRESHOLDS.engage).toBeGreaterThanOrEqual(PULLUP_THRESHOLDS.release);
    expect(PULLUP_THRESHOLDS.release).toBeGreaterThan(PULLUP_THRESHOLDS.top);
  });

  test('FQI weights sum to 1.0', () => {
    const { rom, depth, faults } = pullupDefinition.fqiWeights;
    expect(rom + depth + faults).toBeCloseTo(1.0, 5);
  });
});

describe('pullup: phase FSM (getNextPhase)', () => {
  const nextPhase = (cur: PullUpPhase, m: PullUpMetrics): PullUpPhase =>
    pullupDefinition.getNextPhase(cur, angles({ leftElbow: m.avgElbow, rightElbow: m.avgElbow }), m);

  test('armsTracked=false from any phase forces idle', () => {
    const m = metrics({ armsTracked: false });
    (['idle', 'hang', 'pull', 'top'] as PullUpPhase[]).forEach((p) => {
      expect(nextPhase(p, m)).toBe('idle');
    });
  });

  test('idle -> hang when elbow reaches hang threshold', () => {
    expect(nextPhase('idle', metrics({ avgElbow: PULLUP_THRESHOLDS.hang }))).toBe('hang');
    // Just below hang threshold stays idle as long as above engage threshold.
    expect(nextPhase('idle', metrics({ avgElbow: PULLUP_THRESHOLDS.hang - 1 }))).toBe('idle');
  });

  test('idle -> pull if already engaged (mid-rep start)', () => {
    expect(nextPhase('idle', metrics({ avgElbow: PULLUP_THRESHOLDS.engage }))).toBe('pull');
    expect(nextPhase('idle', metrics({ avgElbow: PULLUP_THRESHOLDS.engage - 20 }))).toBe('pull');
  });

  test('hang -> pull crosses engage threshold from above', () => {
    expect(nextPhase('hang', metrics({ avgElbow: PULLUP_THRESHOLDS.engage + 1 }))).toBe('hang');
    expect(nextPhase('hang', metrics({ avgElbow: PULLUP_THRESHOLDS.engage }))).toBe('pull');
  });

  test('pull -> top when elbow reaches top threshold', () => {
    expect(nextPhase('pull', metrics({ avgElbow: PULLUP_THRESHOLDS.top }))).toBe('top');
    expect(nextPhase('pull', metrics({ avgElbow: PULLUP_THRESHOLDS.top + 1 }))).toBe('pull');
  });

  test('pull -> hang if athlete aborts and arms re-extend past hang', () => {
    expect(nextPhase('pull', metrics({ avgElbow: PULLUP_THRESHOLDS.hang }))).toBe('hang');
  });

  test('top -> hang when elbow >= release (rep completes)', () => {
    expect(nextPhase('top', metrics({ avgElbow: PULLUP_THRESHOLDS.release }))).toBe('hang');
    // Below release stays at top (hysteresis: prevents chattering between top and hang).
    expect(nextPhase('top', metrics({ avgElbow: PULLUP_THRESHOLDS.release - 1 }))).toBe('top');
  });

  test('invalid transitions are rejected: idle never jumps to top directly', () => {
    expect(nextPhase('idle', metrics({ avgElbow: PULLUP_THRESHOLDS.top }))).toBe('pull');
  });

  test('hysteresis: bouncing right around the engage threshold does not flicker pull<->hang', () => {
    // Enter pull when elbow drops.
    let phase: PullUpPhase = 'hang';
    phase = nextPhase(phase, metrics({ avgElbow: PULLUP_THRESHOLDS.engage }));
    expect(phase).toBe('pull');
    // Small noise above engage but below hang stays in pull (no flicker).
    phase = nextPhase(phase, metrics({ avgElbow: PULLUP_THRESHOLDS.engage + 5 }));
    expect(phase).toBe('pull');
    // Only crossing hang threshold reverts to hang.
    phase = nextPhase(phase, metrics({ avgElbow: PULLUP_THRESHOLDS.hang }));
    expect(phase).toBe('hang');
  });
});

describe('pullup: fault detection at threshold boundaries', () => {
  const faultById = (id: string) => pullupDefinition.faults.find((f) => f.id === id);

  test('incomplete_rom fires when minElbow stays above top + 15', () => {
    const fault = faultById('incomplete_rom');
    expect(fault).toBeDefined();
    const borderBad = PULLUP_THRESHOLDS.top + 16;
    const borderGood = PULLUP_THRESHOLDS.top + 15;
    expect(
      fault!.condition(
        baseRepContext({ minAngles: angles({ leftElbow: borderBad, rightElbow: borderBad }) })
      )
    ).toBe(true);
    expect(
      fault!.condition(
        baseRepContext({ minAngles: angles({ leftElbow: borderGood, rightElbow: borderGood }) })
      )
    ).toBe(false);
  });

  test('incomplete_extension fires when startElbow < hang - 10', () => {
    const fault = faultById('incomplete_extension');
    expect(fault).toBeDefined();
    const borderBad = PULLUP_THRESHOLDS.hang - 11;
    const borderGood = PULLUP_THRESHOLDS.hang - 10;
    expect(
      fault!.condition(
        baseRepContext({ startAngles: angles({ leftElbow: borderBad, rightElbow: borderBad }) })
      )
    ).toBe(true);
    expect(
      fault!.condition(
        baseRepContext({ startAngles: angles({ leftElbow: borderGood, rightElbow: borderGood }) })
      )
    ).toBe(false);
  });

  test('shoulder_elevation fires when maxShoulder > shoulderElevation threshold', () => {
    const fault = faultById('shoulder_elevation');
    expect(fault).toBeDefined();
    const bad = PULLUP_THRESHOLDS.shoulderElevation + 1;
    const good = PULLUP_THRESHOLDS.shoulderElevation;
    expect(
      fault!.condition(
        baseRepContext({ maxAngles: angles({ leftShoulder: bad, rightShoulder: bad }) })
      )
    ).toBe(true);
    expect(
      fault!.condition(
        baseRepContext({ maxAngles: angles({ leftShoulder: good, rightShoulder: good }) })
      )
    ).toBe(false);
  });

  test('asymmetric_pull fires when elbow diff > 20', () => {
    const fault = faultById('asymmetric_pull');
    expect(fault).toBeDefined();
    expect(
      fault!.condition(
        baseRepContext({ minAngles: angles({ leftElbow: 80, rightElbow: 101 }) })
      )
    ).toBe(true);
    // Diff of exactly 20 is NOT > 20, so should not fire.
    expect(
      fault!.condition(
        baseRepContext({ minAngles: angles({ leftElbow: 80, rightElbow: 100 }) })
      )
    ).toBe(false);
  });

  test('fast_descent fires below 800ms', () => {
    const fault = faultById('fast_descent');
    expect(fault).toBeDefined();
    expect(fault!.condition(baseRepContext({ durationMs: 799 }))).toBe(true);
    expect(fault!.condition(baseRepContext({ durationMs: 800 }))).toBe(false);
  });

  test('clean rep triggers no faults', () => {
    const cleanCtx = baseRepContext({
      startAngles: angles({ leftElbow: PULLUP_THRESHOLDS.hang + 5, rightElbow: PULLUP_THRESHOLDS.hang + 5 }),
      endAngles: angles({ leftElbow: PULLUP_THRESHOLDS.hang + 5, rightElbow: PULLUP_THRESHOLDS.hang + 5 }),
      minAngles: angles({ leftElbow: PULLUP_THRESHOLDS.top, rightElbow: PULLUP_THRESHOLDS.top }),
      maxAngles: angles({ leftShoulder: 100, rightShoulder: 100 }),
      durationMs: 2000,
    });
    for (const fault of pullupDefinition.faults) {
      expect(fault.condition(cleanCtx)).toBe(false);
    }
  });
});

describe('pullup: calculateMetrics', () => {
  test('averages left/right elbow and shoulder', () => {
    const m = pullupDefinition.calculateMetrics(
      angles({ leftElbow: 100, rightElbow: 120, leftShoulder: 80, rightShoulder: 100 })
    );
    expect(m.avgElbow).toBeCloseTo(110, 5);
    expect(m.avgShoulder).toBeCloseTo(90, 5);
  });

  test('armsTracked false when elbow is at 0 or >= 180 (degenerate)', () => {
    expect(
      pullupDefinition.calculateMetrics(angles({ leftElbow: 0, rightElbow: 90 })).armsTracked
    ).toBe(false);
    expect(
      pullupDefinition.calculateMetrics(angles({ leftElbow: 180, rightElbow: 90 })).armsTracked
    ).toBe(false);
    expect(
      pullupDefinition.calculateMetrics(angles({ leftElbow: 90, rightElbow: 90 })).armsTracked
    ).toBe(true);
  });

  test('headToHand is computed when head + both hands are tracked', () => {
    const joints = new Map<string, { x: number; y: number; isTracked: boolean }>([
      ['head', { x: 0.5, y: 0.1, isTracked: true }],
      ['left_hand', { x: 0.4, y: 0.3, isTracked: true }],
      ['right_hand', { x: 0.6, y: 0.3, isTracked: true }],
    ]);
    const m = pullupDefinition.calculateMetrics(angles(), joints);
    // head.y (0.1) - avgHandY (0.3) = -0.2
    expect(m.headToHand).toBeCloseTo(-0.2, 5);
  });

  test('headToHand is undefined when any required joint is not tracked', () => {
    const joints = new Map<string, { x: number; y: number; isTracked: boolean }>([
      ['head', { x: 0.5, y: 0.1, isTracked: false }],
      ['left_hand', { x: 0.4, y: 0.3, isTracked: true }],
      ['right_hand', { x: 0.6, y: 0.3, isTracked: true }],
    ]);
    expect(pullupDefinition.calculateMetrics(angles(), joints).headToHand).toBeUndefined();
  });
});

describe('pullup: realtime cues (UI adapter)', () => {
  test('emits hang cue when elbow below hang - 5 in hang phase', () => {
    const msgs = pullupDefinition.ui!.getRealtimeCues!({
      phaseId: 'hang',
      metrics: metrics({ avgElbow: PULLUP_THRESHOLDS.hang - 10 }),
    });
    expect(msgs?.some((m) => /extend/i.test(m))).toBe(true);
  });

  test('emits top cue when avg elbow above top + 15 in top phase', () => {
    const msgs = pullupDefinition.ui!.getRealtimeCues!({
      phaseId: 'top',
      metrics: metrics({ avgElbow: PULLUP_THRESHOLDS.top + 20 }),
    });
    expect(msgs?.some((m) => /pull higher/i.test(m))).toBe(true);
  });

  test('falls back to an encouraging cue when form is clean', () => {
    const msgs = pullupDefinition.ui!.getRealtimeCues!({
      phaseId: 'top',
      metrics: metrics({ avgElbow: PULLUP_THRESHOLDS.top, avgShoulder: 90 }),
    });
    expect(msgs).toBeTruthy();
    expect(msgs!.length).toBeGreaterThan(0);
  });
});
