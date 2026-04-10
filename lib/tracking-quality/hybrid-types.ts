/**
 * Type contracts for the hybrid rep detection system.
 *
 * These interfaces are implemented by:
 * - `vertical-displacement.ts` (VerticalDisplacementTracker)
 * - `hybrid-rep-detector.ts` (HybridRepDetector)
 *
 * Both files are built by Agent 2. This file provides the shared type
 * contracts so consumers (workout controller, scan-arkit) can compile
 * independently.
 */

// ---------------------------------------------------------------------------
// Vertical Displacement
// ---------------------------------------------------------------------------

export interface VerticalSignal {
  smoothedY: number;
  velocity: number;
  isPeak: boolean;
  isValley: boolean;
  peakToValleyDelta: number;
  confidence: number;
  referenceJoint: string;
}

// ---------------------------------------------------------------------------
// Hybrid Rep Detector
// ---------------------------------------------------------------------------

export type HybridRepSource = 'angle' | 'vertical' | 'both';

export interface HybridRepEvent {
  repNumber: number;
  timestamp: number;
  source: HybridRepSource;
  confidence: number;
}

export interface HybridRepDetectorStepInput {
  timestampSec: number;
  angles: {
    leftElbow: number;
    rightElbow: number;
    leftShoulder: number;
    rightShoulder: number;
    leftKnee: number;
    rightKnee: number;
    leftHip: number;
    rightHip: number;
  };
  joints2D?: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }> | null;
  trackingQuality?: number;
}

export interface HybridRepDetectorSnapshot {
  repCount: number;
  lastRepEvent: HybridRepEvent | null;
  activeSource: HybridRepSource;
  verticalSignal: VerticalSignal | null;
}

/**
 * Minimal interface that the workout controller codes against.
 * The concrete `HybridRepDetector` class in `hybrid-rep-detector.ts`
 * must satisfy this contract.
 */
export interface IHybridRepDetector {
  step(input: HybridRepDetectorStepInput): HybridRepEvent | null;
  getSnapshot(): HybridRepDetectorSnapshot;
  reset(): void;
}

/**
 * Minimal interface for the vertical displacement tracker.
 * The concrete `VerticalDisplacementTracker` class in
 * `vertical-displacement.ts` must satisfy this contract.
 */
export interface IVerticalDisplacementTracker {
  update(
    joints: Map<string, { x: number; y: number; isTracked: boolean; confidence?: number }>,
    timestampSec: number,
  ): VerticalSignal;
  reset(): void;
  getLatestSignal(): VerticalSignal | null;
}
