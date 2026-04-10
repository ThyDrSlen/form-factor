import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';
import {
  CONFIDENCE_TIER_THRESHOLDS,
  STABILITY_MAX_VARIANCE,
  STABILITY_WINDOW_SIZE,
} from './config';
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

// ---------------------------------------------------------------------------
// JointStabilityTracker — derives synthetic confidence from position variance
// ---------------------------------------------------------------------------

type JointHistory = {
  /** Circular buffer of frame-to-frame position deltas (Euclidean) */
  deltas: number[];
  /** Write index in the circular buffer */
  writeIdx: number;
  /** Number of valid entries (<= windowSize) */
  count: number;
  /** Last known position (x, y) used to compute the next delta */
  lastX: number;
  lastY: number;
};

export class JointStabilityTracker {
  private readonly windowSize: number;
  private readonly maxVariance: number;
  private readonly joints = new Map<string, JointHistory>();

  constructor(options?: { windowSize?: number; maxVariance?: number }) {
    this.windowSize = options?.windowSize ?? STABILITY_WINDOW_SIZE;
    this.maxVariance = options?.maxVariance ?? STABILITY_MAX_VARIANCE;
  }

  /**
   * Feed a new frame of joint positions into the tracker.
   * Call once per frame with all joints present in that frame.
   */
  update(joints: CanonicalJointMap | Record<string, CanonicalJoint2D | null | undefined>): void {
    const entries: [string, CanonicalJoint2D | null | undefined][] =
      joints instanceof Map ? Array.from(joints.entries()) : Object.entries(joints);

    for (const [name, joint] of entries) {
      if (!joint || !joint.isTracked) continue;

      let history = this.joints.get(name);
      if (!history) {
        // First frame for this joint — store position, no delta yet
        history = {
          deltas: new Array<number>(this.windowSize).fill(0),
          writeIdx: 0,
          count: 0,
          lastX: joint.x,
          lastY: joint.y,
        };
        this.joints.set(name, history);
        continue;
      }

      const dx = joint.x - history.lastX;
      const dy = joint.y - history.lastY;
      const delta = Math.sqrt(dx * dx + dy * dy);

      history.deltas[history.writeIdx] = delta;
      history.writeIdx = (history.writeIdx + 1) % this.windowSize;
      if (history.count < this.windowSize) history.count += 1;

      history.lastX = joint.x;
      history.lastY = joint.y;
    }
  }

  /**
   * Returns a synthetic confidence in [0, 1] for the named joint.
   * 1 = very stable (low mean-square delta), 0 = very jittery (high mean-square delta).
   * Returns `null` if the joint has never been tracked.
   *
   * Uses mean-square displacement rather than variance-of-deltas so that
   * consistent large jumps (e.g. hallucinated/inferred ARKit joints) are
   * correctly penalised even when all deltas are the same magnitude.
   */
  getJointConfidence(jointName: string): number | null {
    const history = this.joints.get(jointName);
    if (!history || history.count === 0) return null;

    const n = history.count;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      sumSq += history.deltas[i] * history.deltas[i];
    }
    const meanSquare = sumSq / n;

    return clamp01(1 - meanSquare / this.maxVariance);
  }

  /** Reset all tracked history. */
  reset(): void {
    this.joints.clear();
  }
}

// Global singleton for use by isJointVisible when no tracker is explicitly provided.
let _globalStabilityTracker: JointStabilityTracker | null = null;

export function setGlobalStabilityTracker(tracker: JointStabilityTracker | null): void {
  _globalStabilityTracker = tracker;
}

export function getGlobalStabilityTracker(): JointStabilityTracker | null {
  return _globalStabilityTracker;
}

export function isJointVisible(
  joint: CanonicalJoint2D | null | undefined,
  minConfidence: number = CONFIDENCE_TIER_THRESHOLDS.low,
  stabilityTracker?: JointStabilityTracker | null,
  jointName?: string,
): boolean {
  if (!joint || !joint.isTracked) {
    return false;
  }

  // Prefer native confidence (e.g. MediaPipe provides this)
  if (typeof joint.confidence === 'number') {
    return clamp01(joint.confidence) >= minConfidence;
  }

  // Fall back to synthetic confidence from stability tracker
  const tracker = stabilityTracker ?? _globalStabilityTracker;
  if (tracker && jointName) {
    const synthetic = tracker.getJointConfidence(jointName);
    if (synthetic !== null) {
      return synthetic >= minConfidence;
    }
  }

  // If no confidence source is available AND the joint is tracked, treat as visible
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
