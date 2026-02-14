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

export type OcclusionHoldManagerOptions = {
  holdFrames?: number;
  minConfidence?: number;
  decayFactorPerFrame?: number;
};

export class OcclusionHoldManager {
  private readonly holdFrames: number;
  private readonly minConfidence: number;
  private readonly decayFactorPerFrame: number;
  private readonly holds = new Map<string, HoldState>();

  constructor(options: OcclusionHoldManagerOptions = {}) {
    this.holdFrames = options.holdFrames ?? HOLD_FRAMES;
    this.minConfidence = options.minConfidence ?? CONFIDENCE_TIER_THRESHOLDS.low;
    this.decayFactorPerFrame = options.decayFactorPerFrame ?? 0.85;
  }

  reset(): void {
    this.holds.clear();
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
      const base = typeof held.lastGood.confidence === 'number' ? clamp01(held.lastGood.confidence) : 1;
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
      const base = typeof held.lastGood.confidence === 'number' ? clamp01(held.lastGood.confidence) : 1;
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
