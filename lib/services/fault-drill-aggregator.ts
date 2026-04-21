/**
 * fault-drill-aggregator
 *
 * Takes a `FaultHeatmapSnapshot` and produces the top-N persistent
 * faults, each with a `DrillFaultInput` payload ready to ship into
 * `coach-drill-explainer.explainDrill(faults[…])`.
 *
 * Pure — zero IO. Aggregator shape is intentionally small so a caller
 * can compose it after any aggregator (`loadFaultHeatmapData`, a
 * session-scoped loader, a manual fixture) that yields `FaultTotal[]`.
 *
 * Severity mapping: the heatmap / rep-analytics code buckets faults on
 * a 0-2 scale keyed by regex, but the drill-explainer expects 1-3.
 * We promote by +1 so a regex-minor fault becomes drill-severity 1
 * and a regex-major becomes 3 — matching the "minor/moderate/major"
 * copy in `coach-drill-explainer.summarizeFaults`.
 */

import type { DrillFaultInput } from '@/lib/services/coach-drill-explainer';
import type { FaultTotal } from '@/lib/services/fault-heatmap-data-loader';

/** Default top-N persistent faults to surface. */
export const DEFAULT_TOP_N = 3;

/** Minimum total occurrence count for a fault to be considered persistent. */
export const DEFAULT_MIN_COUNT = 2;

export interface AggregatePersistentFaultsOptions {
  /** Maximum number of faults to return. Defaults to 3. */
  topN?: number;
  /**
   * Minimum total count a fault must have to be considered persistent.
   * Defaults to 2 — one-off detections are noisy and rarely worth a
   * round-trip to the drill explainer.
   */
  minCount?: number;
  /**
   * Optional display-name lookup so the drill explainer prompt can
   * reference a human-readable label. When missing the explainer falls
   * back to prettifying the code (`knees_in` → `knees in`).
   */
  displayNames?: Record<string, string>;
}

const MAJOR_RE = /collapse|valgus|lumbar|extreme|severe|hyper/i;
const MODERATE_RE = /shallow|forward|shift|asymmetry/i;

/**
 * Map a fault code to drill-explainer severity (1..3).
 */
export function severityForFault(code: string): 1 | 2 | 3 {
  if (MAJOR_RE.test(code)) return 3;
  if (MODERATE_RE.test(code)) return 2;
  return 1;
}

/**
 * Titleize a fault code for the `displayName` field when no explicit
 * label was supplied. Matches the thumbnail component's formatter so
 * the CTA label stays consistent.
 */
export function prettifyFaultCode(code: string): string {
  const parts = code.replace(/_/g, ' ').trim().split(/\s+/);
  return parts
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ');
}

/**
 * Reduce a list of per-fault totals (as emitted by
 * `fault-heatmap-data-loader.aggregateFaultHeatmap`) into a top-N list
 * of drill-ready payloads.
 *
 * - Drops faults below `minCount`.
 * - Drops faults with a missing / non-string code or non-positive count.
 * - Sorts by count desc, then by code asc (stable).
 */
export function aggregatePersistentFaults(
  totals: readonly FaultTotal[],
  options: AggregatePersistentFaultsOptions = {},
): DrillFaultInput[] {
  const topN = Math.max(0, Math.floor(options.topN ?? DEFAULT_TOP_N));
  const minCount = Math.max(1, Math.floor(options.minCount ?? DEFAULT_MIN_COUNT));
  const displayNames = options.displayNames ?? {};

  const filtered = totals
    .filter((t): t is FaultTotal =>
      t != null
      && typeof t.faultId === 'string'
      && t.faultId.length > 0
      && typeof t.count === 'number'
      && Number.isFinite(t.count)
      && t.count >= minCount,
    )
    .slice()
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.faultId.localeCompare(b.faultId);
    })
    .slice(0, topN);

  return filtered.map(({ faultId, count }) => ({
    code: faultId,
    displayName: displayNames[faultId] ?? prettifyFaultCode(faultId),
    count,
    severity: severityForFault(faultId),
  }));
}
