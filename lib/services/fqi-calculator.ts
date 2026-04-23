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

import type {
  WorkoutDefinition,
  FaultDefinition,
  RepContext,
  AngleRange,
  RepAngleWindow,
  ScoringMetricDefinition,
} from '@/lib/types/workout-definitions';
import { warnWithTs } from '@/lib/logger';
import type { RepFeatures } from '@/lib/types/telemetry';
import {
  createError,
  FormTrackingErrorCode,
  logError,
} from '@/lib/services/ErrorHandler';

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
  /**
   * Optional metadata surfacing exceptional conditions so upstream UI can
   * render a caveat (e.g. the score came from a degenerate ROM target and
   * is therefore cosmetic). Absence of `meta` means the result is normal.
   * A5 — introduced in wave-30.
   */
  meta?: {
    /**
     * True when every ROM/depth metric attempted to score against a
     * degenerate AngleRange (non-positive tolerance or max <= min) so
     * `calculateRomScore` and `calculateDepthScore` both fell back to
     * their 100-default. The overall score is still 100 for stability,
     * but downstream UI should tag this rep as "needs calibration".
     */
    degenerate: boolean;
  };
}

export type RepAngles = RepAngleWindow;

// =============================================================================
// ROM Score Calculation
// =============================================================================

/**
 * Calculate ROM score based on how much of the target range was achieved
 * @param repAngles The angles captured during the rep
 * @param angleRanges Target angle ranges for the workout
 * @returns An object with the score (0-100) and a `degenerate` flag that
 *   is true only when every scoring candidate returned null (degenerate
 *   AngleRange or non-finite input). In that case the score is the 100
 *   fallback — the caller should surface the degenerate state to the UI
 *   rather than treating the rep as a perfect rep.
 */
function calculateRomScore(
  repAngles: RepAngles,
  angleRanges: Record<string, AngleRange>,
  scoringMetrics?: ScoringMetricDefinition[]
): { score: number; degenerate: boolean } {
  const scores: number[] = [];
  let attempted = 0;

  if (scoringMetrics && scoringMetrics.length > 0) {
    for (const metric of scoringMetrics) {
      const range = angleRanges[metric.id];
      if (!range) continue;
      attempted += 1;

      const left = metric.extract(repAngles, 'left');
      const right = metric.extract(repAngles, 'right');

      if (
        !Number.isFinite(left.min) ||
        !Number.isFinite(left.max) ||
        !Number.isFinite(right.min) ||
        !Number.isFinite(right.max)
      ) {
        continue;
      }

      const avgMin = (left.min + right.min) / 2;
      const avgMax = (left.max + right.max) / 2;
      const actualRom = Math.abs(avgMax - avgMin);
      const score = scoreRomAgainstRange(actualRom, range);
      if (score !== null) scores.push(score);
    }

    if (scores.length === 0) {
      return { score: 100, degenerate: attempted > 0 };
    }
    return {
      score: scores.reduce((a, b) => a + b, 0) / scores.length,
      degenerate: false,
    };
  }

  // Check elbow ROM if defined
  if (angleRanges.elbow) {
    attempted += 1;
    const range = angleRanges.elbow;
    const avgMinElbow = (repAngles.min.leftElbow + repAngles.min.rightElbow) / 2;
    const avgMaxElbow = (repAngles.max.leftElbow + repAngles.max.rightElbow) / 2;
    const actualRom = Math.abs(avgMaxElbow - avgMinElbow);
    const score = scoreRomAgainstRange(actualRom, range);
    if (score !== null) scores.push(score);
  }

  // Check shoulder ROM if defined
  if (angleRanges.shoulder) {
    attempted += 1;
    const range = angleRanges.shoulder;
    const avgMinShoulder = (repAngles.min.leftShoulder + repAngles.min.rightShoulder) / 2;
    const avgMaxShoulder = (repAngles.max.leftShoulder + repAngles.max.rightShoulder) / 2;
    const actualRom = Math.abs(avgMaxShoulder - avgMinShoulder);
    const score = scoreRomAgainstRange(actualRom, range);
    if (score !== null) scores.push(score);
  }

  // Check knee ROM if defined
  if (angleRanges.knee) {
    attempted += 1;
    const range = angleRanges.knee;
    const avgMinKnee = (repAngles.min.leftKnee + repAngles.min.rightKnee) / 2;
    const avgMaxKnee = (repAngles.max.leftKnee + repAngles.max.rightKnee) / 2;
    const actualRom = Math.abs(avgMaxKnee - avgMinKnee);
    const score = scoreRomAgainstRange(actualRom, range);
    if (score !== null) scores.push(score);
  }

  // Return average of all ROM scores, or 100 if no ranges defined
  if (scores.length === 0) {
    return { score: 100, degenerate: attempted > 0 };
  }
  return {
    score: scores.reduce((a, b) => a + b, 0) / scores.length,
    degenerate: false,
  };
}

/**
 * Score an actualRom against a target AngleRange. Returns null when the range
 * is degenerate (max <= min) or when the inputs are non-finite — the caller
 * should skip the metric in either case rather than emit a misleading score.
 */
function scoreRomAgainstRange(actualRom: number, range: AngleRange): number | null {
  if (!Number.isFinite(actualRom)) return null;
  const targetRom = range.max - range.min;
  if (!Number.isFinite(targetRom) || targetRom <= 0) return null;
  const romPercentage = Math.min(1, actualRom / targetRom);
  return romPercentage * 100;
}

// =============================================================================
// Depth Score Calculation
// =============================================================================

/**
 * Calculate depth score based on how close to optimal position at the key point
 * @param repAngles The angles captured during the rep
 * @param angleRanges Target angle ranges for the workout
 * @returns An object with the score (0-100) and a `degenerate` flag that
 *   is true only when every scoring candidate returned null (degenerate
 *   AngleRange or non-finite input).
 */
function calculateDepthScore(
  repAngles: RepAngles,
  angleRanges: Record<string, AngleRange>,
  scoringMetrics?: ScoringMetricDefinition[]
): { score: number; degenerate: boolean } {
  const scores: number[] = [];
  let attempted = 0;

  if (scoringMetrics && scoringMetrics.length > 0) {
    for (const metric of scoringMetrics) {
      const range = angleRanges[metric.id];
      if (!range) continue;
      attempted += 1;

      const left = metric.extract(repAngles, 'left');
      const right = metric.extract(repAngles, 'right');

      if (!Number.isFinite(left.min) || !Number.isFinite(right.min)) {
        continue;
      }

      const avgMin = (left.min + right.min) / 2;
      const score = scoreDepthAgainstRange(avgMin, range);
      if (score !== null) scores.push(score);
    }

    if (scores.length === 0) {
      return { score: 100, degenerate: attempted > 0 };
    }
    return {
      score: scores.reduce((a, b) => a + b, 0) / scores.length,
      degenerate: false,
    };
  }

  // For movements like pull-ups and push-ups, depth is measured by minimum elbow angle
  if (angleRanges.elbow) {
    attempted += 1;
    const range = angleRanges.elbow;
    const avgMinElbow = (repAngles.min.leftElbow + repAngles.min.rightElbow) / 2;
    const score = scoreDepthAgainstRange(avgMinElbow, range);
    if (score !== null) scores.push(score);
  }

  // For squats/lunges, check hip and knee depth
  if (angleRanges.hip) {
    attempted += 1;
    const range = angleRanges.hip;
    const avgMinHip = (repAngles.min.leftHip + repAngles.min.rightHip) / 2;
    const score = scoreDepthAgainstRange(avgMinHip, range);
    if (score !== null) scores.push(score);
  }

  // Return average of all depth scores, or 100 if no ranges defined
  if (scores.length === 0) {
    return { score: 100, degenerate: attempted > 0 };
  }
  return {
    score: scores.reduce((a, b) => a + b, 0) / scores.length,
    degenerate: false,
  };
}

/**
 * Score the deviation from an AngleRange.optimal, capped at 100 and floored
 * at 0. Returns null on non-finite inputs or non-positive tolerance — the
 * caller should skip the metric instead of treating it as a perfect score.
 */
function scoreDepthAgainstRange(actual: number, range: AngleRange): number | null {
  if (!Number.isFinite(actual) || !Number.isFinite(range.optimal)) return null;
  if (!Number.isFinite(range.tolerance) || range.tolerance <= 0) return null;
  const deviation = Math.abs(actual - range.optimal);
  if (deviation <= range.tolerance) return 100;
  const penalty = (deviation - range.tolerance) * 2;
  return Math.max(0, 100 - penalty);
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
        warnWithTs(`[fqi-calculator] Fault condition failed for ${fault.id}`);
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
  const rom = calculateRomScore(repAngles, workoutDef.angleRanges, workoutDef.scoringMetrics);
  const depth = calculateDepthScore(repAngles, workoutDef.angleRanges, workoutDef.scoringMetrics);
  const { faultIds, totalPenalty } = detectFaults(repContext, workoutDef.faults);

  // A5: when every ROM and depth metric attempted to score against a
  // degenerate AngleRange and fell back to the 100 default, surface a
  // degenerate-meta flag and emit a FormTrackingError. We intentionally do
  // NOT change the default score — keeping 100 preserves current behavior
  // for this release; the meta flag is the new contract the UI can gate
  // on to render a "needs calibration" caveat.
  const allDegenerate = rom.degenerate && depth.degenerate;
  if (allDegenerate) {
    try {
      logError(
        createError(
          'form-tracking',
          FormTrackingErrorCode.FQI_DEGENERATE_RANGE,
          'All FQI ROM/depth metrics fell back to the 100 default due to degenerate angle ranges',
          {
            retryable: false,
            severity: 'warning',
            details: {
              workoutId: workoutDef.id,
              repNumber,
              scoringMetricCount: workoutDef.scoringMetrics?.length ?? 0,
            },
          }
        ),
        { feature: 'form-tracking', location: 'fqi-calculator.calculateFqi' }
      );
    } catch {
      // logError must never break scoring. Swallow any logger failures.
    }
    if (__DEV__) {
      warnWithTs(
        `[fqi-calculator] Degenerate range for workout ${workoutDef.id} rep ${repNumber}`
      );
    }
  }

  // Calculate weighted FQI
  // ROM and depth contribute positively, faults subtract
  const romContribution = rom.score * weights.rom;
  const depthContribution = depth.score * weights.depth;
  const faultContribution = (100 - totalPenalty) * weights.faults;

  const rawScore = romContribution + depthContribution + faultContribution;

  // Guard against NaN propagation from upstream calculations
  if (!Number.isFinite(rawScore)) {
    return {
      score: 0,
      romScore: Number.isFinite(rom.score) ? Math.round(rom.score) : 0,
      depthScore: Number.isFinite(depth.score) ? Math.round(depth.score) : 0,
      faultPenalty: totalPenalty,
      detectedFaults: faultIds,
      ...(allDegenerate ? { meta: { degenerate: true } } : {}),
    };
  }

  // Clamp to 0-100
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    score,
    romScore: Math.round(rom.score),
    depthScore: Math.round(depth.score),
    faultPenalty: totalPenalty,
    detectedFaults: faultIds,
    ...(allDegenerate ? { meta: { degenerate: true } } : {}),
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
