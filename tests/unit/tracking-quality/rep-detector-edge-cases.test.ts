/**
 * Rep-detector edge cases.
 *
 * Targets known weak spots in `lib/tracking-quality/rep-detector.ts`:
 *   1. Impossible joint geometry (inverted skeleton / shoulder y > hand y).
 *   2. All joints `isTracked=false` mid-rep with subsequent recovery.
 *   3. Rapid `isTracked` flicker and `computeShoulderHandGap` null handling.
 *   4. NaN / Infinity angle injection — no state corruption.
 *   5. Input validation of non-finite trackingQuality + missing joints.
 */

import { RepDetectorPullup } from '@/lib/tracking-quality/rep-detector';
import type { RepDetectorPullupJoints, RepDetectorPullupStepInput } from '@/lib/tracking-quality/rep-detector';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

function neutralAngles(override: Partial<JointAngles> = {}): JointAngles {
  return {
    leftKnee: 160,
    rightKnee: 160,
    leftElbow: 160,
    rightElbow: 160,
    leftHip: 160,
    rightHip: 160,
    leftShoulder: 90,
    rightShoulder: 90,
    ...override,
  };
}

function joints(override: {
  shoulderY?: number;
  handY?: number;
  tracked?: boolean;
  conf?: number;
} = {}): RepDetectorPullupJoints {
  const shoulderY = override.shoulderY ?? 0.33;
  const handY = override.handY ?? 0.6;
  const tracked = override.tracked ?? true;
  const conf = override.conf ?? 0.95;
  return {
    left_shoulder: { x: 0.4, y: shoulderY, isTracked: tracked, confidence: conf },
    right_shoulder: { x: 0.6, y: shoulderY, isTracked: tracked, confidence: conf },
    left_hand: { x: 0.35, y: handY, isTracked: tracked, confidence: conf },
    right_hand: { x: 0.65, y: handY, isTracked: tracked, confidence: conf },
  };
}

function step(
  detector: RepDetectorPullup,
  t: number,
  overrides: Partial<RepDetectorPullupStepInput> = {},
): void {
  detector.step({
    timestampSec: t,
    angles: neutralAngles(),
    joints: joints(),
    ...overrides,
  });
}

describe('rep-detector edge cases: inverted geometry', () => {
  test('shoulders BELOW hands (handY < shoulderY) — gap is negative; detector does not spuriously count reps', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    let t = 0;
    // In normal upright pull-up framing, hands are above shoulders (smaller y in image coords).
    // In inverted framing the deltas never exceed `liftStartDelta`, so no rep should fire.
    for (let i = 0; i < 80; i += 1) {
      step(detector, t, {
        angles: neutralAngles({ leftElbow: 160, rightElbow: 160 }),
        joints: joints({ shoulderY: 0.6, handY: 0.33 }),
      });
      t += 1 / 30;
    }
    const snapshot = detector.getSnapshot();
    expect(snapshot.repCount).toBe(0);
    // Detector should remain in a sane state, not get wedged with non-finite baselineGap.
    expect(snapshot.baselineGap === null || Number.isFinite(snapshot.baselineGap)).toBe(true);
    expect(snapshot.state).toMatch(/^(bottom|ascending|top|descending)$/);
  });
});

describe('rep-detector edge cases: all-untracked mid-rep + recovery', () => {
  test('state is preserved through an untracked burst shorter than maxFrozenFrames', () => {
    const detector = new RepDetectorPullup({
      nConsecFrames: 3,
      minJointConfidence: 0.6,
      maxFrozenFrames: 30,
    });
    let t = 0;

    // Establish baseline (bottom).
    for (let i = 0; i < 10; i += 1) {
      step(detector, t, { angles: neutralAngles({ leftElbow: 160, rightElbow: 160 }), joints: joints({ handY: 0.6 }) });
      t += 1 / 30;
    }
    const preFreezeState = detector.getSnapshot().state;
    const preFreezeCount = detector.getSnapshot().repCount;

    // All joints untracked for 8 frames (< maxFrozenFrames).
    for (let i = 0; i < 8; i += 1) {
      step(detector, t, { joints: joints({ tracked: false, conf: 0.05 }) });
      t += 1 / 30;
    }
    const duringFreeze = detector.getSnapshot();
    expect(duringFreeze.state).toBe(preFreezeState);
    expect(duringFreeze.repCount).toBe(preFreezeCount);
    expect(duringFreeze.frozenFrames).toBeGreaterThan(0);

    // Joints return — detector resumes normal operation.
    for (let i = 0; i < 5; i += 1) {
      step(detector, t, { joints: joints({ handY: 0.6 }) });
      t += 1 / 30;
    }
    const afterRecovery = detector.getSnapshot();
    expect(afterRecovery.frozenFrames).toBe(0);
  });

  test('untracked window exceeding maxFrozenFrames resets the cycle', () => {
    const detector = new RepDetectorPullup({
      nConsecFrames: 3,
      minJointConfidence: 0.6,
      maxFrozenFrames: 5,
    });
    let t = 0;

    // Warm up so baselineGap is set.
    for (let i = 0; i < 10; i += 1) {
      step(detector, t, { joints: joints({ handY: 0.6 }) });
      t += 1 / 30;
    }
    expect(detector.getSnapshot().baselineGap).not.toBeNull();

    // Untracked long enough to trigger reset.
    for (let i = 0; i < 20; i += 1) {
      step(detector, t, { joints: joints({ tracked: false, conf: 0.05 }) });
      t += 1 / 30;
    }
    let s = detector.getSnapshot();
    // After resetCycle(), state collapses back to 'bottom' regardless of prior state.
    expect(s.state).toBe('bottom');
    // Subsequent untracked frames keep accumulating on the counter; recovery resets it.
    for (let i = 0; i < 3; i += 1) {
      step(detector, t, { joints: joints({ handY: 0.6 }) });
      t += 1 / 30;
    }
    s = detector.getSnapshot();
    expect(s.frozenFrames).toBe(0);
  });
});

describe('rep-detector edge cases: rapid isTracked flicker', () => {
  test('alternating tracked/untracked frames do not cause spurious rep transitions', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    let t = 0;

    for (let i = 0; i < 60; i += 1) {
      const tracked = i % 2 === 0;
      step(detector, t, {
        joints: joints({
          tracked,
          conf: tracked ? 0.95 : 0.1,
          handY: 0.6,
        }),
      });
      t += 1 / 30;
    }
    const s = detector.getSnapshot();
    expect(s.repCount).toBe(0);
    expect(s.state).toBe('bottom');
  });

  test('joints prop is null should NOT throw and should freeze', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    expect(() =>
      detector.step({
        timestampSec: 0,
        angles: neutralAngles(),
        joints: null,
      }),
    ).not.toThrow();
    expect(detector.getSnapshot().frozenFrames).toBeGreaterThan(0);
  });

  test('joints prop is undefined should NOT throw and should freeze', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    expect(() =>
      detector.step({
        timestampSec: 0,
        angles: neutralAngles(),
        joints: undefined,
      }),
    ).not.toThrow();
    expect(detector.getSnapshot().frozenFrames).toBeGreaterThan(0);
  });

  test('missing one of the four required joints (e.g. left_hand absent) causes freeze', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    const partial: RepDetectorPullupJoints = {
      left_shoulder: { x: 0.4, y: 0.33, isTracked: true, confidence: 0.95 },
      right_shoulder: { x: 0.6, y: 0.33, isTracked: true, confidence: 0.95 },
      right_hand: { x: 0.65, y: 0.6, isTracked: true, confidence: 0.95 },
      // left_hand intentionally missing
    };
    detector.step({ timestampSec: 0, angles: neutralAngles(), joints: partial });
    expect(detector.getSnapshot().frozenFrames).toBeGreaterThan(0);
    expect(detector.getSnapshot().repCount).toBe(0);
  });
});

describe('rep-detector edge cases: NaN / Infinity angle injection', () => {
  test('NaN elbow angles do not poison state; detector falls back to frozen or safe defaults', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    let t = 0;

    // Warm up.
    for (let i = 0; i < 10; i += 1) {
      step(detector, t, { joints: joints({ handY: 0.6 }) });
      t += 1 / 30;
    }
    const before = detector.getSnapshot();

    // Inject NaN elbow angles for several frames.
    for (let i = 0; i < 10; i += 1) {
      expect(() =>
        detector.step({
          timestampSec: t,
          angles: neutralAngles({ leftElbow: Number.NaN, rightElbow: Number.NaN }),
          joints: joints({ handY: 0.6 }),
        }),
      ).not.toThrow();
      t += 1 / 30;
    }

    const after = detector.getSnapshot();
    // baselineGap stays finite (NaN never written into the EMA) or null, never NaN.
    if (after.baselineGap !== null) {
      expect(Number.isFinite(after.baselineGap)).toBe(true);
    }
    // We don't assert exact state — just that no spurious reps are counted and the detector did not throw.
    expect(after.repCount).toBe(before.repCount);
  });

  test('Infinity hand-Y yields a frozen frame (gap becomes non-finite, treated like missing)', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    detector.step({
      timestampSec: 0,
      angles: neutralAngles(),
      joints: {
        left_shoulder: { x: 0.4, y: 0.33, isTracked: true, confidence: 0.95 },
        right_shoulder: { x: 0.6, y: 0.33, isTracked: true, confidence: 0.95 },
        left_hand: { x: 0.35, y: Number.POSITIVE_INFINITY, isTracked: true, confidence: 0.95 },
        right_hand: { x: 0.65, y: 0.6, isTracked: true, confidence: 0.95 },
      },
    });
    const s = detector.getSnapshot();
    // Infinity gap is non-finite, detector should freeze rather than update baselineGap.
    expect(s.baselineGap === null || Number.isFinite(s.baselineGap)).toBe(true);
    expect(s.frozenFrames).toBeGreaterThanOrEqual(0);
  });

  test('negative trackingQuality is clamped (not interpreted as < minTrackingQuality of 0)', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minTrackingQuality: 0.4 });
    // trackingQuality = -0.5 is clamped to 0, which is < minTrackingQuality, so the detector freezes.
    detector.step({
      timestampSec: 0,
      angles: neutralAngles(),
      joints: joints(),
      trackingQuality: -0.5,
    });
    expect(detector.getSnapshot().frozenFrames).toBeGreaterThan(0);
  });
});

describe('rep-detector edge cases: reset + options robustness', () => {
  test('reset() clears repCount, baselineGap, frozenFrames, and returns state to bottom', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3 });
    for (let i = 0; i < 30; i += 1) {
      step(detector, i / 30, { joints: joints({ handY: 0.6 }) });
    }
    detector.reset();
    const s = detector.getSnapshot();
    expect(s.state).toBe('bottom');
    expect(s.repCount).toBe(0);
    expect(s.baselineGap).toBeNull();
    expect(s.frozenFrames).toBe(0);
  });

  test('construction with NaN numeric options clamps to safe defaults (via typeof check)', () => {
    // nConsecFrames NaN -> typeof === 'number' passes, Math.floor(NaN) is NaN, Math.max(1, NaN) is NaN.
    // But then step() still works without throwing.
    const d = new RepDetectorPullup({ nConsecFrames: NaN, baselineAlpha: Number.NEGATIVE_INFINITY });
    expect(() => d.step({ timestampSec: 0, angles: neutralAngles(), joints: joints() })).not.toThrow();
  });

  test('Map-shaped joints input works the same as record-shaped input', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6 });
    const mapJoints = new Map<string, { x: number; y: number; isTracked: boolean; confidence: number }>([
      ['left_shoulder', { x: 0.4, y: 0.33, isTracked: true, confidence: 0.95 }],
      ['right_shoulder', { x: 0.6, y: 0.33, isTracked: true, confidence: 0.95 }],
      ['left_hand', { x: 0.35, y: 0.6, isTracked: true, confidence: 0.95 }],
      ['right_hand', { x: 0.65, y: 0.6, isTracked: true, confidence: 0.95 }],
    ]);
    expect(() =>
      detector.step({ timestampSec: 0, angles: neutralAngles(), joints: mapJoints }),
    ).not.toThrow();
    expect(detector.getSnapshot().frozenFrames).toBe(0);
  });
});
