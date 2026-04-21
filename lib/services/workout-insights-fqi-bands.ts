/**
 * workout-insights-fqi-bands
 *
 * Pure helper for the workout-insights modal. Maps a numeric
 * session-average FQI (Form Quality Index, 0-100) to a human-readable
 * band label plus a color code suitable for text rendering.
 *
 * Band thresholds (matches the worklog's GAP-4 acceptance):
 *   >= 85      → Excellent
 *   70 .. <85  → Good
 *   50 .. <70  → Fair
 *   <50        → Poor
 *
 * When the score is missing / NaN the helper returns a neutral label
 * so callers can still render the row without a conditional branch.
 */

export type FqiBand = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface FqiBandInfo {
  /** Lowercase key (useful for analytics + styling keys). */
  band: FqiBand;
  /** Capitalised label for direct display ('Excellent', 'Good', ...). */
  label: string;
  /**
   * Suggested foreground color for the label text. Keeps the visual
   * treatment consistent with the existing FqiGauge / FormQualityBadge
   * palette used elsewhere on the workouts tab.
   */
  color: string;
}

export function getFqiBand(score: number | null | undefined): FqiBandInfo {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return { band: 'unknown', label: 'Not available', color: '#9AACD1' };
  }
  if (score >= 85) {
    return { band: 'excellent', label: 'Excellent', color: '#3CC8A9' };
  }
  if (score >= 70) {
    return { band: 'good', label: 'Good', color: '#4C8CFF' };
  }
  if (score >= 50) {
    return { band: 'fair', label: 'Fair', color: '#F59E0B' };
  }
  return { band: 'poor', label: 'Poor', color: '#EF4444' };
}
