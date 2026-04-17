/**
 * Subject identity tracker for the form tracking pipeline.
 *
 * ARKit tracks one body per frame with 2D joint positions but provides no
 * body anchor ID or multi-person support. When a second person walks in
 * front of the camera, ARKit may silently switch which person it is
 * tracking. This module detects that switch and exposes a flag so rep
 * counting can be paused until the original subject returns.
 *
 * Detection is based on two complementary signals:
 *  1. Centroid teleport — a sudden jump in the average position of all
 *     tracked joints between consecutive frames.
 *  2. Anthropometric signature deviation — a change in body proportions
 *     (shoulder width, torso length, arm ratio) compared to a baseline
 *     captured during a calibration window.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Joint2D = {
  x: number;
  y: number;
  isTracked: boolean;
  confidence?: number;
};

type JointMap = Record<string, Joint2D>;

export type SubjectIdentitySnapshot = {
  isCalibrated: boolean;
  isOriginalSubject: boolean;
  switchDetected: boolean;
  /** Last frame's centroid displacement (normalised coords). */
  centroidJump: number;
  /** Current deviation from baseline signature (0 = identical). */
  signatureDeviation: number;
  framesSinceSwitchDetected: number;
  /** True if baseline was auto-recalibrated to a new subject. */
  recalibrated: boolean;
  signature: {
    shoulderWidth: number;
    torsoLength: number;
    armRatio: number;
  } | null;
};

export type SubjectIdentityOptions = {
  /** Number of frames used to build the baseline signature. */
  calibrationFrames?: number;
  /** Max allowed centroid displacement per frame (normalised coords). */
  maxCentroidJump?: number;
  /** Max allowed weighted signature deviation before flagging switch. */
  maxSignatureDeviation?: number;
  /** Consecutive frames above threshold to confirm a switch. */
  consecSwitchFrames?: number;
  /** Consecutive frames below threshold to confirm recovery. */
  consecRecoveryFrames?: number;
  /** EMA smoothing alpha for the running signature. */
  signatureAlpha?: number;
  /**
   * Frames of persistent switch before auto-recalibrating to the new subject.
   * Set to 0 to disable auto-recalibrate. Default 150 (5s at 30fps).
   */
  autoRecalibrateFrames?: number;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MIN_TRACKED_JOINTS_FOR_CENTROID = 3;

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function emaSimple(prev: number, next: number, alpha: number): number {
  return alpha * next + (1 - alpha) * prev;
}

function allTracked(joints: JointMap, keys: readonly string[]): boolean {
  for (const k of keys) {
    const j = joints[k];
    if (!j || !j.isTracked) return false;
  }
  return true;
}

function signatureJointsTracked(joints: JointMap): boolean {
  // We require shoulders and hips at minimum for a meaningful comparison.
  return allTracked(joints, ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']);
}

type RawSignature = {
  shoulderWidth: number;
  torsoLength: number;
  armRatio: number;
};

function computeRawSignature(joints: JointMap): RawSignature | null {
  if (!signatureJointsTracked(joints)) return null;

  const ls = joints['left_shoulder'];
  const rs = joints['right_shoulder'];
  const lh = joints['left_hip'];
  const rh = joints['right_hip'];

  const shoulderWidth = dist(ls.x, ls.y, rs.x, rs.y);

  const avgShoulderY = (ls.y + rs.y) / 2;
  const avgHipY = (lh.y + rh.y) / 2;
  const torsoLength = Math.abs(avgHipY - avgShoulderY);

  // Arm ratio: average of (shoulder-to-hand / torso) for each side.
  // Falls back to 0 if hands are not tracked.
  let armRatio = 0;
  let armCount = 0;

  const lHand = joints['left_hand'];
  if (lHand && lHand.isTracked && torsoLength > 0) {
    armRatio += dist(ls.x, ls.y, lHand.x, lHand.y) / torsoLength;
    armCount += 1;
  }

  const rHand = joints['right_hand'];
  if (rHand && rHand.isTracked && torsoLength > 0) {
    armRatio += dist(rs.x, rs.y, rHand.x, rHand.y) / torsoLength;
    armCount += 1;
  }

  if (armCount > 0) {
    armRatio /= armCount;
  }

  return { shoulderWidth, torsoLength, armRatio };
}

// ---------------------------------------------------------------------------
// Public class
// ---------------------------------------------------------------------------

export class SubjectIdentityTracker {
  // Options (with defaults)
  private readonly calibrationFrames: number;
  private readonly maxCentroidJump: number;
  private readonly maxSignatureDeviation: number;
  private readonly consecSwitchFrames: number;
  private readonly consecRecoveryFrames: number;
  private readonly signatureAlpha: number;
  private readonly autoRecalibrateFrames: number;

  // State
  private frameCount = 0;
  private isCalibrated = false;

  // Centroid tracking
  private lastCentroid: { x: number; y: number } | null = null;
  private centroidJump = 0;

  // Signature
  private baselineSignature: RawSignature | null = null;
  private currentSignature: RawSignature | null = null;
  private signatureDeviation = 0;

  // Switch detection
  private consecDeviationFrames = 0;
  private switchDetected = false;
  private framesSinceSwitchDetected = 0;
  private consecRecoveryCount = 0;
  private recalibrated = false;

  constructor(options?: SubjectIdentityOptions) {
    this.calibrationFrames = options?.calibrationFrames ?? 20;
    this.maxCentroidJump = options?.maxCentroidJump ?? 0.15;
    this.maxSignatureDeviation = options?.maxSignatureDeviation ?? 0.35;
    this.consecSwitchFrames = options?.consecSwitchFrames ?? 5;
    this.consecRecoveryFrames = options?.consecRecoveryFrames ?? 10;
    this.signatureAlpha = options?.signatureAlpha ?? 0.1;
    this.autoRecalibrateFrames = options?.autoRecalibrateFrames ?? 150; // 5s at 30fps
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  step(joints: JointMap): SubjectIdentitySnapshot {
    this.frameCount += 1;

    // 1. Centroid tracking
    this.updateCentroid(joints);

    // 2. Signature update
    this.updateSignature(joints);

    // 3. Switch / recovery logic (only post-calibration)
    if (this.isCalibrated) {
      this.evaluateSwitchState();
    }

    return this.getSnapshot();
  }

  getSnapshot(): SubjectIdentitySnapshot {
    return {
      isCalibrated: this.isCalibrated,
      isOriginalSubject: !this.switchDetected,
      switchDetected: this.switchDetected,
      centroidJump: this.centroidJump,
      signatureDeviation: this.signatureDeviation,
      framesSinceSwitchDetected: this.framesSinceSwitchDetected,
      recalibrated: this.recalibrated,
      signature: this.baselineSignature
        ? { ...this.baselineSignature }
        : null,
    };
  }

  /**
   * Accept the current subject as the new baseline.
   * Call this when the user manually confirms, or called automatically
   * after `autoRecalibrateFrames` of persistent switch.
   */
  recalibrate(): void {
    if (this.currentSignature) {
      this.baselineSignature = { ...this.currentSignature };
    }
    this.switchDetected = false;
    this.framesSinceSwitchDetected = 0;
    this.consecDeviationFrames = 0;
    this.consecRecoveryCount = 0;
    this.signatureDeviation = 0;
    this.recalibrated = true;
  }

  reset(): void {
    this.frameCount = 0;
    this.isCalibrated = false;
    this.lastCentroid = null;
    this.centroidJump = 0;
    this.baselineSignature = null;
    this.currentSignature = null;
    this.signatureDeviation = 0;
    this.consecDeviationFrames = 0;
    this.switchDetected = false;
    this.framesSinceSwitchDetected = 0;
    this.consecRecoveryCount = 0;
    this.recalibrated = false;
  }

  // -----------------------------------------------------------------------
  // Centroid
  // -----------------------------------------------------------------------

  private updateCentroid(joints: JointMap): void {
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    const keys = Object.keys(joints);
    for (const key of keys) {
      const j = joints[key];
      if (j && j.isTracked) {
        sumX += j.x;
        sumY += j.y;
        count += 1;
      }
    }

    if (count < MIN_TRACKED_JOINTS_FOR_CENTROID) {
      // Not enough data — don't update centroid and don't flag a jump.
      this.centroidJump = 0;
      return;
    }

    const cx = sumX / count;
    const cy = sumY / count;

    if (this.lastCentroid !== null) {
      this.centroidJump = dist(cx, cy, this.lastCentroid.x, this.lastCentroid.y);
    } else {
      this.centroidJump = 0;
    }

    this.lastCentroid = { x: cx, y: cy };
  }

  // -----------------------------------------------------------------------
  // Signature
  // -----------------------------------------------------------------------

  private updateSignature(joints: JointMap): void {
    const raw = computeRawSignature(joints);
    if (!raw) return;

    if (!this.isCalibrated) {
      // During calibration: build running EMA
      if (this.currentSignature === null) {
        this.currentSignature = { ...raw };
      } else {
        this.currentSignature.shoulderWidth = emaSimple(
          this.currentSignature.shoulderWidth,
          raw.shoulderWidth,
          this.signatureAlpha,
        );
        this.currentSignature.torsoLength = emaSimple(
          this.currentSignature.torsoLength,
          raw.torsoLength,
          this.signatureAlpha,
        );
        this.currentSignature.armRatio = emaSimple(
          this.currentSignature.armRatio,
          raw.armRatio,
          this.signatureAlpha,
        );
      }

      if (this.frameCount >= this.calibrationFrames) {
        this.baselineSignature = { ...this.currentSignature };
        this.isCalibrated = true;
      }
      return;
    }

    // Post-calibration: update running signature and compute deviation
    if (this.currentSignature === null) {
      this.currentSignature = { ...raw };
    } else {
      this.currentSignature.shoulderWidth = emaSimple(
        this.currentSignature.shoulderWidth,
        raw.shoulderWidth,
        this.signatureAlpha,
      );
      this.currentSignature.torsoLength = emaSimple(
        this.currentSignature.torsoLength,
        raw.torsoLength,
        this.signatureAlpha,
      );
      this.currentSignature.armRatio = emaSimple(
        this.currentSignature.armRatio,
        raw.armRatio,
        this.signatureAlpha,
      );
    }

    this.signatureDeviation = this.computeDeviation(this.currentSignature);
  }

  private computeDeviation(sig: RawSignature): number {
    if (!this.baselineSignature) return 0;
    const base = this.baselineSignature;

    const dShoulder =
      base.shoulderWidth > 0
        ? Math.abs(sig.shoulderWidth - base.shoulderWidth) / base.shoulderWidth
        : 0;
    const dTorso =
      base.torsoLength > 0
        ? Math.abs(sig.torsoLength - base.torsoLength) / base.torsoLength
        : 0;
    const dArm =
      base.armRatio > 0
        ? Math.abs(sig.armRatio - base.armRatio) / base.armRatio
        : 0;

    return 0.3 * dShoulder + 0.4 * dTorso + 0.3 * dArm;
  }

  // -----------------------------------------------------------------------
  // Switch / recovery state machine
  // -----------------------------------------------------------------------

  private evaluateSwitchState(): void {
    const overThreshold =
      this.signatureDeviation > this.maxSignatureDeviation ||
      this.centroidJump > this.maxCentroidJump;

    if (!this.switchDetected) {
      // Looking for switch
      if (overThreshold) {
        this.consecDeviationFrames += 1;
        if (this.consecDeviationFrames >= this.consecSwitchFrames) {
          this.switchDetected = true;
          this.framesSinceSwitchDetected = 0;
          this.consecRecoveryCount = 0;
        }
      } else {
        this.consecDeviationFrames = 0;
      }
    } else {
      // In switch state — looking for recovery or auto-recalibrate
      this.framesSinceSwitchDetected += 1;

      // Auto-recalibrate: if the switch persists long enough, accept the
      // new subject. This handles cases like handing the phone to a friend
      // or permanently switching who is being recorded.
      if (
        this.autoRecalibrateFrames > 0 &&
        this.framesSinceSwitchDetected >= this.autoRecalibrateFrames
      ) {
        this.recalibrate();
        return;
      }

      if (
        this.signatureDeviation <= this.maxSignatureDeviation &&
        this.centroidJump <= this.maxCentroidJump
      ) {
        this.consecRecoveryCount += 1;
        if (this.consecRecoveryCount >= this.consecRecoveryFrames) {
          this.switchDetected = false;
          this.framesSinceSwitchDetected = 0;
          this.consecDeviationFrames = 0;
          this.consecRecoveryCount = 0;
        }
      } else {
        this.consecRecoveryCount = 0;
      }
    }
  }
}
