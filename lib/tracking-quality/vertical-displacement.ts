/**
 * Vertical Displacement Tracker
 *
 * Provides a secondary rep detection signal based on vertical body displacement.
 * When the user's back faces the camera, ARKit's joint angle data becomes unreliable,
 * but vertical shoulder movement (up/down) remains clearly visible from any orientation.
 *
 * Coordinate system: normalized screen coords where Y=0 is top, Y=1 is bottom.
 * For pullups, the TOP of the rep (chin over bar) has a LOWER Y value.
 * A "peak" in body position = local MINIMUM in Y value.
 * A "valley" in body position = local MAXIMUM in Y value.
 */

export interface VerticalSignal {
  /** EMA-smoothed Y position (0-1 normalized, 0=top of screen) */
  smoothedY: number;
  /** Rate of Y change per frame (positive = moving down, negative = moving up) */
  velocity: number;
  /** Local maximum in body height detected (body at highest point = lowest Y = top of rep) */
  isPeak: boolean;
  /** Local minimum in body height detected (body at lowest point = highest Y = hang/bottom) */
  isValley: boolean;
  /** Y distance between last peak and valley */
  peakToValleyDelta: number;
  /** 0-1 based on joint agreement and stability */
  confidence: number;
  /** Which joint was used as reference */
  referenceJoint: string;
}

export interface VerticalDisplacementConfig {
  /** EMA smoothing factor (0-1). Higher = less smoothing. Default 0.3 */
  emaAlpha: number;
  /** Minimum Y delta between peak and valley to count as valid. Default 0.08 */
  minPeakDelta: number;
  /** Number of consecutive frames of direction change to confirm peak/valley. Default 3 */
  windowSize: number;
}

type JointInput = Record<string, { x: number; y: number; isTracked: boolean }>;

const DEFAULT_CONFIG: VerticalDisplacementConfig = {
  emaAlpha: 0.3,
  minPeakDelta: 0.08,
  windowSize: 3,
};

/** Joint fallback priority groups with associated confidence scores */
const JOINT_GROUPS: {
  joints: string[];
  label: string;
  confidence: number;
}[] = [
  { joints: ['left_shoulder', 'right_shoulder'], label: 'shoulders_avg', confidence: 1.0 },
  { joints: ['left_shoulder'], label: 'left_shoulder', confidence: 0.7 },
  { joints: ['right_shoulder'], label: 'right_shoulder', confidence: 0.7 },
  { joints: ['head'], label: 'head', confidence: 0.5 },
  { joints: ['neck'], label: 'neck', confidence: 0.5 },
  { joints: ['left_hip', 'right_hip'], label: 'hips_avg', confidence: 0.3 },
  { joints: ['left_hip'], label: 'left_hip', confidence: 0.3 },
  { joints: ['right_hip'], label: 'right_hip', confidence: 0.3 },
];

function pickReferenceY(joints: JointInput): { y: number; label: string; confidence: number } | null {
  for (const group of JOINT_GROUPS) {
    const tracked = group.joints.filter(
      (name) => joints[name] && joints[name].isTracked && Number.isFinite(joints[name].y),
    );
    if (tracked.length === group.joints.length) {
      const avgY = tracked.reduce((sum, name) => sum + joints[name].y, 0) / tracked.length;
      return { y: avgY, label: group.label, confidence: group.confidence };
    }
  }
  return null;
}

export class VerticalDisplacementTracker {
  private readonly config: VerticalDisplacementConfig;

  private smoothedY: number | null = null;
  private prevSmoothedY: number | null = null;

  /** Track direction: -1 = Y decreasing (body going up), +1 = Y increasing (body going down) */
  private direction: -1 | 0 | 1 = 0;
  /** Count of consecutive frames in the new direction (for hysteresis) */
  private directionChangeCount = 0;
  /** Tentative new direction before hysteresis confirms */
  private pendingDirection: -1 | 0 | 1 = 0;

  private lastPeakY: number | null = null;
  private lastValleyY: number | null = null;
  private peakToValleyDelta = 0;

  private frameCount = 0;

  constructor(config?: Partial<VerticalDisplacementConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  processFrame(joints: JointInput): VerticalSignal {
    const ref = pickReferenceY(joints);
    if (!ref) {
      return this.noSignal();
    }

    this.frameCount++;

    // EMA smoothing
    if (this.smoothedY === null) {
      this.smoothedY = ref.y;
    } else {
      this.prevSmoothedY = this.smoothedY;
      this.smoothedY = this.smoothedY + (ref.y - this.smoothedY) * this.config.emaAlpha;
    }

    // Compute velocity (positive = moving down on screen, negative = moving up)
    const velocity = this.prevSmoothedY !== null ? this.smoothedY - this.prevSmoothedY : 0;

    // Determine current frame's raw direction
    const rawDirection: -1 | 0 | 1 = velocity < -0.001 ? -1 : velocity > 0.001 ? 1 : 0;

    // Hysteresis: require windowSize consecutive frames of new direction
    let isPeak = false;
    let isValley = false;

    if (rawDirection !== 0 && rawDirection !== this.direction) {
      // Direction might be changing
      if (rawDirection === this.pendingDirection) {
        this.directionChangeCount++;
      } else {
        this.pendingDirection = rawDirection;
        this.directionChangeCount = 1;
      }

      if (this.directionChangeCount >= this.config.windowSize) {
        // Confirmed direction change
        const oldDirection = this.direction;
        this.direction = rawDirection;
        this.directionChangeCount = 0;
        this.pendingDirection = 0;

        if (oldDirection !== 0) {
          if (oldDirection === -1 && this.direction === 1) {
            // Was going up (Y decreasing), now going down (Y increasing)
            // => body was at peak (highest point = lowest Y)
            // Check if delta from last valley is sufficient
            if (
              this.lastValleyY !== null &&
              this.lastValleyY - this.smoothedY >= this.config.minPeakDelta
            ) {
              isPeak = true;
              this.lastPeakY = this.smoothedY;
              this.peakToValleyDelta = this.lastValleyY - this.smoothedY;
            } else if (this.lastValleyY === null) {
              // First peak ever, set it unconditionally
              this.lastPeakY = this.smoothedY;
            }
          } else if (oldDirection === 1 && this.direction === -1) {
            // Was going down (Y increasing), now going up (Y decreasing)
            // => body was at valley (lowest point = highest Y)
            if (
              this.lastPeakY !== null &&
              this.smoothedY - this.lastPeakY >= this.config.minPeakDelta
            ) {
              isValley = true;
              this.lastValleyY = this.smoothedY;
              this.peakToValleyDelta = this.smoothedY - this.lastPeakY;
            } else if (this.lastPeakY === null) {
              // First valley ever
              this.lastValleyY = this.smoothedY;
            }
          }
        }
      }
    } else if (rawDirection === this.direction) {
      // Same direction as current, reset pending
      this.directionChangeCount = 0;
      this.pendingDirection = 0;
    }

    return {
      smoothedY: this.smoothedY,
      velocity,
      isPeak,
      isValley,
      peakToValleyDelta: this.peakToValleyDelta,
      confidence: ref.confidence,
      referenceJoint: ref.label,
    };
  }

  reset(): void {
    this.smoothedY = null;
    this.prevSmoothedY = null;
    this.direction = 0;
    this.directionChangeCount = 0;
    this.pendingDirection = 0;
    this.lastPeakY = null;
    this.lastValleyY = null;
    this.peakToValleyDelta = 0;
    this.frameCount = 0;
  }

  private noSignal(): VerticalSignal {
    return {
      smoothedY: this.smoothedY ?? 0,
      velocity: 0,
      isPeak: false,
      isValley: false,
      peakToValleyDelta: this.peakToValleyDelta,
      confidence: 0,
      referenceJoint: 'none',
    };
  }
}
