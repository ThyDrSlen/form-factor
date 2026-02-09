import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import { buildMediaPipeShadowFrameFromArkit2D, type MediaPipeShadowFrame } from '@/lib/pose/adapters/mediapipe-shadow-proxy';
import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';

export const MEDIAPIPE_POSE_LANDMARKER_VERSION = 'mediapipe-pose-landmarker@0.1.0';

export interface MediaPipeLandmark2D {
  x: number;
  y: number;
  visibility?: number;
  presence?: number;
}

const MP_INDEX = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

function setAlias(map: CanonicalJointMap, key: string, value: CanonicalJoint2D): void {
  const existing = map.get(key);
  if (!existing || (!existing.isTracked && value.isTracked)) {
    map.set(key, value);
  }
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
    confidence: Math.max(a.confidence ?? 0, b.confidence ?? 0),
  };
}

function buildJoint(landmark: MediaPipeLandmark2D | undefined, threshold: number): CanonicalJoint2D | null {
  if (!landmark) {
    return null;
  }

  const confidence = typeof landmark.visibility === 'number' ? landmark.visibility : landmark.presence;
  const isTracked = typeof confidence === 'number' ? confidence >= threshold : true;

  return {
    x: landmark.x,
    y: landmark.y,
    isTracked,
    confidence,
  };
}

export function buildCanonicalJointMapFromMediaPipeLandmarks(input: {
  landmarks: MediaPipeLandmark2D[];
  visibilityThreshold?: number;
}): CanonicalJointMap {
  const map: CanonicalJointMap = new Map();
  const threshold = input.visibilityThreshold ?? 0.5;
  const get = (idx: number) => buildJoint(input.landmarks[idx], threshold);

  const leftShoulder = get(MP_INDEX.LEFT_SHOULDER);
  const rightShoulder = get(MP_INDEX.RIGHT_SHOULDER);
  const leftElbow = get(MP_INDEX.LEFT_ELBOW);
  const rightElbow = get(MP_INDEX.RIGHT_ELBOW);
  const leftWrist = get(MP_INDEX.LEFT_WRIST);
  const rightWrist = get(MP_INDEX.RIGHT_WRIST);
  const leftHip = get(MP_INDEX.LEFT_HIP);
  const rightHip = get(MP_INDEX.RIGHT_HIP);
  const leftKnee = get(MP_INDEX.LEFT_KNEE);
  const rightKnee = get(MP_INDEX.RIGHT_KNEE);
  const leftAnkle = get(MP_INDEX.LEFT_ANKLE);
  const rightAnkle = get(MP_INDEX.RIGHT_ANKLE);
  const nose = get(MP_INDEX.NOSE);

  const assign = (aliases: string[], joint: CanonicalJoint2D | null) => {
    if (!joint || !joint.isTracked) {
      return;
    }
    for (const alias of aliases) {
      setAlias(map, alias, joint);
    }
  };

  assign(['left_shoulder', 'left_shoulder_1_joint'], leftShoulder);
  assign(['right_shoulder', 'right_shoulder_1_joint'], rightShoulder);
  assign(['left_forearm', 'left_elbow', 'left_forearm_joint'], leftElbow);
  assign(['right_forearm', 'right_elbow', 'right_forearm_joint'], rightElbow);
  assign(['left_hand', 'left_wrist', 'left_hand_joint'], leftWrist);
  assign(['right_hand', 'right_wrist', 'right_hand_joint'], rightWrist);
  assign(['left_upleg', 'left_upLeg', 'left_upLeg_joint', 'left_hip'], leftHip);
  assign(['right_upleg', 'right_upLeg', 'right_upLeg_joint', 'right_hip'], rightHip);
  assign(['left_leg', 'left_knee', 'left_leg_joint'], leftKnee);
  assign(['right_leg', 'right_knee', 'right_leg_joint'], rightKnee);
  assign(['left_foot', 'left_ankle', 'left_foot_joint'], leftAnkle);
  assign(['right_foot', 'right_ankle', 'right_foot_joint'], rightAnkle);

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const neck = midpoint(nose, shoulderCenter) ?? shoulderCenter;
  const spine = midpoint(shoulderCenter, hipCenter) ?? hipCenter;

  assign(['neck', 'neck_1_joint', 'neck_2_joint'], neck);
  assign(['spine', 'spine_4_joint', 'spine_3_joint'], spine);

  return map;
}

export function buildMediaPipeShadowFrameFromLandmarks(input: {
  primaryAngles: JointAngles;
  landmarks: MediaPipeLandmark2D[];
  timestamp: number;
  inferenceMs?: number;
  visibilityThreshold?: number;
  modelVersion?: string;
}): MediaPipeShadowFrame {
  const joints = buildCanonicalJointMapFromMediaPipeLandmarks({
    landmarks: input.landmarks,
    visibilityThreshold: input.visibilityThreshold,
  });

  return buildMediaPipeShadowFrameFromArkit2D({
    provider: 'mediapipe',
    modelVersion: input.modelVersion ?? MEDIAPIPE_POSE_LANDMARKER_VERSION,
    primaryAngles: input.primaryAngles,
    arkitJointMap: joints,
    timestamp: input.timestamp,
    inferenceMs: input.inferenceMs,
  });
}
