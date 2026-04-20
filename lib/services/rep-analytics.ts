/**
 * Rep Analytics Service — minimal stub
 *
 * TODO(#444): merge with PR #444 canonical implementation on land.
 *
 * The canonical service in PR #444 will own bilateral angle aggregation,
 * rep-over-rep diff series, and the keyframe extractor that feeds the ghost
 * replay trail. This stub is shipped alongside #464 so the symmetry
 * comparator card has a stable import path that does not break the build
 * when #444 is not yet on `main`.
 *
 * Contract (kept intentionally narrow):
 *   - `getBilateralRepHistory(sessionId, limit)` → array of bilateral angle
 *     deltas keyed by rep number. Returns `[]` when no data is available so
 *     consumers can render an empty-state card without throwing.
 *
 * When #444 lands, replace this file with the canonical implementation. The
 * symmetry consumer hook (`use-symmetry-comparison`) intentionally does not
 * import any types beyond `BilateralRepRow` to keep the merge low-conflict.
 */

export interface BilateralRepRow {
  /** Rep number within the current set (1-indexed). */
  repNumber: number;
  /** Left-side angle (deg) at the rep boundary. */
  leftAngleDeg: number;
  /** Right-side angle (deg) at the rep boundary. */
  rightAngleDeg: number;
  /**
   * Optional joint label (e.g., "elbow", "knee") so the comparator can group
   * deltas by joint when the source set tracked multiple bilateral pairs.
   */
  joint?: string;
}

/**
 * Stub fallback — returns an empty history so the comparator card renders an
 * empty state. PR #444's canonical implementation will read from the
 * `rep_features` Supabase table and project bilateral angle pairs.
 */
export async function getBilateralRepHistory(
  _sessionId: string,
  _limit = 50
): Promise<BilateralRepRow[]> {
  return [];
}

/**
 * Synchronous stub for the same contract — used by tests + storybook
 * fixtures. PR #444 should preserve this signature.
 */
export function getBilateralRepHistorySync(
  _sessionId: string,
  _limit = 50
): BilateralRepRow[] {
  return [];
}
