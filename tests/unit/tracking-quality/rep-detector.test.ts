import fs from 'node:fs';
import path from 'node:path';

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { PullupFixtureFrame } from '@/lib/debug/pullup-fixture-corpus';
import { RepDetectorPullup } from '@/lib/tracking-quality/rep-detector';

type TraceResult = {
  repCount: number;
  state: string;
  frozenFrames: number;
};

function loadFixture(name: string): PullupFixtureFrame[] {
  const filePath = path.join(process.cwd(), 'tests', 'fixtures', 'pullup-tracking', `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PullupFixtureFrame[];
}

function runDetector(frames: PullupFixtureFrame[], options?: ConstructorParameters<typeof RepDetectorPullup>[0]): TraceResult {
  const detector = new RepDetectorPullup(options);
  for (const frame of frames) {
    detector.step({
      timestampSec: frame.timestampSec,
      angles: frame.angles as JointAngles,
      joints: frame.joints,
    });
  }

  const snapshot = detector.getSnapshot();
  return {
    repCount: snapshot.repCount,
    state: snapshot.state,
    frozenFrames: snapshot.frozenFrames,
  };
}

describe('tracking-quality rep detector (pull-up FSM)', () => {
  test('cycles bottom -> ascending -> top -> descending -> bottom and increments rep once', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3 });

    const bottom = (t: number, elbowDeg: number, wristY: number) =>
      detector.step({
        timestampSec: t,
        angles: {
          leftKnee: 120,
          rightKnee: 120,
          leftElbow: elbowDeg,
          rightElbow: elbowDeg,
          leftHip: 140,
          rightHip: 140,
          leftShoulder: 92,
          rightShoulder: 92,
        },
        joints: {
          left_shoulder: { x: 0.4, y: 0.33, isTracked: true, confidence: 0.95 },
          right_shoulder: { x: 0.6, y: 0.33, isTracked: true, confidence: 0.95 },
          left_hand: { x: 0.35, y: wristY, isTracked: true, confidence: 0.95 },
          right_hand: { x: 0.65, y: wristY, isTracked: true, confidence: 0.95 },
        },
      });

    let t = 0;

    for (let i = 0; i < 8; i++) {
      bottom(t, 160, 0.61);
      t += 1 / 30;
    }
    expect(detector.getSnapshot().state).toBe('bottom');
    expect(detector.getSnapshot().repCount).toBe(0);

    for (let i = 0; i < 12; i++) {
      bottom(t, 138, 0.61 - (i + 1) * 0.01);
      t += 1 / 30;
    }
    expect(detector.getSnapshot().state).toBe('ascending');

    for (let i = 0; i < 10; i++) {
      bottom(t, 82, 0.44);
      t += 1 / 30;
    }
    expect(detector.getSnapshot().state).toBe('top');

    for (let i = 0; i < 10; i++) {
      bottom(t, 110, 0.44 + (i + 1) * 0.012);
      t += 1 / 30;
    }
    expect(detector.getSnapshot().state).toBe('descending');

    for (let i = 0; i < 12; i++) {
      bottom(t, 158, 0.61);
      t += 1 / 30;
    }
    const snapshot = detector.getSnapshot();
    expect(snapshot.state).toBe('bottom');
    expect(snapshot.repCount).toBe(1);
  });

  test('bounce fixture counts once (no double-count on bounce transitions)', () => {
    const frames = loadFixture('bounce-noise');
    const result = runDetector(frames, { nConsecFrames: 3 });
    expect(result.repCount).toBe(1);
  });

  test('confidence drop freezes FSM (no transitions during low-confidence windows)', () => {
    const detector = new RepDetectorPullup({ nConsecFrames: 3, minJointConfidence: 0.6, maxFrozenFrames: 45 });

    const step = (t: number, elbowDeg: number, wristY: number, tracked: boolean, conf: number) =>
      detector.step({
        timestampSec: t,
        angles: {
          leftKnee: 120,
          rightKnee: 120,
          leftElbow: elbowDeg,
          rightElbow: elbowDeg,
          leftHip: 140,
          rightHip: 140,
          leftShoulder: 92,
          rightShoulder: 92,
        },
        joints: {
          left_shoulder: { x: 0.4, y: 0.33, isTracked: tracked, confidence: conf },
          right_shoulder: { x: 0.6, y: 0.33, isTracked: tracked, confidence: conf },
          left_hand: { x: 0.35, y: wristY, isTracked: tracked, confidence: conf },
          right_hand: { x: 0.65, y: wristY, isTracked: tracked, confidence: conf },
        },
      });

    let t = 0;
    for (let i = 0; i < 10; i++) {
      step(t, 160, 0.61, true, 0.95);
      t += 1 / 30;
    }
    expect(detector.getSnapshot().state).toBe('bottom');

    for (let i = 0; i < 4; i++) {
      step(t, 90, 0.46, true, 0.95);
      t += 1 / 30;
    }
    const beforeFreeze = detector.getSnapshot();

    for (let i = 0; i < 8; i++) {
      step(t, 80, 0.44, false, 0.2);
      t += 1 / 30;
    }
    const duringFreeze = detector.getSnapshot();
    expect(duringFreeze.state).toBe(beforeFreeze.state);
    expect(duringFreeze.repCount).toBe(beforeFreeze.repCount);
    expect(duringFreeze.frozenFrames).toBeGreaterThan(0);

    for (let i = 0; i < 10; i++) {
      step(t, 80, 0.44, true, 0.95);
      t += 1 / 30;
    }
    expect(detector.getSnapshot().state).toBe('top');
  });

  test('back-turned trace still counts when head/neck visibility is missing', () => {
    const frames = loadFixture('back-turned').map((frame) => {
      if (!frame.joints) return frame;
      return {
        ...frame,
        joints: {
          ...frame.joints,
          head: { ...(frame.joints.head ?? { x: 0.5, y: 0.22, isTracked: false }), isTracked: false, confidence: 0.05 },
          neck: { ...(frame.joints.neck ?? { x: 0.5, y: 0.29, isTracked: false }), isTracked: false, confidence: 0.05 },
        },
      };
    });

    const expected = frames[0]?.expected?.repCount ?? 0;
    const result = runDetector(frames, { nConsecFrames: 3, minJointConfidence: 0.6 });
    expect(Math.abs(result.repCount - expected)).toBeLessThanOrEqual(1);
  });

  test('all 5 fixtures are within +/-1 rep of expected', () => {
    const fixtures = ['camera-facing', 'back-turned', 'occlusion-brief', 'occlusion-long', 'bounce-noise'] as const;
    for (const name of fixtures) {
      const frames = loadFixture(name);
      const expected = frames[0]?.expected?.repCount ?? 0;
      const result = runDetector(frames, { nConsecFrames: 3, minJointConfidence: 0.6 });
      expect(Math.abs(result.repCount - expected)).toBeLessThanOrEqual(1);
    }
  });

  // ==========================================================================
  // Wave-29 T7: threshold boundary semantics for minTrackingQuality and
  // minJointConfidence.
  //
  // Locks in two inclusive-lower-bound contracts:
  //   1. lib/tracking-quality/rep-detector.ts:229
  //        `quality >= this.options.minTrackingQuality`
  //      → quality EXACTLY at threshold accepts the frame (no fault).
  //      → quality at threshold - 0.001 rejects with 'quality_below_min'.
  //   2. lib/tracking-quality/visibility.ts:40-42 (via L237 areRequiredJointsVisible)
  //        `clamp01(joint.confidence) >= minConfidence`
  //      → joint confidence EXACTLY at threshold passes visibility.
  //      → joint confidence at threshold - 0.001 rejects with 'low_visibility'.
  //
  // These guard against any future refactor to a strict `>` comparison —
  // which would silently shift millions of frames from "accepted" to
  // "rejected" on devices that clip to the threshold value exactly.
  // ==========================================================================
  describe('threshold boundaries (wave-29 T7)', () => {
    function baseAngles() {
      return {
        leftKnee: 120,
        rightKnee: 120,
        leftElbow: 160,
        rightElbow: 160,
        leftHip: 140,
        rightHip: 140,
        leftShoulder: 92,
        rightShoulder: 92,
      };
    }

    function jointsWithConfidence(conf: number, tracked = true) {
      return {
        left_shoulder: { x: 0.4, y: 0.33, isTracked: tracked, confidence: conf },
        right_shoulder: { x: 0.6, y: 0.33, isTracked: tracked, confidence: conf },
        left_hand: { x: 0.35, y: 0.61, isTracked: tracked, confidence: conf },
        right_hand: { x: 0.65, y: 0.61, isTracked: tracked, confidence: conf },
      };
    }

    test('trackingQuality EXACTLY at minTrackingQuality is accepted (no fault emitted)', () => {
      const onFault = jest.fn();
      const detector = new RepDetectorPullup({
        minTrackingQuality: 0.5,
        minJointConfidence: 0.6,
        onFault,
      });

      detector.step({
        timestampSec: 0,
        angles: baseAngles() as JointAngles,
        joints: jointsWithConfidence(0.95),
        trackingQuality: 0.5, // exactly at threshold
      });

      // No fault for quality — we accepted the frame. Snapshot frozenFrames
      // stays at 0 because freezeOrTimeout was NOT called.
      expect(onFault).not.toHaveBeenCalled();
      expect(detector.getSnapshot().frozenFrames).toBe(0);
    });

    test('trackingQuality at minTrackingQuality - 0.001 is rejected with quality_below_min', () => {
      const onFault = jest.fn();
      const detector = new RepDetectorPullup({
        minTrackingQuality: 0.5,
        minJointConfidence: 0.6,
        onFault,
      });

      detector.step({
        timestampSec: 0,
        angles: baseAngles() as JointAngles,
        joints: jointsWithConfidence(0.95),
        trackingQuality: 0.499, // just below threshold
      });

      expect(onFault).toHaveBeenCalledTimes(1);
      expect(onFault.mock.calls[0]?.[0]).toMatchObject({
        fault_id: 'rep_rejected',
        rejection_reason: 'quality_below_min',
        exercise_id: 'pullup',
      });
      // freezeOrTimeout was invoked → frozenFrames should tick up by one.
      expect(detector.getSnapshot().frozenFrames).toBe(1);
    });

    test('joint confidence EXACTLY at minJointConfidence passes visibility', () => {
      const onFault = jest.fn();
      const detector = new RepDetectorPullup({
        minJointConfidence: 0.6,
        onFault,
      });

      detector.step({
        timestampSec: 0,
        angles: baseAngles() as JointAngles,
        joints: jointsWithConfidence(0.6), // exactly at threshold
      });

      // visibility.ts:40-42 uses `>=` so 0.6 == 0.6 passes. No fault.
      expect(onFault).not.toHaveBeenCalled();
      expect(detector.getSnapshot().frozenFrames).toBe(0);
    });

    test('joint confidence at minJointConfidence - 0.001 rejects with low_visibility', () => {
      const onFault = jest.fn();
      const detector = new RepDetectorPullup({
        minJointConfidence: 0.6,
        onFault,
      });

      detector.step({
        timestampSec: 0,
        angles: baseAngles() as JointAngles,
        joints: jointsWithConfidence(0.599), // just below threshold
      });

      expect(onFault).toHaveBeenCalledTimes(1);
      expect(onFault.mock.calls[0]?.[0]).toMatchObject({
        fault_id: 'rep_rejected',
        rejection_reason: 'low_visibility',
        visibility_badge: 'partial',
      });
      expect(detector.getSnapshot().frozenFrames).toBe(1);
    });
  });
});
