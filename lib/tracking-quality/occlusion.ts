import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';
import {
  CONFIDENCE_TIER_THRESHOLDS,
  HOLD_FRAMES,
  SOFT_OCCLUSION_CONFIDENCE_THRESHOLD,
  SOFT_OCCLUSION_CONSEC_FRAMES,
} from './config';
import { isJointVisible, type JointStabilityTracker } from './visibility';

type HoldState = {
  lastGood: CanonicalJoint2D;
  missingFrames: number;
};

type SoftOcclusionState = {
  /** Consecutive frames the synthetic confidence has been below threshold */
  consecutiveLowFrames: number;
  /** Whether the joint is currently in soft-occluded state */
  occluded: boolean;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeJoint(joint: CanonicalJoint2D): CanonicalJoint2D {
  if (typeof joint.confidence !== 'number') {
    return { ...joint };
  }
  return { ...joint, confidence: clamp01(joint.confidence) };
}

export type OcclusionHoldManagerOptions = {
  holdFrames?: number;
  minConfidence?: number;
  decayFactorPerFrame?: number;
  stabilityTracker?: JointStabilityTracker | null;
  softOcclusionThreshold?: number;
  softOcclusionConsecFrames?: number;
};

export class OcclusionHoldManager {
  private readonly holdFrames: number;
  private readonly minConfidence: number;
  private readonly decayFactorPerFrame: number;
  private readonly holds = new Map<string, HoldState>();
  private stabilityTracker: JointStabilityTracker | null;
  private readonly softOcclusionThreshold: number;
  private readonly softOcclusionConsecFrames: number;
  private readonly softOcclusionStates = new Map<string, SoftOcclusionState>();

  constructor(options: OcclusionHoldManagerOptions = {}) {
    this.holdFrames = options.holdFrames ?? HOLD_FRAMES;
    this.minConfidence = options.minConfidence ?? CONFIDENCE_TIER_THRESHOLDS.low;
    this.decayFactorPerFrame = options.decayFactorPerFrame ?? 0.85;
    this.stabilityTracker = options.stabilityTracker ?? null;
    this.softOcclusionThreshold = options.softOcclusionThreshold ?? SOFT_OCCLUSION_CONFIDENCE_THRESHOLD;
    this.softOcclusionConsecFrames = options.softOcclusionConsecFrames ?? SOFT_OCCLUSION_CONSEC_FRAMES;
  }

  setStabilityTracker(tracker: JointStabilityTracker | null): void {
    this.stabilityTracker = tracker;
  }

  reset(): void {
    this.holds.clear();
    this.softOcclusionStates.clear();
  }

  /**
   * Returns true if the named joint is in "soft occlusion" — the joint reports
   * as tracked but its synthetic confidence has been below the threshold for
   * enough consecutive frames.
   */
  isSoftOccluded(jointName: string): boolean {
    return this.softOcclusionStates.get(jointName)?.occluded ?? false;
  }

  /**
   * Update soft occlusion state for a single joint. Returns true if the joint
   * should be treated as occluded (and therefore held).
   */
  private updateSoftOcclusion(key: string, joint: CanonicalJoint2D | null | undefined): boolean {
    if (!this.stabilityTracker) return false;
    if (!joint || !joint.isTracked) return false;

    // Only applies to joints without native confidence (ARKit)
    if (typeof joint.confidence === 'number') return false;

    const synthetic = this.stabilityTracker.getJointConfidence(key);
    if (synthetic === null) return false;

    let state = this.softOcclusionStates.get(key);
    if (!state) {
      state = { consecutiveLowFrames: 0, occluded: false };
      this.softOcclusionStates.set(key, state);
    }

    if (synthetic < this.softOcclusionThreshold) {
      state.consecutiveLowFrames += 1;
      if (state.consecutiveLowFrames >= this.softOcclusionConsecFrames) {
        state.occluded = true;
      }
    } else {
      state.consecutiveLowFrames = 0;
      state.occluded = false;
    }

    return state.occluded;
  }

  update(joints: CanonicalJointMap): CanonicalJointMap;
  update(joints: Record<string, CanonicalJoint2D | null | undefined>): Record<string, CanonicalJoint2D | null | undefined>;
  update(
    joints: CanonicalJointMap | Record<string, CanonicalJoint2D | null | undefined>,
  ): CanonicalJointMap | Record<string, CanonicalJoint2D | null | undefined> {
    if (joints instanceof Map) {
      return this.updateMap(joints);
    }
    return this.updateRecord(joints);
  }

  private decayConfidence(base: number, missingFrames: number): number {
    return clamp01(base * Math.pow(this.decayFactorPerFrame, missingFrames));
  }

  private isJointGood(key: string, incoming: CanonicalJoint2D | null | undefined): boolean {
    if (!incoming || !isJointVisible(incoming, this.minConfidence)) return false;

    // Check soft occlusion — a tracked joint with unstable position should be held
    if (this.updateSoftOcclusion(key, incoming)) return false;

    return true;
  }

  private updateMap(joints: CanonicalJointMap): CanonicalJointMap {
    const output: CanonicalJointMap = new Map();
    const keys = new Set<string>([...joints.keys(), ...this.holds.keys()]);

    for (const key of keys) {
      const incoming = joints.get(key);

      if (this.isJointGood(key, incoming)) {
        const normalized = normalizeJoint(incoming!);
        output.set(key, normalized);
        this.holds.set(key, { lastGood: normalized, missingFrames: 0 });
        continue;
      }

      const held = this.holds.get(key);
      if (!held) {
        continue;
      }

      if (held.missingFrames >= this.holdFrames) {
        this.holds.delete(key);
        continue;
      }

      held.missingFrames += 1;
      const base = typeof held.lastGood.confidence === 'number' ? clamp01(held.lastGood.confidence) : CONFIDENCE_TIER_THRESHOLDS.low;
      const decayed = this.decayConfidence(base, held.missingFrames);
      output.set(key, {
        x: held.lastGood.x,
        y: held.lastGood.y,
        isTracked: true,
        confidence: decayed,
      });
    }

    return output;
  }

  private updateRecord(
    joints: Record<string, CanonicalJoint2D | null | undefined>,
  ): Record<string, CanonicalJoint2D | null | undefined> {
    const output: Record<string, CanonicalJoint2D | null | undefined> = {};
    const keys = new Set<string>([...Object.keys(joints), ...this.holds.keys()]);

    for (const key of keys) {
      const incoming = joints[key];

      if (this.isJointGood(key, incoming)) {
        const normalized = normalizeJoint(incoming!);
        output[key] = normalized;
        this.holds.set(key, { lastGood: normalized, missingFrames: 0 });
        continue;
      }

      const held = this.holds.get(key);
      if (!held) {
        output[key] = null;
        continue;
      }

      if (held.missingFrames >= this.holdFrames) {
        this.holds.delete(key);
        output[key] = null;
        continue;
      }

      held.missingFrames += 1;
      const base = typeof held.lastGood.confidence === 'number' ? clamp01(held.lastGood.confidence) : CONFIDENCE_TIER_THRESHOLDS.low;
      const decayed = this.decayConfidence(base, held.missingFrames);
      output[key] = {
        x: held.lastGood.x,
        y: held.lastGood.y,
        isTracked: true,
        confidence: decayed,
      };
    }

    return output;
  }
}
