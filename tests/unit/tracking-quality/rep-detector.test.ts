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
});
