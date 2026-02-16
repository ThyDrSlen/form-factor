import type { BodyPose2D, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import {
  ARKIT_PRIMARY_MODEL_VERSION,
  buildArkitCanonicalFrame,
  buildCanonicalJointMapFromPose2D,
} from '@/lib/pose/adapters/arkit-workout-adapter';

const angles: JointAngles = {
  leftKnee: 120,
  rightKnee: 121,
  leftElbow: 90,
  rightElbow: 91,
  leftHip: 140,
  rightHip: 141,
  leftShoulder: 88,
  rightShoulder: 87,
};

const pose2D: BodyPose2D = {
  timestamp: 42,
  isTracking: true,
  joints: [
    { name: 'left_shoulder_1_joint', x: 0.2, y: 0.3, isTracked: true },
    { name: 'right_shoulder_1_joint', x: 0.8, y: 0.3, isTracked: true },
    { name: 'neck_1_joint', x: 0.5, y: 0.2, isTracked: true },
    { name: 'left_upLeg_joint', x: 0.35, y: 0.6, isTracked: true },
    { name: 'left_leg_joint', x: 0.34, y: 0.78, isTracked: true },
  ],
};

test('buildCanonicalJointMapFromPose2D creates alias keys expected by workouts', () => {
  const map = buildCanonicalJointMapFromPose2D(pose2D);

  expect(map.get('left_shoulder_1_joint')?.x).toBeCloseTo(0.2, 6);
  expect(map.get('left_shoulder')?.x).toBeCloseTo(0.2, 6);
  expect(map.get('neck')?.y).toBeCloseTo(0.2, 6);
  expect(map.get('left_upleg')?.y).toBeCloseTo(0.6, 6);
});

test('buildArkitCanonicalFrame returns canonical frame metadata', () => {
  const frame = buildArkitCanonicalFrame({
    angles,
    pose2D,
    timestamp: pose2D.timestamp,
  });

  expect(frame.provider).toBe('arkit');
  expect(frame.modelVersion).toBe(ARKIT_PRIMARY_MODEL_VERSION);
  expect(frame.angles).toEqual(angles);
  expect(frame.joints.get('left_leg')).toBeDefined();
});

test('neck alias resolution should normalize left/right neck turn drift (RED)', () => {
  const poseNeckFirst: BodyPose2D = {
    timestamp: 100,
    isTracking: true,
    joints: [
      { name: 'neck_1_joint', x: 0.45, y: 0.2, isTracked: true },
      { name: 'neck_4_joint', x: 0.62, y: 0.2, isTracked: true },
    ],
  };

  const poseNeckLast: BodyPose2D = {
    timestamp: 101,
    isTracking: true,
    joints: [
      { name: 'neck_4_joint', x: 0.62, y: 0.2, isTracked: true },
      { name: 'neck_1_joint', x: 0.45, y: 0.2, isTracked: true },
    ],
  };

  const neckFromFirstOrder = buildCanonicalJointMapFromPose2D(poseNeckFirst).get('neck');
  const neckFromSecondOrder = buildCanonicalJointMapFromPose2D(poseNeckLast).get('neck');

  expect(neckFromFirstOrder?.x).toBeCloseTo((0.45 + 0.62) / 2, 6);
  expect(neckFromSecondOrder?.x).toBeCloseTo((0.45 + 0.62) / 2, 6);
});
