/**
 * Form-fatigue detector — watches FQI trajectory within a single session.
 * Flags fatigue when the user's last few sets have dropped materially from
 * their peak set FQI. Pure function; no I/O.
 *
 * The coach surface consumes this to decide whether to offer a lighter next
 * set, a longer rest, or a deload conversation. The detector is intentionally
 * conservative — we want to under-report, not over-report, to avoid
 * demoralizing the lifter with "fatigue" warnings on noise.
 */

// =============================================================================
// Types
// =============================================================================

export interface SetFqiPoint {
  setIndex: number;
  avgFqi: number;
}

export interface FatigueDetectorOptions {
  /** Minimum number of sets completed before we can fire. Default 3. */
  minSets?: number;
  /** Number of trailing sets to average for the "recent" window. Default 3. */
  windowSize?: number;
  /**
   * Threshold percentage drop from peak FQI that triggers a fatigue flag.
   * Expressed as 0–1 (0.15 = 15%). Default 0.15.
   */
  dropThreshold?: number;
}

export type FatigueSeverity = 'none' | 'low' | 'moderate' | 'high';

export interface FatigueAssessment {
  severity: FatigueSeverity;
  peakFqi: number | null;
  recentAvgFqi: number | null;
  /** Fractional drop from peak (0–1). `null` if not enough data. */
  dropRatio: number | null;
  /** Machine-readable reason for debugging / telemetry. */
  reason:
    | 'not_enough_sets'
    | 'no_drop_detected'
    | 'drop_below_threshold'
    | 'moderate_drop'
    | 'severe_drop';
  /** Human-facing suggestion the caller can surface to the user. */
  recommendation: string;
}

// =============================================================================
// Core
// =============================================================================

/**
 * Evaluate per-set FQI trajectory and return a fatigue assessment.
 *
 * Inputs are assumed to already be cleaned — pass the per-set average FQI,
 * not rep-level values. The detector treats `null`/non-finite values as
 * sets that should be ignored (skipped set with no reps scored).
 */
export function detectFormFatigue(
  sets: SetFqiPoint[],
  options: FatigueDetectorOptions = {},
): FatigueAssessment {
  const minSets = options.minSets ?? 3;
  const windowSize = options.windowSize ?? 3;
  const dropThreshold = options.dropThreshold ?? 0.15;

  const valid = sets.filter((s) => Number.isFinite(s.avgFqi));

  if (valid.length < minSets) {
    return {
      severity: 'none',
      peakFqi: null,
      recentAvgFqi: null,
      dropRatio: null,
      reason: 'not_enough_sets',
      recommendation:
        'Log a few more sets — we need at least a baseline before we can spot fatigue.',
    };
  }

  const peakFqi = valid.reduce((max, s) => (s.avgFqi > max ? s.avgFqi : max), valid[0].avgFqi);
  const trailing = valid.slice(-windowSize);
  const recentAvgFqi =
    trailing.reduce((sum, s) => sum + s.avgFqi, 0) / trailing.length;
  const latestFqi = valid[valid.length - 1].avgFqi;
  const dropRatio = peakFqi > 0 ? (peakFqi - recentAvgFqi) / peakFqi : 0;

  // When the latest set IS the peak, trajectory is improving — no fatigue,
  // even if earlier sets dragged the windowed average below the peak.
  if (latestFqi >= peakFqi || dropRatio <= 0) {
    return {
      severity: 'none',
      peakFqi,
      recentAvgFqi,
      dropRatio: 0,
      reason: 'no_drop_detected',
      recommendation: 'Form is holding — keep going.',
    };
  }

  if (dropRatio < dropThreshold) {
    return {
      severity: 'low',
      peakFqi,
      recentAvgFqi,
      dropRatio,
      reason: 'drop_below_threshold',
      recommendation:
        'Minor dip — nothing to worry about. Stay focused on the cue from your last set.',
    };
  }

  if (dropRatio < dropThreshold * 2) {
    return {
      severity: 'moderate',
      peakFqi,
      recentAvgFqi,
      dropRatio,
      reason: 'moderate_drop',
      recommendation:
        'Form is starting to slip. Take an extra 30–60s of rest and dial the next set back to ~90% of the weight that felt best.',
    };
  }

  return {
    severity: 'high',
    peakFqi,
    recentAvgFqi,
    dropRatio,
    reason: 'severe_drop',
    recommendation:
      'Form has degraded meaningfully this session. Call this your last working set and save the rest for a fresher day.',
  };
}
