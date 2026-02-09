import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { CanonicalJoint2D, CanonicalJointMap, JointAngleKey } from '@/lib/pose/types';
import type { PoseProvider } from '@/lib/pose/types';

type ShadowPoseProvider = Exclude<PoseProvider, 'arkit'>;

export const MEDIAPIPE_SHADOW_PROXY_VERSION = 'mediapipe-shadow-proxy@0.1.0';

const JOINT_KEYS: JointAngleKey[] = [
  'leftKnee',
  'rightKnee',
  'leftElbow',
  'rightElbow',
  'leftHip',
  'rightHip',
  'leftShoulder',
  'rightShoulder',
];

export interface MediaPipeShadowFrame {
  provider: ShadowPoseProvider;
  modelVersion: string;
  timestamp: number;
  inferenceMs: number;
  comparedJoints: number;
  coverageRatio: number;
  angles: JointAngles;
}

function getJoint(map: CanonicalJointMap, aliases: string[]): CanonicalJoint2D | null {
  for (const alias of aliases) {
    const joint = map.get(alias.toLowerCase());
    if (joint?.isTracked) {
      return joint;
    }
  }

  for (const alias of aliases) {
    const joint = map.get(alias.toLowerCase());
    if (joint) {
      return joint;
    }
  }

  return null;
}

function midpoint(a: CanonicalJoint2D | null, b: CanonicalJoint2D | null): CanonicalJoint2D | null {
  if (!a && !b) {
    return null;
  }
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    isTracked: a.isTracked || b.isTracked,
  };
}

function angle2D(a: CanonicalJoint2D | null, b: CanonicalJoint2D | null, c: CanonicalJoint2D | null): number | null {
  if (!a || !b || !c) {
    return null;
  }

  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;

  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (mag1 === 0 || mag2 === 0) {
    return null;
  }

  const dot = (v1x * v2x + v1y * v2y) / (mag1 * mag2);
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

function pickAngle(primary: number, candidate: number | null): { value: number; computed: boolean } {
  if (candidate === null || !Number.isFinite(candidate)) {
    return { value: primary, computed: false };
  }
  return { value: candidate, computed: true };
}

export function buildMediaPipeShadowFrameFromArkit2D(input: {
  provider?: ShadowPoseProvider;
  modelVersion?: string;
  primaryAngles: JointAngles;
  arkitJointMap: CanonicalJointMap;
  timestamp: number;
  inferenceMs?: number;
}): MediaPipeShadowFrame {
  const { primaryAngles, arkitJointMap } = input;

  const neck = getJoint(arkitJointMap, ['neck', 'neck_1_joint', 'neck_2_joint']);
  const leftShoulder = getJoint(arkitJointMap, ['left_shoulder', 'left_shoulder_1_joint']);
  const rightShoulder = getJoint(arkitJointMap, ['right_shoulder', 'right_shoulder_1_joint']);
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);

  const spine = getJoint(arkitJointMap, ['spine', 'spine_4_joint', 'spine_3_joint']);
  const trunkAnchor = spine ?? shoulderCenter;

  const leftHip = getJoint(arkitJointMap, ['left_upleg', 'left_upLeg', 'left_upleg_joint', 'left_upleg_joint']);
  const rightHip = getJoint(arkitJointMap, ['right_upleg', 'right_upLeg', 'right_upleg_joint', 'right_upleg_joint']);
  const leftKnee = getJoint(arkitJointMap, ['left_leg', 'left_knee', 'left_leg_joint']);
  const rightKnee = getJoint(arkitJointMap, ['right_leg', 'right_knee', 'right_leg_joint']);
  const leftAnkle = getJoint(arkitJointMap, ['left_foot', 'left_ankle', 'left_foot_joint']);
  const rightAnkle = getJoint(arkitJointMap, ['right_foot', 'right_ankle', 'right_foot_joint']);

  const leftElbow = getJoint(arkitJointMap, ['left_forearm', 'left_elbow', 'left_forearm_joint']);
  const rightElbow = getJoint(arkitJointMap, ['right_forearm', 'right_elbow', 'right_forearm_joint']);
  const leftWrist = getJoint(arkitJointMap, ['left_hand', 'left_wrist', 'left_hand_joint']);
  const rightWrist = getJoint(arkitJointMap, ['right_hand', 'right_wrist', 'right_hand_joint']);

  const leftKneeAngle = pickAngle(primaryAngles.leftKnee, angle2D(leftHip, leftKnee, leftAnkle));
  const rightKneeAngle = pickAngle(primaryAngles.rightKnee, angle2D(rightHip, rightKnee, rightAnkle));
  const leftElbowAngle = pickAngle(primaryAngles.leftElbow, angle2D(leftShoulder, leftElbow, leftWrist));
  const rightElbowAngle = pickAngle(primaryAngles.rightElbow, angle2D(rightShoulder, rightElbow, rightWrist));

  const leftHipAngle = pickAngle(primaryAngles.leftHip, angle2D(trunkAnchor, leftHip, leftKnee));
  const rightHipAngle = pickAngle(primaryAngles.rightHip, angle2D(trunkAnchor, rightHip, rightKnee));
  const leftShoulderAngle = pickAngle(primaryAngles.leftShoulder, angle2D(neck ?? shoulderCenter, leftShoulder, leftElbow));
  const rightShoulderAngle = pickAngle(primaryAngles.rightShoulder, angle2D(neck ?? shoulderCenter, rightShoulder, rightElbow));

  const computedCount = [
    leftKneeAngle,
    rightKneeAngle,
    leftElbowAngle,
    rightElbowAngle,
    leftHipAngle,
    rightHipAngle,
    leftShoulderAngle,
    rightShoulderAngle,
  ].filter((entry) => entry.computed).length;

  return {
    provider: input.provider ?? 'mediapipe_proxy',
    modelVersion: input.modelVersion ?? MEDIAPIPE_SHADOW_PROXY_VERSION,
    timestamp: input.timestamp,
    inferenceMs: input.inferenceMs ?? 0,
    comparedJoints: computedCount,
    coverageRatio: computedCount / JOINT_KEYS.length,
    angles: {
      leftKnee: leftKneeAngle.value,
      rightKnee: rightKneeAngle.value,
      leftElbow: leftElbowAngle.value,
      rightElbow: rightElbowAngle.value,
      leftHip: leftHipAngle.value,
      rightHip: rightHipAngle.value,
      leftShoulder: leftShoulderAngle.value,
      rightShoulder: rightShoulderAngle.value,
    },
  };
}
