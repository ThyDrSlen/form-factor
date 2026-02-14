import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';
import { CONFIDENCE_TIER_THRESHOLDS } from './config';
import type { TrackingConfidenceTier } from './types';

export type VisibilityTier = 'missing' | 'weak' | 'trusted';

export type RequiredJointSpec = string | string[];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function getConfidenceTier(score: number): TrackingConfidenceTier {
  const normalized = clamp01(score);
  if (normalized < CONFIDENCE_TIER_THRESHOLDS.low) {
    return 'low';
  }
  if (normalized < CONFIDENCE_TIER_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'high';
}

export function getVisibilityTier(score: number): VisibilityTier {
  const tier = getConfidenceTier(score);
  if (tier === 'high') return 'trusted';
  if (tier === 'medium') return 'weak';
  return 'missing';
}

export function isJointVisible(
  joint: CanonicalJoint2D | null | undefined,
  minConfidence: number = CONFIDENCE_TIER_THRESHOLDS.low,
): boolean {
  if (!joint || !joint.isTracked) {
    return false;
  }

  if (typeof joint.confidence === 'number') {
    return clamp01(joint.confidence) >= minConfidence;
  }

  return true;
}

export function areRequiredJointsVisible(
  joints: CanonicalJointMap | Record<string, CanonicalJoint2D | null | undefined> | null | undefined,
  required: RequiredJointSpec[],
  minConfidence: number = CONFIDENCE_TIER_THRESHOLDS.low,
): boolean {
  if (!joints) {
    return false;
  }

  const get = (key: string): CanonicalJoint2D | null | undefined => {
    if (joints instanceof Map) {
      return joints.get(key);
    }
    return joints[key];
  };

  for (const spec of required) {
    if (typeof spec === 'string') {
      if (!isJointVisible(get(spec), minConfidence)) {
        return false;
      }
      continue;
    }

    const anyVisible = spec.some((key) => isJointVisible(get(key), minConfidence));
    if (!anyVisible) {
      return false;
    }
  }

  return true;
}

export const is_joint_visible = isJointVisible;
export const required_joints_visible = areRequiredJointsVisible;

export const PULLUP_CRITICAL_JOINTS: RequiredJointSpec[] = [
  ['left_shoulder', 'left_shoulder_1_joint'],
  ['right_shoulder', 'right_shoulder_1_joint'],
  ['left_elbow', 'left_forearm', 'left_forearm_joint'],
  ['right_elbow', 'right_forearm', 'right_forearm_joint'],
];
