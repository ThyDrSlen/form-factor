/**
 * ARKit frame builder for tests.
 *
 * Produces realistic ARKit body-tracking frames (raw `BodyPose2D`, canonical
 * joint map, or per-detector joint maps) with controllable:
 *   - per-joint confidence (scalar or per-joint map)
 *   - occlusion (hide specific joints or whole regions)
 *   - isTracked flicker
 *
 * Used by rep-detector, workout, and adapter tests so that we do not hand-roll
 * a different "always 0.95 / always tracked" mock in every file.
 */

import type { BodyPose2D, Joint2D, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';
import type { RepDetectorPullupJoints } from '@/lib/tracking-quality/rep-detector';

/**
 * Canonical ARKit 2D joint names we emit by default. Superset of what any
 * workout currently reads.
 */
export const ARKIT_DEFAULT_JOINT_NAMES = [
  'head_joint',
  'neck_1_joint',
  'left_shoulder_1_joint',
  'right_shoulder_1_joint',
  'left_forearm_joint',
  'right_forearm_joint',
  'left_hand_joint',
  'right_hand_joint',
  'left_upLeg_joint',
  'right_upLeg_joint',
  'left_leg_joint',
  'right_leg_joint',
  'left_foot_joint',
  'right_foot_joint',
] as const;

export type ArkitJointName = (typeof ARKIT_DEFAULT_JOINT_NAMES)[number];

export type JointOverride = {
  x?: number;
  y?: number;
  isTracked?: boolean;
  confidence?: number;
};

export interface BuildRealisticArkitFrameInput {
  /** Frame timestamp (ms for BodyPose2D, sec-based for canonical callers as needed). */
  timestamp?: number;
  /** Global confidence for all joints unless overridden per joint (0..1). */
  confidence?: number;
  /** If true, sets `isTracked=false` for all joints whose confidence falls below `minConfidence`. */
  occluded?: boolean;
  /** Minimum confidence below which joints are treated as occluded when `occluded=true`. */
  minConfidence?: number;
  /** Override any joint's values individually by name (raw ARKit name). */
  joints?: Partial<Record<ArkitJointName | string, JointOverride>>;
  /** Whether the overall pose is tracking. Default true. */
  isTracking?: boolean;
  /** Exclude joints entirely (e.g. simulate "no hand" by name). */
  excludeJoints?: Array<ArkitJointName | string>;
}

/**
 * Default canonical anatomical layout for an upright person (mirror=false),
 * normalized to 0..1 image coordinates (y grows downward).
 */
const DEFAULT_LAYOUT: Record<ArkitJointName, { x: number; y: number }> = {
  head_joint: { x: 0.5, y: 0.18 },
  neck_1_joint: { x: 0.5, y: 0.24 },
  left_shoulder_1_joint: { x: 0.4, y: 0.3 },
  right_shoulder_1_joint: { x: 0.6, y: 0.3 },
  left_forearm_joint: { x: 0.36, y: 0.42 },
  right_forearm_joint: { x: 0.64, y: 0.42 },
  left_hand_joint: { x: 0.34, y: 0.55 },
  right_hand_joint: { x: 0.66, y: 0.55 },
  left_upLeg_joint: { x: 0.44, y: 0.6 },
  right_upLeg_joint: { x: 0.56, y: 0.6 },
  left_leg_joint: { x: 0.44, y: 0.78 },
  right_leg_joint: { x: 0.56, y: 0.78 },
  left_foot_joint: { x: 0.44, y: 0.95 },
  right_foot_joint: { x: 0.56, y: 0.95 },
};

/**
 * Build a realistic ARKit body pose frame.
 *
 * The confidence model:
 *   - default global confidence `0.92`
 *   - per-joint override always wins
 *   - if `occluded=true`, any joint below `minConfidence` (default 0.5)
 *     gets `isTracked=false`
 */
export function buildRealisticArkitFrame(input: BuildRealisticArkitFrameInput = {}): BodyPose2D {
  const {
    timestamp = 0,
    confidence: globalConfidence = 0.92,
    occluded = false,
    minConfidence = 0.5,
    joints = {},
    isTracking = true,
    excludeJoints = [],
  } = input;

  const excludeSet = new Set(excludeJoints);

  const emitted: Joint2D[] = [];
  for (const name of ARKIT_DEFAULT_JOINT_NAMES) {
    if (excludeSet.has(name)) continue;
    const baseLayout = DEFAULT_LAYOUT[name];
    const override = joints[name] ?? {};
    const conf = override.confidence ?? globalConfidence;
    const trackedByDefault = override.isTracked ?? (occluded ? conf >= minConfidence : true);
    const joint: Joint2D = {
      name,
      x: override.x ?? baseLayout.x,
      y: override.y ?? baseLayout.y,
      isTracked: trackedByDefault,
    };
    // Also stash confidence on the joint so adapters that pass it through keep it.
    (joint as Joint2D & { confidence?: number }).confidence = conf;
    emitted.push(joint);
  }

  // Include any extra joints that are not in the default set (named user overrides).
  for (const [name, override] of Object.entries(joints)) {
    if (ARKIT_DEFAULT_JOINT_NAMES.includes(name as ArkitJointName)) continue;
    if (excludeSet.has(name)) continue;
    const conf = override?.confidence ?? globalConfidence;
    const tracked = override?.isTracked ?? (occluded ? conf >= minConfidence : true);
    const joint: Joint2D = {
      name,
      x: override?.x ?? 0.5,
      y: override?.y ?? 0.5,
      isTracked: tracked,
    };
    (joint as Joint2D & { confidence?: number }).confidence = conf;
    emitted.push(joint);
  }

  return {
    timestamp,
    isTracking,
    joints: emitted,
  };
}

/**
 * Build a canonical joint map (flat string->joint) directly, bypassing the
 * adapter. Useful for workouts that read `Map<string, { x, y, isTracked }>`.
 * Supports common aliases:
 *   left_shoulder / right_shoulder
 *   left_elbow / right_elbow (mapped from forearm)
 *   left_hand / right_hand (mapped from hand_joint)
 *   left_upLeg, left_hip (mapped to left_upLeg_joint)
 *   left_leg / left_knee (mapped from leg_joint)
 *   left_foot / left_ankle (mapped from foot_joint)
 *   head / neck
 */
export function buildCanonicalJointMap(
  input: BuildRealisticArkitFrameInput = {}
): CanonicalJointMap {
  const frame = buildRealisticArkitFrame(input);
  const map: CanonicalJointMap = new Map();

  const alias = (key: string, joint: CanonicalJoint2D): void => {
    const existing = map.get(key);
    if (!existing || (!existing.isTracked && joint.isTracked)) {
      map.set(key, joint);
    }
  };

  for (const j of frame.joints) {
    const canonical: CanonicalJoint2D = {
      x: j.x,
      y: j.y,
      isTracked: j.isTracked,
      confidence: (j as Joint2D & { confidence?: number }).confidence,
    };

    alias(j.name, canonical);

    switch (j.name) {
      case 'head_joint':
        alias('head', canonical);
        break;
      case 'neck_1_joint':
        alias('neck', canonical);
        break;
      case 'left_shoulder_1_joint':
        alias('left_shoulder', canonical);
        break;
      case 'right_shoulder_1_joint':
        alias('right_shoulder', canonical);
        break;
      case 'left_forearm_joint':
        alias('left_forearm', canonical);
        alias('left_elbow', canonical);
        break;
      case 'right_forearm_joint':
        alias('right_forearm', canonical);
        alias('right_elbow', canonical);
        break;
      case 'left_hand_joint':
        alias('left_hand', canonical);
        alias('left_wrist', canonical);
        break;
      case 'right_hand_joint':
        alias('right_hand', canonical);
        alias('right_wrist', canonical);
        break;
      case 'left_upLeg_joint':
        alias('left_upLeg', canonical);
        alias('left_hip', canonical);
        break;
      case 'right_upLeg_joint':
        alias('right_upLeg', canonical);
        alias('right_hip', canonical);
        break;
      case 'left_leg_joint':
        alias('left_leg', canonical);
        alias('left_knee', canonical);
        break;
      case 'right_leg_joint':
        alias('right_leg', canonical);
        alias('right_knee', canonical);
        break;
      case 'left_foot_joint':
        alias('left_foot', canonical);
        alias('left_ankle', canonical);
        break;
      case 'right_foot_joint':
        alias('right_foot', canonical);
        alias('right_ankle', canonical);
        break;
      default:
        break;
    }
  }

  return map;
}

/**
 * Build a rep-detector-shaped joint map (only the keys the pull-up detector
 * reads) with full control over per-joint confidence and tracking.
 */
export function buildRepDetectorJoints(input: {
  shoulderY?: number;
  handY?: number;
  confidence?: number;
  isTracked?: boolean;
  overrides?: Partial<Record<'left_shoulder' | 'right_shoulder' | 'left_hand' | 'right_hand', JointOverride>>;
} = {}): RepDetectorPullupJoints {
  const {
    shoulderY = 0.3,
    handY = 0.55,
    confidence = 0.92,
    isTracked = true,
    overrides = {},
  } = input;

  const mk = (
    key: 'left_shoulder' | 'right_shoulder' | 'left_hand' | 'right_hand',
    x: number,
    y: number
  ) => {
    const override = overrides[key] ?? {};
    return {
      x: override.x ?? x,
      y: override.y ?? y,
      isTracked: override.isTracked ?? isTracked,
      confidence: override.confidence ?? confidence,
    };
  };

  return {
    left_shoulder: mk('left_shoulder', 0.4, shoulderY),
    right_shoulder: mk('right_shoulder', 0.6, shoulderY),
    left_hand: mk('left_hand', 0.35, handY),
    right_hand: mk('right_hand', 0.65, handY),
  };
}

/**
 * Produce a realistic anatomical angle set biased toward "at rest" (tall
 * standing, arms slightly bent). Callers override specific joints to place the
 * skeleton into any phase.
 */
export function buildRealisticAngles(override: Partial<JointAngles> = {}): JointAngles {
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
