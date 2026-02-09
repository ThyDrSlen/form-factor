import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { buildMediaPipeShadowFrameFromArkit2D } from '@/lib/pose/adapters/mediapipe-shadow-proxy';
import type { CanonicalJointMap } from '@/lib/pose/types';

const primaryAngles: JointAngles = {
  leftKnee: 120,
  rightKnee: 120,
  leftElbow: 100,
  rightElbow: 100,
  leftHip: 140,
  rightHip: 140,
  leftShoulder: 90,
  rightShoulder: 90,
};

function tracked(x: number, y: number) {
  return { x, y, isTracked: true };
}

test('buildMediaPipeShadowFrameFromArkit2D computes angles from canonical 2D joints', () => {
  const joints: CanonicalJointMap = new Map([
    ['neck', tracked(0.5, 0.2)],
    ['spine', tracked(0.5, 0.35)],
    ['left_shoulder', tracked(0.42, 0.3)],
    ['right_shoulder', tracked(0.58, 0.3)],
    ['left_forearm', tracked(0.35, 0.42)],
    ['right_forearm', tracked(0.65, 0.42)],
    ['left_hand', tracked(0.3, 0.55)],
    ['right_hand', tracked(0.7, 0.55)],
    ['left_upleg', tracked(0.46, 0.52)],
    ['right_upleg', tracked(0.54, 0.52)],
    ['left_leg', tracked(0.44, 0.7)],
    ['right_leg', tracked(0.56, 0.7)],
    ['left_foot', tracked(0.42, 0.9)],
    ['right_foot', tracked(0.58, 0.9)],
  ]);

  const frame = buildMediaPipeShadowFrameFromArkit2D({
    primaryAngles,
    arkitJointMap: joints,
    timestamp: 123,
  });

  expect(frame.provider).toBe('mediapipe_proxy');
  expect(frame.timestamp).toBe(123);
  expect(frame.comparedJoints).toBe(8);
  expect(frame.coverageRatio).toBeCloseTo(1, 6);
  expect(Number.isFinite(frame.angles.leftKnee)).toBe(true);
  expect(Number.isFinite(frame.angles.rightElbow)).toBe(true);
});

test('buildMediaPipeShadowFrameFromArkit2D falls back to primary angles when joints are missing', () => {
  const frame = buildMediaPipeShadowFrameFromArkit2D({
    primaryAngles,
    arkitJointMap: new Map(),
    timestamp: 321,
  });

  expect(frame.comparedJoints).toBe(0);
  expect(frame.coverageRatio).toBe(0);
  expect(frame.angles).toEqual(primaryAngles);
});
