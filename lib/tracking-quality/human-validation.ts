// ---------------------------------------------------------------------------
// Human body validation guard for the form tracking pipeline.
//
// Detects when ARKit places a skeleton on an inanimate object (yoga mat, bag,
// gym equipment) and rejects it.  Runs per-frame at 30-60 fps so every check
// is kept allocation-light.
// ---------------------------------------------------------------------------

/** Per-joint input expected from the ARKit skeleton. */
export type Joint2D = {
  x: number;
  y: number;
  isTracked: boolean;
  confidence?: number;
};

export type HumanValidationResult = {
  isHuman: boolean;
  confidence: number;
  checks: {
    minJoints: boolean;
    anatomicalPlausibility: boolean;
    bodyProportions: boolean;
    notStatic: boolean;
  };
  rejectionReason?: string;
};

export type HumanValidationOptions = {
  minTrackedJoints?: number;
  staticFrameThreshold?: number;
  staticVelocityThreshold?: number;
  humanConfidenceThreshold?: number;
};

// Joint names we rely on for anatomical checks.
const JOINT_HEAD = 'head';
const JOINT_LEFT_SHOULDER = 'left_shoulder';
const JOINT_RIGHT_SHOULDER = 'right_shoulder';
const JOINT_LEFT_HIP = 'left_hip';
const JOINT_RIGHT_HIP = 'right_hip';

// Weights for the four check categories when computing the overall confidence.
const CHECK_WEIGHT_MIN_JOINTS = 0.25;
const CHECK_WEIGHT_ANATOMICAL = 0.30;
const CHECK_WEIGHT_PROPORTIONS = 0.25;
const CHECK_WEIGHT_NOT_STATIC = 0.20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTracked(joints: Record<string, Joint2D>, name: string): Joint2D | null {
  const j = joints[name];
  if (j && j.isTracked) return j;
  return null;
}

function countTrackedJoints(joints: Record<string, Joint2D>): number {
  let count = 0;
  const keys = Object.keys(joints);
  for (let i = 0; i < keys.length; i++) {
    const j = joints[keys[i]];
    if (j && j.isTracked) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// HumanValidationGuard
// ---------------------------------------------------------------------------

export class HumanValidationGuard {
  private readonly minTrackedJoints: number;
  private readonly staticFrameThreshold: number;
  private readonly staticVelocityThreshold: number;
  private readonly humanConfidenceThreshold: number;

  // Pre-allocated previous-frame joint positions for velocity tracking.
  private prevPositions: Record<string, { x: number; y: number }> = {};
  private consecutiveStaticFrames = 0;
  private hasPrevFrame = false;

  constructor(options?: HumanValidationOptions) {
    this.minTrackedJoints = options?.minTrackedJoints ?? 4;
    this.staticFrameThreshold = options?.staticFrameThreshold ?? 30;
    this.staticVelocityThreshold = options?.staticVelocityThreshold ?? 0.001;
    this.humanConfidenceThreshold = options?.humanConfidenceThreshold ?? 0.6;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  step(joints: Record<string, Joint2D>): HumanValidationResult {
    const minJoints = this.checkMinJoints(joints);
    const anatomicalPlausibility = this.checkAnatomicalPlausibility(joints);
    const bodyProportions = this.checkBodyProportions(joints);
    const notStatic = this.checkNotStatic(joints);

    // Confidence: weighted sum of passed checks.
    let confidence = 0;
    if (minJoints) confidence += CHECK_WEIGHT_MIN_JOINTS;
    if (anatomicalPlausibility) confidence += CHECK_WEIGHT_ANATOMICAL;
    if (bodyProportions) confidence += CHECK_WEIGHT_PROPORTIONS;
    if (notStatic) confidence += CHECK_WEIGHT_NOT_STATIC;

    const isHuman = confidence >= this.humanConfidenceThreshold;

    const result: HumanValidationResult = {
      isHuman,
      confidence,
      checks: {
        minJoints,
        anatomicalPlausibility,
        bodyProportions,
        notStatic,
      },
    };

    if (!isHuman) {
      result.rejectionReason = this.buildRejectionReason(result.checks);
    }

    return result;
  }

  reset(): void {
    this.prevPositions = {};
    this.consecutiveStaticFrames = 0;
    this.hasPrevFrame = false;
  }

  // -----------------------------------------------------------------------
  // Check 1 — Minimum tracked joints
  // -----------------------------------------------------------------------

  private checkMinJoints(joints: Record<string, Joint2D>): boolean {
    return countTrackedJoints(joints) >= this.minTrackedJoints;
  }

  // -----------------------------------------------------------------------
  // Check 2 — Anatomical plausibility
  // -----------------------------------------------------------------------

  private checkAnatomicalPlausibility(joints: Record<string, Joint2D>): boolean {
    const head = getTracked(joints, JOINT_HEAD);
    const ls = getTracked(joints, JOINT_LEFT_SHOULDER);
    const rs = getTracked(joints, JOINT_RIGHT_SHOULDER);
    const lh = getTracked(joints, JOINT_LEFT_HIP);
    const rh = getTracked(joints, JOINT_RIGHT_HIP);

    // Need at least shoulders to evaluate anatomy.
    if (!ls || !rs) return true; // can't check — give benefit of the doubt

    // Head should be above shoulders (lower Y in screen coords).
    if (head) {
      const shoulderMidY = (ls.y + rs.y) / 2;
      if (head.y > shoulderMidY) return false;
    }

    // Shoulder width must be non-trivial and not absurdly wide.
    const shoulderWidth = Math.abs(rs.x - ls.x);
    if (shoulderWidth <= 0.02 || shoulderWidth >= 0.5) return false;

    // Left shoulder X should be <= right shoulder X (front-facing) or close.
    // Allow a small tolerance for slightly rotated poses.
    if (ls.x > rs.x + 0.05) return false;

    // Shoulders should be above hips.
    if (lh && rh) {
      const shoulderMidY = (ls.y + rs.y) / 2;
      const hipMidY = (lh.y + rh.y) / 2;
      if (shoulderMidY > hipMidY) return false;
    }

    // At least one limb pair should have non-zero length.
    if (!this.hasNonZeroLimb(joints)) return false;

    return true;
  }

  private hasNonZeroLimb(joints: Record<string, Joint2D>): boolean {
    const pairs: [string, string][] = [
      ['left_shoulder', 'left_elbow'],
      ['right_shoulder', 'right_elbow'],
      ['left_elbow', 'left_hand'],
      ['right_elbow', 'right_hand'],
      ['left_hip', 'left_shoulder'],
      ['right_hip', 'right_shoulder'],
    ];

    for (let i = 0; i < pairs.length; i++) {
      const a = getTracked(joints, pairs[i][0]);
      const b = getTracked(joints, pairs[i][1]);
      if (a && b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > 0.0001) return true; // > 0.01 in each axis
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Check 3 — Body proportion sanity
  // -----------------------------------------------------------------------

  private checkBodyProportions(joints: Record<string, Joint2D>): boolean {
    const ls = getTracked(joints, JOINT_LEFT_SHOULDER);
    const rs = getTracked(joints, JOINT_RIGHT_SHOULDER);
    const lh = getTracked(joints, JOINT_LEFT_HIP);
    const rh = getTracked(joints, JOINT_RIGHT_HIP);

    // Need both shoulder and hip pairs to evaluate proportions.
    if (!ls || !rs || !lh || !rh) return true; // can't check — benefit of the doubt

    const shoulderWidth = Math.abs(rs.x - ls.x);
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    const torsoLength = Math.abs(hipMidY - shoulderMidY);

    // Torso length should be reasonable in normalized screen coords.
    if (torsoLength < 0.05 || torsoLength > 0.5) return false;

    // Shoulder-to-torso ratio sanity.
    if (torsoLength > 0) {
      const ratio = shoulderWidth / torsoLength;
      if (ratio < 0.15 || ratio > 3.0) return false;
    }

    return true;
  }

  // -----------------------------------------------------------------------
  // Check 4 — Static object detection
  // -----------------------------------------------------------------------

  private checkNotStatic(joints: Record<string, Joint2D>): boolean {
    const keys = Object.keys(joints);

    if (!this.hasPrevFrame) {
      // First frame — record positions, assume not static.
      for (let i = 0; i < keys.length; i++) {
        const j = joints[keys[i]];
        if (j && j.isTracked) {
          this.prevPositions[keys[i]] = { x: j.x, y: j.y };
        }
      }
      this.hasPrevFrame = true;
      this.consecutiveStaticFrames = 0;
      return true;
    }

    // Compute max displacement across all tracked joints.
    let maxDisplacement = 0;
    let trackedCount = 0;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const j = joints[key];
      if (!j || !j.isTracked) continue;

      const prev = this.prevPositions[key];
      if (prev) {
        const dx = j.x - prev.x;
        const dy = j.y - prev.y;
        const displacement = Math.sqrt(dx * dx + dy * dy);
        if (displacement > maxDisplacement) {
          maxDisplacement = displacement;
        }
        trackedCount++;
      }

      // Update for next frame (mutate in-place, no allocation).
      this.prevPositions[key] = { x: j.x, y: j.y };
    }

    // If we have previous data for tracked joints, check velocity.
    if (trackedCount > 0 && maxDisplacement < this.staticVelocityThreshold) {
      this.consecutiveStaticFrames++;
    } else {
      this.consecutiveStaticFrames = 0;
    }

    return this.consecutiveStaticFrames < this.staticFrameThreshold;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildRejectionReason(checks: HumanValidationResult['checks']): string {
    const reasons: string[] = [];
    if (!checks.minJoints) reasons.push('too few tracked joints');
    if (!checks.anatomicalPlausibility) reasons.push('anatomically implausible');
    if (!checks.bodyProportions) reasons.push('body proportions out of range');
    if (!checks.notStatic) reasons.push('static object detected');
    return reasons.join('; ');
  }
}
