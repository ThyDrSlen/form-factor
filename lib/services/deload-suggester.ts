/**
 * Cross-session deload suggester.
 *
 * Looks at FQI across the user's recent sessions on the same exercise.
 * If form has been sliding for several sessions in a row, recommend a
 * deload week at reduced intensity. Pure function.
 */

export interface SessionFqiPoint {
  sessionId: string;
  /** ISO timestamp. Only used for ordering + human-readable logs. */
  completedAt: string;
  avgFqi: number | null;
}

export interface DeloadSuggesterOptions {
  /** How many trailing sessions count as "recent". Default 3. */
  windowSize?: number;
  /**
   * Minimum fractional drop from the peak FQI in the window that triggers a
   * deload (0–1). Default 0.08 (8%).
   */
  dropThreshold?: number;
  /**
   * Minimum number of sessions in history before the suggester can fire.
   * Default 4 (so we have room for a peak + a declining trend).
   */
  minSessions?: number;
}

export type DeloadRecommendation =
  | 'continue'
  | 'hold_intensity'
  | 'deload_week';

export interface DeloadAssessment {
  recommendation: DeloadRecommendation;
  /** 0.70–1.0 scale. E.g. 0.80 = "run next week at 80%". `null` when N/A. */
  suggestedIntensityPct: number | null;
  /**
   * Fractional drop from the peak of the window to the most recent session.
   * `null` when not enough history.
   */
  peakToLatestDrop: number | null;
  /** Machine-readable reason for debugging / telemetry. */
  reason:
    | 'not_enough_history'
    | 'form_stable_or_improving'
    | 'mild_decline'
    | 'progressive_decline';
  /** Human-facing explanation the caller can surface to the user. */
  explanation: string;
}

/**
 * Evaluate recent session FQI and decide whether to suggest a deload.
 *
 * Assumes sessions are passed in chronological order (oldest → newest).
 * Sessions with `null` avgFqi are ignored.
 */
export function suggestDeload(
  sessions: SessionFqiPoint[],
  options: DeloadSuggesterOptions = {},
): DeloadAssessment {
  const windowSize = options.windowSize ?? 3;
  const dropThreshold = options.dropThreshold ?? 0.08;
  const minSessions = options.minSessions ?? 4;

  const valid = sessions.filter(
    (s): s is SessionFqiPoint & { avgFqi: number } =>
      s.avgFqi != null && Number.isFinite(s.avgFqi),
  );

  if (valid.length < minSessions) {
    return {
      recommendation: 'continue',
      suggestedIntensityPct: null,
      peakToLatestDrop: null,
      reason: 'not_enough_history',
      explanation:
        'Not enough session history for a deload call yet — keep logging sessions.',
    };
  }

  const windowStart = Math.max(0, valid.length - windowSize);
  const window = valid.slice(windowStart);
  const peakFqi = window.reduce((max, s) => (s.avgFqi > max ? s.avgFqi : max), window[0].avgFqi);
  const latest = window[window.length - 1].avgFqi;
  const drop = peakFqi > 0 ? (peakFqi - latest) / peakFqi : 0;

  if (drop <= 0) {
    return {
      recommendation: 'continue',
      suggestedIntensityPct: null,
      peakToLatestDrop: 0,
      reason: 'form_stable_or_improving',
      explanation: 'Form is stable or improving — no deload needed.',
    };
  }

  if (drop < dropThreshold) {
    return {
      recommendation: 'continue',
      suggestedIntensityPct: null,
      peakToLatestDrop: drop,
      reason: 'form_stable_or_improving',
      explanation:
        'Minor wobble in recent form — within normal session-to-session variance.',
    };
  }

  // Check whether the decline is progressive (each of the last `windowSize`
  // sessions is worse than the one before it). That's the strongest deload signal.
  let progressive = true;
  for (let i = 1; i < window.length; i += 1) {
    if (window[i].avgFqi > window[i - 1].avgFqi) {
      progressive = false;
      break;
    }
  }

  if (!progressive) {
    return {
      recommendation: 'hold_intensity',
      suggestedIntensityPct: 1,
      peakToLatestDrop: drop,
      reason: 'mild_decline',
      explanation:
        'Form has slipped a bit but not steadily. Hold your current intensity; revisit next week.',
    };
  }

  return {
    recommendation: 'deload_week',
    suggestedIntensityPct: drop >= dropThreshold * 2 ? 0.7 : 0.8,
    peakToLatestDrop: drop,
    reason: 'progressive_decline',
    explanation:
      'Form has declined across your last few sessions. Run a deload week at reduced intensity to let your movement quality catch back up.',
  };
}
