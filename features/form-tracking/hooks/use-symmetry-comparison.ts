/**
 * useSymmetryComparison
 *
 * Loads bilateral angle deltas from `lib/services/rep-analytics.ts` and
 * computes per-rep asymmetry percentages for the SymmetryComparatorCard.
 *
 * Asymmetry = `abs(L - R) / max(L, R) * 100`. The card overlays a 15%
 * threshold line (anything above is flagged red).
 *
 * Edge cases handled here so the component stays presentational:
 *   - One-sided tracking loss (left or right is 0 / NaN) → emits
 *     `asymmetryPct = null` for that rep so the chart can render a gap.
 *   - Bilateral row with both sides 0 → asymmetry = 0 (perfect, not div-by-0).
 *   - PR #444 not on main → `getBilateralRepHistory` returns `[]` → hook
 *     emits an empty series with `isFallback: true`.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  getBilateralRepHistory,
  type BilateralRepRow,
} from '@/lib/services/rep-analytics';

export const SYMMETRY_THRESHOLD_PCT = 15;

export interface SymmetryDatum {
  repNumber: number;
  leftAngleDeg: number;
  rightAngleDeg: number;
  /** Asymmetry percentage 0-100; `null` for unrecoverable bilateral data. */
  asymmetryPct: number | null;
  joint?: string;
}

export interface UseSymmetryComparisonReturn {
  series: SymmetryDatum[];
  /** Empty result was returned — typically the `rep-analytics` stub. */
  isFallback: boolean;
  isLoading: boolean;
  error: Error | null;
}

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Pure helper — exposed for unit tests.
 */
export function computeAsymmetryPct(left: number, right: number): number | null {
  if (!isFiniteNumber(left) || !isFiniteNumber(right)) return null;
  if (left === 0 && right === 0) return 0;
  if (left <= 0 || right <= 0) return null;
  const denom = Math.max(left, right);
  if (denom === 0) return null;
  const pct = (Math.abs(left - right) / denom) * 100;
  return Number(pct.toFixed(2));
}

function projectRow(row: BilateralRepRow): SymmetryDatum {
  return {
    repNumber: row.repNumber,
    leftAngleDeg: row.leftAngleDeg,
    rightAngleDeg: row.rightAngleDeg,
    asymmetryPct: computeAsymmetryPct(row.leftAngleDeg, row.rightAngleDeg),
    joint: row.joint,
  };
}

export function useSymmetryComparison(
  sessionId: string,
  limit = 50
): UseSymmetryComparisonReturn {
  const [rows, setRows] = useState<BilateralRepRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const data = await getBilateralRepHistory(sessionId, limit);
        if (cancelled) return;
        setRows(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setRows([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, limit]);

  const series = useMemo(() => rows.map(projectRow), [rows]);
  const isFallback = !isLoading && rows.length === 0 && !error;

  return { series, isFallback, isLoading, error };
}

export default useSymmetryComparison;
