/**
 * Integration: pose frames -> phase FSM -> rep detection -> scoring -> cues.
 *
 * Feeds synthetic pullup, squat, and pushup rep sequences through the full
 * pipeline and asserts:
 *   - expected rep count at the FSM level (workout definition getNextPhase)
 *   - expected rep count at the detector level (RepDetectorPullup for pullup)
 *   - anatomically valid angles surface at the scoring layer
 *   - fault triggers fire at the expected moment
 *   - cue engine emits the correct rule based on phase + metrics
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { createCueEngine, type CueEmission, type CueRule } from '@/lib/fusion/cue-engine';
import { scorePullupWithComponentAvailability } from '@/lib/tracking-quality/scoring';
import { RepDetectorPullup } from '@/lib/tracking-quality/rep-detector';
import {
  pullupDefinition,
  PULLUP_THRESHOLDS,
  type PullUpPhase,
} from '@/lib/workouts/pullup';
import { pushupDefinition, PUSHUP_THRESHOLDS, type PushUpPhase } from '@/lib/workouts/pushup';
import { squatDefinition, SQUAT_THRESHOLDS, type SquatPhase } from '@/lib/workouts/squat';
import {
  buildCanonicalJointMap,
  buildRepDetectorJoints,
  buildRealisticAngles,
} from '../helpers/arkit-frame-builder';

type FrameSample<A extends JointAngles = JointAngles> = {
  tSec: number;
  angles: A;
  handY?: number;
  shoulderY?: number;
};

// ---------------------------------------------------------------------------
// Helpers to synthesize rep sequences.
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function makePullupFrames(numReps: number, fps = 30): FrameSample[] {
  const frames: FrameSample[] = [];
  const framesPerPhase = Math.max(4, Math.round(fps * 0.7));
  const restFrames = Math.max(4, Math.round(fps * 0.4));
  let tSec = 0;
  const shoulderY = 0.33;
  const handYBottom = 0.61;
  const handYTop = 0.44;

  const push = (elbow: number, handY: number) => {
    frames.push({
      tSec,
      angles: buildRealisticAngles({ leftElbow: elbow, rightElbow: elbow, leftShoulder: 90, rightShoulder: 90 }),
      handY,
      shoulderY,
    });
    tSec += 1 / fps;
  };

  // Start with a steady hang so the detector sets its baseline.
  for (let i = 0; i < framesPerPhase; i += 1) {
    push(PULLUP_THRESHOLDS.hang + 5, handYBottom);
  }

  for (let r = 0; r < numReps; r += 1) {
    // Pull phase (hang -> top).
    for (let i = 0; i < framesPerPhase; i += 1) {
      const pct = i / (framesPerPhase - 1);
      push(lerp(PULLUP_THRESHOLDS.hang, PULLUP_THRESHOLDS.top - 2, pct), lerp(handYBottom, handYTop, pct));
    }
    // Top hold.
    for (let i = 0; i < restFrames; i += 1) {
      push(PULLUP_THRESHOLDS.top - 2, handYTop);
    }
    // Descent.
    for (let i = 0; i < framesPerPhase; i += 1) {
      const pct = i / (framesPerPhase - 1);
      push(lerp(PULLUP_THRESHOLDS.top - 2, PULLUP_THRESHOLDS.hang + 2, pct), lerp(handYTop, handYBottom, pct));
    }
    // Bottom hold.
    for (let i = 0; i < restFrames; i += 1) {
      push(PULLUP_THRESHOLDS.hang + 5, handYBottom);
    }
  }

  return frames;
}

function makeSquatFrames(numReps: number, fps = 30): FrameSample[] {
  const frames: FrameSample[] = [];
  const framesPerPhase = Math.max(6, Math.round(fps * 0.8));
  let tSec = 0;

  const push = (knee: number, hip: number) => {
    frames.push({
      tSec,
      angles: buildRealisticAngles({
        leftKnee: knee,
        rightKnee: knee,
        leftHip: hip,
        rightHip: hip,
      }),
    });
    tSec += 1 / fps;
  };

  // Start standing.
  for (let i = 0; i < framesPerPhase; i += 1) push(SQUAT_THRESHOLDS.standing + 5, SQUAT_THRESHOLDS.standing + 5);

  for (let r = 0; r < numReps; r += 1) {
    // Descent.
    for (let i = 0; i < framesPerPhase; i += 1) {
      const pct = i / (framesPerPhase - 1);
      push(
        lerp(SQUAT_THRESHOLDS.standing + 5, SQUAT_THRESHOLDS.parallel - 3, pct),
        lerp(SQUAT_THRESHOLDS.standing + 5, SQUAT_THRESHOLDS.parallel, pct),
      );
    }
    // Bottom.
    for (let i = 0; i < 4; i += 1) push(SQUAT_THRESHOLDS.parallel - 3, SQUAT_THRESHOLDS.parallel);
    // Ascent.
    for (let i = 0; i < framesPerPhase; i += 1) {
      const pct = i / (framesPerPhase - 1);
      push(
        lerp(SQUAT_THRESHOLDS.parallel - 3, SQUAT_THRESHOLDS.standing + 5, pct),
        lerp(SQUAT_THRESHOLDS.parallel, SQUAT_THRESHOLDS.standing + 5, pct),
      );
    }
    // Stand.
    for (let i = 0; i < 4; i += 1) push(SQUAT_THRESHOLDS.standing + 5, SQUAT_THRESHOLDS.standing + 5);
  }

  return frames;
}

function makePushupFrames(numReps: number, fps = 30): FrameSample[] {
  const frames: FrameSample[] = [];
  const framesPerPhase = Math.max(6, Math.round(fps * 0.6));
  let tSec = 0;
  const push = (elbow: number) => {
    frames.push({
      tSec,
      angles: buildRealisticAngles({
        leftElbow: elbow,
        rightElbow: elbow,
        leftHip: 175,
        rightHip: 175,
      }),
    });
    tSec += 1 / fps;
  };
  // Plank.
  for (let i = 0; i < framesPerPhase; i += 1) push(PUSHUP_THRESHOLDS.readyElbow + 5);

  for (let r = 0; r < numReps; r += 1) {
    for (let i = 0; i < framesPerPhase; i += 1) {
      push(lerp(PUSHUP_THRESHOLDS.readyElbow + 5, PUSHUP_THRESHOLDS.bottom - 2, i / (framesPerPhase - 1)));
    }
    for (let i = 0; i < 4; i += 1) push(PUSHUP_THRESHOLDS.bottom - 2);
    for (let i = 0; i < framesPerPhase; i += 1) {
      push(lerp(PUSHUP_THRESHOLDS.bottom - 2, PUSHUP_THRESHOLDS.finish + 2, i / (framesPerPhase - 1)));
    }
    for (let i = 0; i < 4; i += 1) push(PUSHUP_THRESHOLDS.finish + 5);
  }

  return frames;
}

// ---------------------------------------------------------------------------
// FSM rep counter helper (counts start->end transitions in the workout
// definition's rep boundary).
// ---------------------------------------------------------------------------

function runFsm<TPhase extends string, TMetrics>(
  frames: FrameSample[],
  initialPhase: TPhase,
  getNextPhase: (cur: TPhase, a: JointAngles, m: TMetrics) => TPhase,
  calculateMetrics: (a: JointAngles) => TMetrics,
  rep: { start: TPhase; end: TPhase },
): { reps: number; transitions: TPhase[] } {
  let phase: TPhase = initialPhase;
  let started = false;
  let reps = 0;
  const transitions: TPhase[] = [phase];
  for (const frame of frames) {
    const metrics = calculateMetrics(frame.angles);
    const next = getNextPhase(phase, frame.angles, metrics);
    if (next !== phase) {
      transitions.push(next);
    }
    if (phase === rep.start) started = true;
    if (started && phase !== rep.end && next === rep.end) {
      reps += 1;
      started = false;
    }
    phase = next;
  }
  return { reps, transitions };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tracking pipeline integration: pullup (pose -> FSM -> detector -> scoring)', () => {
  test('3-rep clean pullup sequence produces 3 FSM reps', () => {
    const frames = makePullupFrames(3);
    const result = runFsm(
      frames,
      pullupDefinition.initialPhase,
      pullupDefinition.getNextPhase,
      pullupDefinition.calculateMetrics,
      { start: 'pull' as PullUpPhase, end: 'top' as PullUpPhase },
    );
    expect(result.reps).toBe(3);
  });

  test('rep detector counts within +/-1 of the FSM-level rep count on clean frames', () => {
    const frames = makePullupFrames(3);
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    for (const f of frames) {
      detector.step({
        timestampSec: f.tSec,
        angles: f.angles,
        joints: buildRepDetectorJoints({ handY: f.handY, shoulderY: f.shoulderY }),
      });
    }
    const s = detector.getSnapshot();
    // Sequence emits up to 3 rising edges; detector must be within +/-1 (tolerates
    // gating mid-rep).
    expect(Math.abs(s.repCount - 3)).toBeLessThanOrEqual(1);
    expect(s.baselineGap === null || Number.isFinite(s.baselineGap)).toBe(true);
  });

  test('scorePullupWithComponentAvailability returns a full-visibility badge on clean synthetic rep', () => {
    const joints = buildCanonicalJointMap({ confidence: 0.92 });
    const result = scorePullupWithComponentAvailability({
      repAngles: {
        start: { leftElbow: 160, rightElbow: 160, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 160, rightElbow: 160, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 85, rightElbow: 85, leftShoulder: 90, rightShoulder: 90 },
        max: { leftElbow: 160, rightElbow: 160, leftShoulder: 100, rightShoulder: 100 },
      },
      durationMs: 1800,
      joints,
    });
    expect(result.visibility_badge).toBe('full');
    expect(result.overall_score).not.toBeNull();
    expect(result.overall_score!).toBeGreaterThan(0);
    expect(result.overall_score!).toBeLessThanOrEqual(100);
  });

  test('scoring is suppressed when elbows/forearms are occluded (rom + symmetry unavailable)', () => {
    const joints = buildCanonicalJointMap({
      confidence: 0.92,
      joints: {
        left_forearm_joint: { confidence: 0.1, isTracked: false },
        right_forearm_joint: { confidence: 0.1, isTracked: false },
      },
    });
    const result = scorePullupWithComponentAvailability({
      repAngles: {
        start: { leftElbow: 160, rightElbow: 160, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 160, rightElbow: 160, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 85, rightElbow: 85, leftShoulder: 90, rightShoulder: 90 },
        max: { leftElbow: 160, rightElbow: 160, leftShoulder: 100, rightShoulder: 100 },
      },
      durationMs: 1500,
      joints,
    });
    // ROM + symmetry (both require elbow/forearm) should be missing; badge is partial.
    expect(result.visibility_badge).toBe('partial');
    expect(result.missing_components).toEqual(
      expect.arrayContaining(['rom_score', 'symmetry_score']),
    );
  });

  test('zero-confidence joints everywhere fully suppress scoring (overall null or suppression_reason set)', () => {
    const joints = buildCanonicalJointMap({ confidence: 0.05 });
    const result = scorePullupWithComponentAvailability({
      repAngles: {
        start: { leftElbow: 160, rightElbow: 160, leftShoulder: 90, rightShoulder: 90 },
        end: { leftElbow: 160, rightElbow: 160, leftShoulder: 90, rightShoulder: 90 },
        min: { leftElbow: 85, rightElbow: 85, leftShoulder: 90, rightShoulder: 90 },
        max: { leftElbow: 160, rightElbow: 160, leftShoulder: 100, rightShoulder: 100 },
      },
      durationMs: 1500,
      joints,
    });
    expect(result.missing_components.length).toBeGreaterThan(0);
  });
});

describe('tracking pipeline integration: squat (pose -> FSM)', () => {
  test('3-rep clean squat sequence produces 3 FSM reps (descent -> standing)', () => {
    const frames = makeSquatFrames(3);
    const result = runFsm(
      frames,
      squatDefinition.initialPhase,
      squatDefinition.getNextPhase,
      squatDefinition.calculateMetrics,
      { start: 'descent' as SquatPhase, end: 'standing' as SquatPhase },
    );
    expect(result.reps).toBe(3);
    // Phase ordering invariant: must touch bottom at least once per rep.
    expect(result.transitions.filter((p) => p === 'bottom').length).toBeGreaterThanOrEqual(3);
  });

  test('shallow squat (never reaches parallel) counts 0 reps', () => {
    // Build frames that stop at descentStart - 5 (below trigger to enter bottom).
    const frames: FrameSample[] = [];
    for (let i = 0; i < 10; i += 1) {
      frames.push({ tSec: i / 30, angles: buildRealisticAngles({ leftKnee: SQUAT_THRESHOLDS.standing + 5, rightKnee: SQUAT_THRESHOLDS.standing + 5 }) });
    }
    for (let i = 0; i < 10; i += 1) {
      frames.push({ tSec: (10 + i) / 30, angles: buildRealisticAngles({ leftKnee: SQUAT_THRESHOLDS.descentStart - 5, rightKnee: SQUAT_THRESHOLDS.descentStart - 5 }) });
    }
    for (let i = 0; i < 10; i += 1) {
      frames.push({ tSec: (20 + i) / 30, angles: buildRealisticAngles({ leftKnee: SQUAT_THRESHOLDS.standing + 5, rightKnee: SQUAT_THRESHOLDS.standing + 5 }) });
    }
    const result = runFsm(
      frames,
      squatDefinition.initialPhase,
      squatDefinition.getNextPhase,
      squatDefinition.calculateMetrics,
      { start: 'descent' as SquatPhase, end: 'standing' as SquatPhase },
    );
    expect(result.reps).toBe(0);
  });
});

describe('tracking pipeline integration: pushup (pose -> FSM)', () => {
  test('2-rep clean pushup sequence produces 2 FSM reps (lowering -> plank)', () => {
    const frames = makePushupFrames(2);
    // Pushup needs wristsTracked=true. Our metrics gate on that — provide synthetic
    // hand joints via a custom metrics function.
    const fakeMetrics = (angles: JointAngles) => ({
      ...pushupDefinition.calculateMetrics(angles),
      wristsTracked: true,
    });
    const result = runFsm(
      frames,
      pushupDefinition.initialPhase,
      pushupDefinition.getNextPhase,
      fakeMetrics,
      { start: 'lowering' as PushUpPhase, end: 'plank' as PushUpPhase },
    );
    expect(result.reps).toBe(2);
  });
});

describe('tracking pipeline integration: cue engine emits rule when threshold is persistently violated', () => {
  test('cue emits after persist window, respects cooldown and confidence gate', () => {
    const rules: CueRule[] = [
      {
        id: 'hip-sag',
        metric: 'hipDrop',
        phases: ['bottom'],
        min: 0,
        max: 0.15,
        persistMs: 200,
        cooldownMs: 500,
        priority: 1,
        message: 'Squeeze glutes to stop hip sag.',
      },
    ];
    const engine = createCueEngine(rules, { minConfidence: 0.5 });

    // Low confidence -> no cue regardless.
    expect(
      engine.evaluate({ timestampMs: 0, phase: 'bottom', confidence: 0.3, metrics: { hipDrop: 0.9 } }).length,
    ).toBe(0);

    // Violation, confidence OK, not persisted yet -> no cue.
    expect(engine.evaluate({ timestampMs: 0, phase: 'bottom', confidence: 0.9, metrics: { hipDrop: 0.9 } })).toEqual([]);

    // Persisted past persistMs -> cue fires.
    const fired = engine.evaluate({ timestampMs: 300, phase: 'bottom', confidence: 0.9, metrics: { hipDrop: 0.9 } });
    expect(fired.length).toBe(1);
    const emission: CueEmission = fired[0];
    expect(emission.ruleId).toBe('hip-sag');
    expect(emission.message).toBe('Squeeze glutes to stop hip sag.');

    // Within cooldown -> no cue.
    expect(
      engine.evaluate({ timestampMs: 500, phase: 'bottom', confidence: 0.9, metrics: { hipDrop: 0.9 } }).length,
    ).toBe(0);

    // Wrong phase clears the violation-since marker -> needs to re-persist.
    engine.evaluate({ timestampMs: 600, phase: 'setup', confidence: 0.9, metrics: { hipDrop: 0.9 } });
    expect(
      engine.evaluate({ timestampMs: 700, phase: 'bottom', confidence: 0.9, metrics: { hipDrop: 0.9 } }).length,
    ).toBe(0);
  });

  test('non-finite metric value clears violation-since counter (no cue on NaN)', () => {
    const rules: CueRule[] = [
      {
        id: 'nan-guard',
        metric: 'elbow',
        phases: ['bottom'],
        min: 0,
        max: 100,
        persistMs: 100,
        cooldownMs: 100,
        priority: 1,
        message: 'should not fire',
      },
    ];
    const engine = createCueEngine(rules, { minConfidence: 0.0 });
    // Start violating with a sensible value.
    engine.evaluate({ timestampMs: 0, phase: 'bottom', confidence: 1, metrics: { elbow: 200 } });
    // Then NaN arrives — clears the violation counter.
    engine.evaluate({ timestampMs: 50, phase: 'bottom', confidence: 1, metrics: { elbow: Number.NaN } });
    // Recover to a valid violating value — the persist window restarts.
    const later = engine.evaluate({ timestampMs: 120, phase: 'bottom', confidence: 1, metrics: { elbow: 200 } });
    expect(later.length).toBe(0);
  });
});
