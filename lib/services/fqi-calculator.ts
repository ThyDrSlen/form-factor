/**
 * FQI (Form Quality Index) Calculator
 *
 * Calculates a 0-100 score for each rep based on:
 * - ROM (Range of Motion): How well the user achieved the target angle range
 * - Depth: How close to optimal position at the key point of the movement
 * - Faults: Deductions for detected form issues
 *
 * The weights for each component are defined per workout in WorkoutDefinition.fqiWeights
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type {
  WorkoutDefinition,
  FQIWeights,
  FaultDefinition,
  RepContext,
  AngleRange,
} from '@/lib/types/workout-definitions';
import type { RepFeatures } from '@/lib/types/telemetry';

// =============================================================================
// Types
// =============================================================================

export interface FQIResult {
  /** Overall FQI score (0-100) */
  score: number;
  /** ROM sub-score (0-100) */
  romScore: number;
  /** Depth sub-score (0-100) */
  depthScore: number;
  /** Fault penalty total (0-100) */
  faultPenalty: number;
  /** List of detected fault IDs */
  detectedFaults: string[];
}

export interface RepAngles {
  /** Angles at rep start */
  start: JointAngles;
  /** Angles at rep end */
  end: JointAngles;
  /** Minimum angles reached during rep */
  min: JointAngles;
  /** Maximum angles reached during rep */
  max: JointAngles;
}

// =============================================================================
// ROM Score Calculation
// =============================================================================

/**
 * Calculate ROM score based on how much of the target range was achieved
 * @param repAngles The angles captured during the rep
 * @param angleRanges Target angle ranges for the workout
 * @returns Score from 0-100
 */
function calculateRomScore(
  repAngles: RepAngles,
  angleRanges: Record<string, AngleRange>
): number {
  const scores: number[] = [];

  // Check elbow ROM if defined
  if (angleRanges.elbow) {
    const range = angleRanges.elbow;
    const avgMinElbow = (repAngles.min.leftElbow + repAngles.min.rightElbow) / 2;
    const avgMaxElbow = (repAngles.max.leftElbow + repAngles.max.rightElbow) / 2;

    // Calculate actual ROM achieved
    const actualRom = Math.abs(avgMaxElbow - avgMinElbow);
    const targetRom = range.max - range.min;

    // Score based on percentage of target ROM achieved
    const romPercentage = Math.min(1, actualRom / targetRom);
    scores.push(romPercentage * 100);
  }

  // Check shoulder ROM if defined
  if (angleRanges.shoulder) {
    const range = angleRanges.shoulder;
    const avgMinShoulder = (repAngles.min.leftShoulder + repAngles.min.rightShoulder) / 2;
    const avgMaxShoulder = (repAngles.max.leftShoulder + repAngles.max.rightShoulder) / 2;

    const actualRom = Math.abs(avgMaxShoulder - avgMinShoulder);
    const targetRom = range.max - range.min;

    const romPercentage = Math.min(1, actualRom / targetRom);
    scores.push(romPercentage * 100);
  }

  // Check knee ROM if defined
  if (angleRanges.knee) {
    const range = angleRanges.knee;
    const avgMinKnee = (repAngles.min.leftKnee + repAngles.min.rightKnee) / 2;
    const avgMaxKnee = (repAngles.max.leftKnee + repAngles.max.rightKnee) / 2;

    const actualRom = Math.abs(avgMaxKnee - avgMinKnee);
    const targetRom = range.max - range.min;

    const romPercentage = Math.min(1, actualRom / targetRom);
    scores.push(romPercentage * 100);
  }

  // Return average of all ROM scores, or 100 if no ranges defined
  if (scores.length === 0) return 100;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// =============================================================================
// Depth Score Calculation
// =============================================================================

/**
 * Calculate depth score based on how close to optimal position at the key point
 * @param repAngles The angles captured during the rep
 * @param angleRanges Target angle ranges for the workout
 * @returns Score from 0-100
 */
function calculateDepthScore(
  repAngles: RepAngles,
  angleRanges: Record<string, AngleRange>
): number {
  const scores: number[] = [];

  // For movements like pull-ups and push-ups, depth is measured by minimum elbow angle
  if (angleRanges.elbow) {
    const range = angleRanges.elbow;
    const avgMinElbow = (repAngles.min.leftElbow + repAngles.min.rightElbow) / 2;

    // How close to optimal? (lower is usually better for pulling/pressing)
    const deviation = Math.abs(avgMinElbow - range.optimal);
    const tolerance = range.tolerance;

    // Score: 100 if within tolerance, decreasing beyond that
    if (deviation <= tolerance) {
      scores.push(100);
    } else {
      // Decrease score by 2 points per degree beyond tolerance
      const penalty = (deviation - tolerance) * 2;
      scores.push(Math.max(0, 100 - penalty));
    }
  }

  // For squats/lunges, check hip and knee depth
  if (angleRanges.hip) {
    const range = angleRanges.hip;
    const avgMinHip = (repAngles.min.leftHip + repAngles.min.rightHip) / 2;

    const deviation = Math.abs(avgMinHip - range.optimal);
    const tolerance = range.tolerance;

    if (deviation <= tolerance) {
      scores.push(100);
    } else {
      const penalty = (deviation - tolerance) * 2;
      scores.push(Math.max(0, 100 - penalty));
    }
  }

  // Return average of all depth scores, or 100 if no ranges defined
  if (scores.length === 0) return 100;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// =============================================================================
// Fault Detection
// =============================================================================

/**
 * Detect which faults occurred during the rep
 * @param repContext Context about the rep for fault evaluation
 * @param faultDefinitions Fault definitions from the workout
 * @returns Array of detected fault IDs and total penalty
 */
function detectFaults(
  repContext: RepContext,
  faultDefinitions: FaultDefinition[]
): { faultIds: string[]; totalPenalty: number } {
  const faultIds: string[] = [];
  let totalPenalty = 0;

  for (const fault of faultDefinitions) {
    try {
      if (fault.condition(repContext)) {
        faultIds.push(fault.id);
        totalPenalty += fault.fqiPenalty;
      }
    } catch {
      // If fault condition throws, skip it (defensive)
      if (__DEV__) {
        console.warn(`[fqi-calculator] Fault condition failed for ${fault.id}`);
      }
    }
  }

  // Cap total penalty at 100
  return { faultIds, totalPenalty: Math.min(100, totalPenalty) };
}

// =============================================================================
// Main FQI Calculation
// =============================================================================

/**
 * Calculate the Form Quality Index for a completed rep
 *
 * @param repAngles Min/max angles captured during the rep
 * @param durationMs Rep duration in milliseconds
 * @param repNumber Current rep number (1-indexed)
 * @param workoutDef The workout definition with thresholds and weights
 * @returns FQI result with score and breakdown
 */
export function calculateFqi(
  repAngles: RepAngles,
  durationMs: number,
  repNumber: number,
  workoutDef: WorkoutDefinition
): FQIResult {
  const weights = workoutDef.fqiWeights;

  // Build rep context for fault detection
  const repContext: RepContext = {
    startAngles: repAngles.start,
    endAngles: repAngles.end,
    minAngles: repAngles.min,
    maxAngles: repAngles.max,
    durationMs,
    repNumber,
    workoutId: workoutDef.id,
  };

  // Calculate component scores
  const romScore = calculateRomScore(repAngles, workoutDef.angleRanges);
  const depthScore = calculateDepthScore(repAngles, workoutDef.angleRanges);
  const { faultIds, totalPenalty } = detectFaults(repContext, workoutDef.faults);

  // Calculate weighted FQI
  // ROM and depth contribute positively, faults subtract
  const romContribution = romScore * weights.rom;
  const depthContribution = depthScore * weights.depth;
  const faultContribution = (100 - totalPenalty) * weights.faults;

  const rawScore = romContribution + depthContribution + faultContribution;

  // Clamp to 0-100
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    score,
    romScore: Math.round(romScore),
    depthScore: Math.round(depthScore),
    faultPenalty: totalPenalty,
    detectedFaults: faultIds,
  };
}

// =============================================================================
// Feature Extraction
// =============================================================================

/**
 * Extract rep features from captured angle data
 * These features are logged to the database for ML training
 */
export function extractRepFeatures(
  repAngles: RepAngles,
  durationMs: number
): RepFeatures {
  // Calculate ROM as difference between max and min elbow angles
  const avgMinElbow = (repAngles.min.leftElbow + repAngles.min.rightElbow) / 2;
  const avgMaxElbow = (repAngles.max.leftElbow + repAngles.max.rightElbow) / 2;
  const romDeg = Math.abs(avgMaxElbow - avgMinElbow);

  // Depth is the minimum angle reached (lower = deeper for push-ups/pull-ups)
  const depthMin = avgMinElbow;

  return {
    romDeg,
    depthMin,
    durationMs,
    // These could be computed if we had velocity data:
    // peakVelocity: undefined,
    // depthRatio: undefined,
    // valgusPeak: undefined,
    // lumbarFlexionPeak: undefined,
  };
}

// =============================================================================
// Utility: Get Dynamic Cue for Detected Fault
// =============================================================================

/**
 * Get the dynamic cue text for a detected fault
 * @param faultId The fault ID
 * @param workoutDef The workout definition
 * @returns The cue text or undefined if fault not found
 */
export function getDynamicCue(
  faultId: string,
  workoutDef: WorkoutDefinition
): string | undefined {
  const fault = workoutDef.faults.find((f) => f.id === faultId);
  return fault?.dynamicCue;
}

/**
 * Get all dynamic cues for a set of detected faults
 * Returns them in order of severity (highest first)
 */
export function getDynamicCues(
  faultIds: string[],
  workoutDef: WorkoutDefinition
): string[] {
  const faults = workoutDef.faults
    .filter((f) => faultIds.includes(f.id))
    .sort((a, b) => b.severity - a.severity);

  return faults.map((f) => f.dynamicCue);
}
