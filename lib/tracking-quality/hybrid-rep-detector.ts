/**
 * Hybrid Rep Detector
 *
 * Fuses angle-based phase FSM and vertical displacement signals to produce
 * robust rep detection that works even when the user's back faces the camera.
 *
 * Signal fusion strategy:
 * - High tracking quality (>0.7): angle-based transitions are primary
 * - Medium quality (0.3-0.7): both signals weighted equally
 * - Low quality (<0.3) or null angles: vertical displacement is primary
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

import { VerticalDisplacementTracker, type VerticalSignal } from './vertical-displacement';

export interface HybridRepEvent {
  repNumber: number;
  timestamp: number;
  source: 'angle' | 'vertical' | 'both';
  confidence: number;
  angleSignal?: { phase: string };
  verticalSignal?: VerticalSignal;
}

export interface HybridRepDetectorConfig {
  /** Tracking quality thresholds for signal fusion. Default { high: 0.7, low: 0.3 } */
  trackingQualityThreshold: { high: number; low: number };
  /** Window (ms) within which two signals merge into one 'both' event. Default 500 */
  agreementWindowMs: number;
  /** Minimum time (ms) between rep events. Default 300 */
  cooldownMs: number;
  /** Direction of vertical movement for a rep. 'up' for pullups, 'down' for squats. Default 'up' */
  verticalMovementDirection: 'up' | 'down';
}

export interface HybridRepDetectorFrameInput {
  angles: JointAngles | null;
  joints2D: Record<string, { x: number; y: number; isTracked: boolean }>;
  trackingQuality: number;
  timestamp: number;
  phaseTransition?: { from: string; to: string };
}

const DEFAULT_CONFIG: HybridRepDetectorConfig = {
  trackingQualityThreshold: { high: 0.7, low: 0.3 },
  agreementWindowMs: 500,
  cooldownMs: 300,
  verticalMovementDirection: 'up',
};

/**
 * For pullups (verticalMovementDirection='up'):
 *   A rep completes when the body goes UP (peak) then comes back DOWN (valley).
 *   The vertical tracker fires isPeak when body reaches top. We count on isPeak.
 *
 * For squats (verticalMovementDirection='down'):
 *   A rep completes when the body goes DOWN (valley) then comes back UP (peak).
 *   We count on isValley.
 */
function isVerticalRepSignal(signal: VerticalSignal, direction: 'up' | 'down'): boolean {
  return direction === 'up' ? signal.isPeak : signal.isValley;
}

/**
 * Check if a phase transition represents a completed rep in the angle-based FSM.
 * The existing RepDetectorPullup counts a rep on descending -> bottom transition
 * when a top was seen. We mirror that logic here.
 */
function isAngleRepTransition(transition: { from: string; to: string }): boolean {
  return transition.from === 'descending' && transition.to === 'bottom';
}

export class HybridRepDetector {
  private readonly config: HybridRepDetectorConfig;
  private readonly verticalTracker: VerticalDisplacementTracker;

  private repCount = 0;
  private lastRepTimestamp: number | null = null;

  /** Pending angle-based rep detection waiting for potential vertical confirmation */
  private pendingAngleRep: { timestamp: number; phase: string } | null = null;
  /** Pending vertical-based rep detection waiting for potential angle confirmation */
  private pendingVerticalRep: { timestamp: number; signal: VerticalSignal } | null = null;

  constructor(config?: Partial<HybridRepDetectorConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      trackingQualityThreshold: {
        ...DEFAULT_CONFIG.trackingQualityThreshold,
        ...config?.trackingQualityThreshold,
      },
    };
    this.verticalTracker = new VerticalDisplacementTracker();
  }

  processFrame(input: HybridRepDetectorFrameInput): HybridRepEvent | null {
    const { angles, joints2D, trackingQuality, timestamp, phaseTransition } = input;

    // Always feed the vertical tracker
    const verticalSignal = this.verticalTracker.processFrame(joints2D);

    // Detect angle-based rep
    const angleRepDetected =
      phaseTransition != null && isAngleRepTransition(phaseTransition);

    // Detect vertical-based rep
    const verticalRepDetected =
      isVerticalRepSignal(verticalSignal, this.config.verticalMovementDirection) &&
      verticalSignal.confidence > 0;

    // Check for merged pending events from previous frames
    const mergedEvent = this.checkPendingMerge(
      timestamp,
      angleRepDetected,
      verticalRepDetected,
      verticalSignal,
      phaseTransition,
    );
    if (mergedEvent) {
      return mergedEvent;
    }

    // Determine quality tier
    const quality = Number.isFinite(trackingQuality)
      ? Math.min(1, Math.max(0, trackingQuality))
      : 0;
    const { high, low } = this.config.trackingQualityThreshold;

    // No angles available: vertical is the only signal regardless of quality score
    if (angles === null) {
      return this.processLowQuality(
        verticalRepDetected,
        timestamp,
        verticalSignal,
      );
    }

    // High quality mode: angle-based is primary
    if (quality > high) {
      return this.processHighQuality(
        angleRepDetected,
        verticalRepDetected,
        timestamp,
        verticalSignal,
        phaseTransition,
      );
    }

    // Low quality mode: vertical is primary
    if (quality < low) {
      return this.processLowQuality(
        verticalRepDetected,
        timestamp,
        verticalSignal,
      );
    }

    // Medium quality mode: both signals weighted equally
    return this.processMediumQuality(
      angleRepDetected,
      verticalRepDetected,
      timestamp,
      verticalSignal,
      phaseTransition,
    );
  }

  reset(): void {
    this.repCount = 0;
    this.lastRepTimestamp = null;
    this.pendingAngleRep = null;
    this.pendingVerticalRep = null;
    this.verticalTracker.reset();
  }

  getRepCount(): number {
    return this.repCount;
  }

  // ---- Private ----

  private processHighQuality(
    angleRepDetected: boolean,
    verticalRepDetected: boolean,
    timestamp: number,
    verticalSignal: VerticalSignal,
    phaseTransition?: { from: string; to: string },
  ): HybridRepEvent | null {
    if (angleRepDetected && verticalRepDetected) {
      // Both agree simultaneously
      return this.emitRep(timestamp, 'both', 1.0, phaseTransition, verticalSignal);
    }

    if (angleRepDetected) {
      // Store as pending, give vertical a chance to confirm
      this.pendingAngleRep = {
        timestamp,
        phase: phaseTransition?.to ?? 'unknown',
      };
      return null;
    }

    if (verticalRepDetected) {
      // In high quality mode, vertical alone does not trigger — just note it
      // to merge with a close angle detection
      this.pendingVerticalRep = { timestamp, signal: verticalSignal };
      return null;
    }

    // Flush stale pending angle rep (angle is primary in high quality)
    if (this.pendingAngleRep && timestamp - this.pendingAngleRep.timestamp > this.config.agreementWindowMs) {
      const event = this.emitRep(
        this.pendingAngleRep.timestamp,
        'angle',
        0.8,
        { from: 'descending', to: this.pendingAngleRep.phase },
        undefined,
      );
      this.pendingAngleRep = null;
      return event;
    }

    return null;
  }

  private processLowQuality(
    verticalRepDetected: boolean,
    timestamp: number,
    verticalSignal: VerticalSignal,
  ): HybridRepEvent | null {
    if (verticalRepDetected && verticalSignal.confidence >= 0.5) {
      return this.emitRep(timestamp, 'vertical', verticalSignal.confidence, undefined, verticalSignal);
    }
    return null;
  }

  private processMediumQuality(
    angleRepDetected: boolean,
    verticalRepDetected: boolean,
    timestamp: number,
    verticalSignal: VerticalSignal,
    phaseTransition?: { from: string; to: string },
  ): HybridRepEvent | null {
    if (angleRepDetected && verticalRepDetected) {
      return this.emitRep(timestamp, 'both', 1.0, phaseTransition, verticalSignal);
    }

    if (angleRepDetected) {
      // In medium mode, angle alone can trigger if confidence > 0.6
      this.pendingAngleRep = { timestamp, phase: phaseTransition?.to ?? 'unknown' };
      return null;
    }

    if (verticalRepDetected && verticalSignal.confidence > 0.6) {
      // In medium mode, vertical alone can trigger if confidence > 0.6
      this.pendingVerticalRep = { timestamp, signal: verticalSignal };
      return null;
    }

    // Flush stale pending
    const flushed = this.flushStalePending(timestamp);
    if (flushed) return flushed;

    return null;
  }

  private checkPendingMerge(
    timestamp: number,
    angleRepDetected: boolean,
    verticalRepDetected: boolean,
    verticalSignal: VerticalSignal,
    phaseTransition?: { from: string; to: string },
  ): HybridRepEvent | null {
    // Check if a new angle detection merges with pending vertical
    if (angleRepDetected && this.pendingVerticalRep) {
      const timeDiff = timestamp - this.pendingVerticalRep.timestamp;
      if (timeDiff <= this.config.agreementWindowMs) {
        const merged = this.emitRep(
          timestamp,
          'both',
          1.0,
          phaseTransition,
          this.pendingVerticalRep.signal,
        );
        this.pendingVerticalRep = null;
        return merged;
      }
    }

    // Check if a new vertical detection merges with pending angle
    if (verticalRepDetected && this.pendingAngleRep) {
      const timeDiff = timestamp - this.pendingAngleRep.timestamp;
      if (timeDiff <= this.config.agreementWindowMs) {
        const merged = this.emitRep(
          timestamp,
          'both',
          1.0,
          { from: 'descending', to: this.pendingAngleRep.phase },
          verticalSignal,
        );
        this.pendingAngleRep = null;
        return merged;
      }
    }

    return null;
  }

  private flushStalePending(timestamp: number): HybridRepEvent | null {
    if (
      this.pendingAngleRep &&
      timestamp - this.pendingAngleRep.timestamp > this.config.agreementWindowMs
    ) {
      const event = this.emitRep(
        this.pendingAngleRep.timestamp,
        'angle',
        0.7,
        { from: 'descending', to: this.pendingAngleRep.phase },
        undefined,
      );
      this.pendingAngleRep = null;
      return event;
    }

    if (
      this.pendingVerticalRep &&
      timestamp - this.pendingVerticalRep.timestamp > this.config.agreementWindowMs
    ) {
      const event = this.emitRep(
        this.pendingVerticalRep.timestamp,
        'vertical',
        this.pendingVerticalRep.signal.confidence * 0.8,
        undefined,
        this.pendingVerticalRep.signal,
      );
      this.pendingVerticalRep = null;
      return event;
    }

    return null;
  }

  private emitRep(
    timestamp: number,
    source: 'angle' | 'vertical' | 'both',
    confidence: number,
    phaseTransition?: { from: string; to: string },
    verticalSignal?: VerticalSignal,
  ): HybridRepEvent | null {
    // Enforce cooldown
    if (
      this.lastRepTimestamp !== null &&
      timestamp - this.lastRepTimestamp < this.config.cooldownMs
    ) {
      return null;
    }

    this.repCount++;
    this.lastRepTimestamp = timestamp;

    return {
      repNumber: this.repCount,
      timestamp,
      source,
      confidence: Math.min(1, Math.max(0, confidence)),
      angleSignal: phaseTransition ? { phase: phaseTransition.to } : undefined,
      verticalSignal,
    };
  }
}
