import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';
import { CONFIDENCE_TIER_THRESHOLDS, HOLD_FRAMES } from './config';
import { isJointVisible } from './visibility';

type HoldState = {
  lastGood: CanonicalJoint2D;
  missingFrames: number;
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

/**
 * Fires when one or more joints have been continuously occluded for longer
 * than the configured sustain threshold. Consumers typically surface a
 * micro-toast suggesting the user adjust sleeves / clothing.
 */
export type SustainedOcclusionEvent = {
  /** Joint names currently above the sustain threshold. */
  jointNames: string[];
  /** Frames the longest-occluded joint has been missing for. */
  maxMissingFrames: number;
};

export type OcclusionHoldManagerOptions = {
  holdFrames?: number;
  minConfidence?: number;
  decayFactorPerFrame?: number;
  /**
   * Number of consecutive frames a joint must be missing before
   * onSustainedOcclusion fires. Defaults to 30 (~1s at 30fps).
   */
  sustainFrames?: number;
  /** Callback invoked when one or more joints cross the sustain threshold. */
  onSustainedOcclusion?: (event: SustainedOcclusionEvent) => void;
};

export class OcclusionHoldManager {
  private readonly holdFrames: number;
  private readonly minConfidence: number;
  private readonly decayFactorPerFrame: number;
  private readonly holds = new Map<string, HoldState>();
  private readonly sustainFrames: number;
  private readonly onSustainedOcclusion?: (event: SustainedOcclusionEvent) => void;
  private readonly sustainedJoints = new Set<string>();

  constructor(options: OcclusionHoldManagerOptions = {}) {
    this.holdFrames = options.holdFrames ?? HOLD_FRAMES;
    this.minConfidence = options.minConfidence ?? CONFIDENCE_TIER_THRESHOLDS.low;
    this.decayFactorPerFrame = options.decayFactorPerFrame ?? 0.85;
    this.sustainFrames = options.sustainFrames ?? 30;
    this.onSustainedOcclusion = options.onSustainedOcclusion;
  }

  reset(): void {
    this.holds.clear();
    this.sustainedJoints.clear();
  }

  /**
   * Returns the names of joints that have been occluded long enough to
   * cross the sustain threshold. Refreshed on every update() call.
   */
  getSustainedOccludedJoints(): string[] {
    return Array.from(this.sustainedJoints);
  }

  /**
   * Re-evaluate sustained occlusion after every update() call. Fires the
   * callback only when the set of sustained joints changes from empty to
   * non-empty or gains a new joint, so consumers can gate micro-toasts
   * without repeating per frame.
   */
  private evaluateSustainedOcclusion(): void {
    const nextNames: string[] = [];
    let maxMissing = 0;
    for (const [name, state] of this.holds) {
      if (state.missingFrames >= this.sustainFrames) {
        nextNames.push(name);
        if (state.missingFrames > maxMissing) {
          maxMissing = state.missingFrames;
        }
      }
    }
    if (nextNames.length === 0) {
      this.sustainedJoints.clear();
      return;
    }
    const added = nextNames.filter((n) => !this.sustainedJoints.has(n));
    for (const n of nextNames) this.sustainedJoints.add(n);
    for (const existing of Array.from(this.sustainedJoints)) {
      if (!nextNames.includes(existing)) {
        this.sustainedJoints.delete(existing);
      }
    }
    if (added.length > 0 && this.onSustainedOcclusion) {
      try {
        this.onSustainedOcclusion({
          jointNames: [...nextNames],
          maxMissingFrames: maxMissing,
        });
      } catch {
        // Consumer callbacks must not break the pipeline.
      }
    }
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

  private updateMap(joints: CanonicalJointMap): CanonicalJointMap {
    const output: CanonicalJointMap = new Map();
    const keys = new Set<string>([...joints.keys(), ...this.holds.keys()]);

    for (const key of keys) {
      const incoming = joints.get(key);

      if (incoming && isJointVisible(incoming, this.minConfidence)) {
        const normalized = normalizeJoint(incoming);
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

    this.evaluateSustainedOcclusion();
    return output;
  }

  private updateRecord(
    joints: Record<string, CanonicalJoint2D | null | undefined>,
  ): Record<string, CanonicalJoint2D | null | undefined> {
    const output: Record<string, CanonicalJoint2D | null | undefined> = {};
    const keys = new Set<string>([...Object.keys(joints), ...this.holds.keys()]);

    for (const key of keys) {
      const incoming = joints[key];

      if (incoming && isJointVisible(incoming, this.minConfidence)) {
        const normalized = normalizeJoint(incoming);
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

    this.evaluateSustainedOcclusion();
    return output;
  }
}
