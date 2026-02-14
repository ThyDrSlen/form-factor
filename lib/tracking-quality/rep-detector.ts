import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

import { CONFIDENCE_TIER_THRESHOLDS, N_CONSEC_FRAMES, REP_DETECTOR_THRESHOLDS } from './config';
import type { RequiredJointSpec } from './visibility';
import { areRequiredJointsVisible } from './visibility';

const REQUIRED_JOINTS: RequiredJointSpec[] = [
  ['left_shoulder', 'left_shoulder_1_joint'],
  ['right_shoulder', 'right_shoulder_1_joint'],
  ['left_hand', 'left_wrist'],
  ['right_hand', 'right_wrist'],
];

export type RepDetectorPullupState = 'bottom' | 'ascending' | 'top' | 'descending';

export type RepDetectorPullupJoint2D = {
  x: number;
  y: number;
  isTracked: boolean;
  confidence?: number;
};

export type RepDetectorPullupJoints =
  | Map<string, RepDetectorPullupJoint2D>
  | Record<string, RepDetectorPullupJoint2D | null | undefined>;

export type RepDetectorPullupStepInput = {
  timestampSec: number;
  angles: JointAngles;
  joints?: RepDetectorPullupJoints | null;
  trackingQuality?: number;
};

export type RepDetectorPullupSnapshot = {
  state: RepDetectorPullupState;
  repCount: number;
  frozenFrames: number;
  baselineGap: number | null;
};

export type RepDetectorPullupOptions = {
  nConsecFrames?: number;
  minJointConfidence?: number;
  minTrackingQuality?: number;
  maxFrozenFrames?: number;
  maxAscendingFrames?: number;
  maxTopFrames?: number;
  maxDescendingFrames?: number;
  liftStartDelta?: number;
  liftTopDelta?: number;
  liftTopExitDelta?: number;
  liftBottomDelta?: number;
  elbowEngageDeg?: number;
  elbowTopDeg?: number;
  elbowBottomDeg?: number;
  baselineAlpha?: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ema(prev: number, next: number, alpha: number): number {
  return prev + (next - prev) * alpha;
}

function getJoint(joints: RepDetectorPullupJoints, key: string): RepDetectorPullupJoint2D | null {
  if (joints instanceof Map) {
    return (joints.get(key) as RepDetectorPullupJoint2D | undefined) ?? null;
  }
  return (joints[key] as RepDetectorPullupJoint2D | null | undefined) ?? null;
}

function asFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function computeShoulderHandGap(joints: RepDetectorPullupJoints): number | null {
  const leftShoulder = getJoint(joints, 'left_shoulder');
  const rightShoulder = getJoint(joints, 'right_shoulder');
  const leftHand = getJoint(joints, 'left_hand');
  const rightHand = getJoint(joints, 'right_hand');

  if (!leftShoulder?.isTracked || !rightShoulder?.isTracked || !leftHand?.isTracked || !rightHand?.isTracked) {
    return null;
  }

  const shoulderY = asFinite((leftShoulder.y + rightShoulder.y) / 2);
  const handY = asFinite((leftHand.y + rightHand.y) / 2);
  if (shoulderY === null || handY === null) return null;
  return shoulderY - handY;
}

export class RepDetectorPullup {
  private readonly options: Required<RepDetectorPullupOptions>;

  private state: RepDetectorPullupState = 'bottom';
  private repCount = 0;
  private frozenFrames = 0;

  private baselineGap: number | null = null;
  private sawTopSinceBottom = false;

  private framesInState = 0;
  private pendingState: RepDetectorPullupState | null = null;
  private pendingCount = 0;

  constructor(options?: RepDetectorPullupOptions) {
    const nConsecFrames =
      typeof options?.nConsecFrames === 'number' ? Math.floor(options.nConsecFrames) : N_CONSEC_FRAMES;
    const baselineAlpha = typeof options?.baselineAlpha === 'number' ? options.baselineAlpha : 0.08;
    this.options = {
      nConsecFrames: Math.max(1, nConsecFrames),
      minJointConfidence:
        typeof options?.minJointConfidence === 'number' ? options.minJointConfidence : CONFIDENCE_TIER_THRESHOLDS.medium,
      minTrackingQuality: typeof options?.minTrackingQuality === 'number' ? options.minTrackingQuality : 0,
      maxFrozenFrames: typeof options?.maxFrozenFrames === 'number' ? Math.max(0, Math.floor(options.maxFrozenFrames)) : 60,
      maxAscendingFrames:
        typeof options?.maxAscendingFrames === 'number' ? Math.max(1, Math.floor(options.maxAscendingFrames)) : 120,
      maxTopFrames: typeof options?.maxTopFrames === 'number' ? Math.max(1, Math.floor(options.maxTopFrames)) : 90,
      maxDescendingFrames:
        typeof options?.maxDescendingFrames === 'number' ? Math.max(1, Math.floor(options.maxDescendingFrames)) : 150,
      liftStartDelta:
        typeof options?.liftStartDelta === 'number' ? options.liftStartDelta : REP_DETECTOR_THRESHOLDS.liftStartDelta,
      liftTopDelta:
        typeof options?.liftTopDelta === 'number' ? options.liftTopDelta : REP_DETECTOR_THRESHOLDS.liftTopDelta,
      liftTopExitDelta:
        typeof options?.liftTopExitDelta === 'number' ? options.liftTopExitDelta : REP_DETECTOR_THRESHOLDS.liftTopExitDelta,
      liftBottomDelta:
        typeof options?.liftBottomDelta === 'number' ? options.liftBottomDelta : REP_DETECTOR_THRESHOLDS.liftBottomDelta,
      elbowEngageDeg:
        typeof options?.elbowEngageDeg === 'number' ? options.elbowEngageDeg : REP_DETECTOR_THRESHOLDS.elbowEngageDeg,
      elbowTopDeg: typeof options?.elbowTopDeg === 'number' ? options.elbowTopDeg : REP_DETECTOR_THRESHOLDS.elbowTopDeg,
      elbowBottomDeg:
        typeof options?.elbowBottomDeg === 'number' ? options.elbowBottomDeg : REP_DETECTOR_THRESHOLDS.elbowBottomDeg,
      baselineAlpha: clamp01(baselineAlpha),
    };
  }

  getSnapshot(): RepDetectorPullupSnapshot {
    return {
      state: this.state,
      repCount: this.repCount,
      frozenFrames: this.frozenFrames,
      baselineGap: this.baselineGap,
    };
  }

  reset(): void {
    this.state = 'bottom';
    this.repCount = 0;
    this.frozenFrames = 0;
    this.baselineGap = null;
    this.sawTopSinceBottom = false;
    this.framesInState = 0;
    this.pendingState = null;
    this.pendingCount = 0;
  }

  step(input: RepDetectorPullupStepInput): void {
    const joints = input.joints ?? null;
    const quality = typeof input.trackingQuality === 'number' ? clamp01(input.trackingQuality) : null;
    const qualityOk = quality === null ? true : quality >= this.options.minTrackingQuality;

    if (!qualityOk || !joints) {
      this.freezeOrTimeout();
      return;
    }

    const visible = areRequiredJointsVisible(joints, REQUIRED_JOINTS, this.options.minJointConfidence);
    const gap = visible ? computeShoulderHandGap(joints) : null;
    if (!visible || gap === null) {
      this.freezeOrTimeout();
      return;
    }

    if (this.baselineGap === null) {
      this.baselineGap = gap;
    }

    const delta = this.baselineGap === null ? 0 : gap - this.baselineGap;
    const avgElbow = (input.angles.leftElbow + input.angles.rightElbow) / 2;

    if (
      this.baselineGap !== null &&
      this.state === 'bottom' &&
      !this.sawTopSinceBottom &&
      Math.abs(delta) <= this.options.liftBottomDelta &&
      avgElbow >= this.options.elbowBottomDeg
    ) {
      this.baselineGap = ema(this.baselineGap, gap, this.options.baselineAlpha);
    }
    const wantAscending = delta >= this.options.liftStartDelta && avgElbow <= this.options.elbowEngageDeg;
    const wantTop = delta >= this.options.liftTopDelta && avgElbow <= this.options.elbowTopDeg;
    const wantDescending = delta <= this.options.liftTopExitDelta || avgElbow >= this.options.elbowTopDeg + 8;
    const wantBottom = delta <= this.options.liftBottomDelta && avgElbow >= this.options.elbowBottomDeg;

    this.frozenFrames = 0;
    this.framesInState += 1;

    switch (this.state) {
      case 'bottom': {
        this.framesInState = Math.min(this.framesInState, this.options.maxDescendingFrames);
        if (wantAscending) {
          this.queueTransition('ascending');
        } else {
          this.clearPending();
        }
        break;
      }

      case 'ascending': {
        if (this.framesInState > this.options.maxAscendingFrames) {
          this.resetCycle();
          break;
        }
        if (wantTop) {
          this.queueTransition('top');
        } else if (wantBottom) {
          this.queueTransition('bottom');
        } else {
          this.clearPending();
        }
        break;
      }

      case 'top': {
        if (this.framesInState > this.options.maxTopFrames) {
          this.queueTransition('descending');
          break;
        }
        if (wantDescending) {
          this.queueTransition('descending');
        } else {
          this.clearPending();
        }
        break;
      }

      case 'descending': {
        if (this.framesInState > this.options.maxDescendingFrames) {
          this.resetCycle();
          break;
        }
        if (wantBottom) {
          this.queueTransition('bottom');
        } else if (wantTop) {
          this.queueTransition('top');
        } else {
          this.clearPending();
        }
        break;
      }
    }
  }

  private freezeOrTimeout(): void {
    this.frozenFrames += 1;
    if (this.frozenFrames <= this.options.maxFrozenFrames) {
      return;
    }
    this.resetCycle();
  }

  private resetCycle(): void {
    this.state = 'bottom';
    this.framesInState = 0;
    this.pendingState = null;
    this.pendingCount = 0;
    this.sawTopSinceBottom = false;
    this.frozenFrames = 0;
  }

  private queueTransition(next: RepDetectorPullupState): void {
    if (this.pendingState !== next) {
      this.pendingState = next;
      this.pendingCount = 1;
    } else {
      this.pendingCount += 1;
    }

    if (this.pendingCount < this.options.nConsecFrames) {
      return;
    }

    this.pendingState = null;
    this.pendingCount = 0;
    this.applyTransition(next);
  }

  private clearPending(): void {
    this.pendingState = null;
    this.pendingCount = 0;
  }

  private applyTransition(next: RepDetectorPullupState): void {
    if (next === this.state) {
      this.framesInState = 0;
      return;
    }

    if (next === 'top') {
      this.sawTopSinceBottom = true;
    }

    if (this.state === 'descending' && next === 'bottom') {
      if (this.sawTopSinceBottom) {
        this.repCount += 1;
      }
      this.sawTopSinceBottom = false;
    }

    if (this.state === 'top' && next === 'descending') {
      this.sawTopSinceBottom = true;
    }

    if (this.state === 'bottom' && next !== 'bottom') {
      this.sawTopSinceBottom = false;
    }

    this.state = next;
    this.framesInState = 0;
  }
}
