import type { BodyPose2D, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { CanonicalJoint2D, CanonicalJointMap, CanonicalPoseFrame } from '@/lib/pose/types';

export const ARKIT_PRIMARY_MODEL_VERSION = 'arkit-angles@1.1.0';

const RAW_ALIAS_MAP: Record<string, string[]> = {
  root: ['root'],
  hips_joint: ['hips_joint', 'hips'],
  head_joint: ['head_joint', 'head'],

  neck_1_joint: ['neck_1_joint', 'neck'],
  neck_2_joint: ['neck_2_joint', 'neck'],
  neck_3_joint: ['neck_3_joint', 'neck'],
  neck_4_joint: ['neck_4_joint', 'neck'],

  spine_1_joint: ['spine_1_joint', 'spine'],
  spine_2_joint: ['spine_2_joint', 'spine'],
  spine_3_joint: ['spine_3_joint', 'spine'],
  spine_4_joint: ['spine_4_joint', 'spine'],
  spine_5_joint: ['spine_5_joint', 'spine'],
  spine_6_joint: ['spine_6_joint', 'spine'],
  spine_7_joint: ['spine_7_joint', 'spine'],

  left_shoulder_1_joint: ['left_shoulder_1_joint', 'left_shoulder'],
  left_arm_joint: ['left_arm_joint', 'left_arm'],
  left_forearm_joint: ['left_forearm_joint', 'left_forearm', 'left_elbow'],
  left_hand_joint: ['left_hand_joint', 'left_hand', 'left_wrist'],

  right_shoulder_1_joint: ['right_shoulder_1_joint', 'right_shoulder'],
  right_arm_joint: ['right_arm_joint', 'right_arm'],
  right_forearm_joint: ['right_forearm_joint', 'right_forearm', 'right_elbow'],
  right_hand_joint: ['right_hand_joint', 'right_hand', 'right_wrist'],

  left_upLeg_joint: ['left_upLeg_joint', 'left_upLeg', 'left_hip'],
  left_leg_joint: ['left_leg_joint', 'left_leg', 'left_knee'],
  left_foot_joint: ['left_foot_joint', 'left_foot', 'left_ankle'],

  right_upLeg_joint: ['right_upLeg_joint', 'right_upLeg', 'right_hip'],
  right_leg_joint: ['right_leg_joint', 'right_leg', 'right_knee'],
  right_foot_joint: ['right_foot_joint', 'right_foot', 'right_ankle'],
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function setAlias(map: CanonicalJointMap, key: string, value: CanonicalJoint2D): void {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, value);
    return;
  }

  if (!existing.isTracked && value.isTracked) {
    map.set(key, value);
  }
}

function aliasesForRawName(rawName: string): string[] {
  const normalized = normalizeName(rawName);
  const explicit = RAW_ALIAS_MAP[normalized] ?? [];
  const stripped = normalized.endsWith('_joint') ? normalized.replace(/_joint$/, '') : normalized;

  return Array.from(new Set([normalized, stripped, ...explicit].map(normalizeName)));
}

export function buildCanonicalJointMapFromPose2D(pose2D: BodyPose2D | null): CanonicalJointMap {
  const map: CanonicalJointMap = new Map();

  if (!pose2D?.joints?.length) {
    return map;
  }

  for (const joint of pose2D.joints) {
    const point: CanonicalJoint2D = {
      x: joint.x,
      y: joint.y,
      isTracked: joint.isTracked,
    };

    for (const alias of aliasesForRawName(joint.name)) {
      setAlias(map, alias, point);
    }
  }

  return map;
}

export function buildArkitCanonicalFrame(input: {
  angles: JointAngles;
  pose2D: BodyPose2D | null;
  timestamp: number;
}): CanonicalPoseFrame {
  return {
    provider: 'arkit',
    modelVersion: ARKIT_PRIMARY_MODEL_VERSION,
    timestamp: input.timestamp,
    angles: input.angles,
    joints: buildCanonicalJointMapFromPose2D(input.pose2D),
  };
}
