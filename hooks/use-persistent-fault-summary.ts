/**
 * usePersistentFaultSummary
 *
 * Combines `fault-heatmap-data-loader` with `fault-drill-aggregator`
 * to expose the top-N persistent faults across the last 7 days as a
 * React hook.
 *
 * Flag-gated by `EXPO_PUBLIC_FAULT_DRILL_GEMMA`: when disabled the
 * hook immediately resolves to an empty summary and never touches the
 * network. This is the primary fail-closed gate for the fault-drill
 * pipeline — the CTA, the drill dispatch, and any downstream surfaces
 * all bail when `topFaults.length === 0`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DrillFaultInput } from '@/lib/services/coach-drill-explainer';
import {
  aggregatePersistentFaults,
  type AggregatePersistentFaultsOptions,
} from '@/lib/services/fault-drill-aggregator';
import { isFaultDrillGemmaEnabled } from '@/lib/services/fault-drill-gemma-flag';
import {
  loadFaultHeatmapData,
  type FaultHeatmapSnapshot,
} from '@/lib/services/fault-heatmap-data-loader';

export interface UsePersistentFaultSummaryOptions extends AggregatePersistentFaultsOptions {
  /**
   * Override the loader — used by tests so we don't have to jest.mock
   * the supabase client just to exercise the hook shape.
   */
  loader?: () => Promise<FaultHeatmapSnapshot>;
  /**
   * When true, skip the flag check and always run. Only used by tests;
   * production call sites should honour the flag.
   */
  bypassFlag?: boolean;
}

export interface UsePersistentFaultSummaryResult {
  /** Top-N persistent faults (may be empty when flag off or no data). */
  topFaults: DrillFaultInput[];
  /** Full snapshot — useful for the heatmap modal CTA gating. */
  snapshot: FaultHeatmapSnapshot | null;
  loading: boolean;
  error: Error | null;
  /** Re-runs the loader. No-op when the flag is off. */
  refresh: () => void;
  /** True when the master flag is on — exposed for CTA visibility checks. */
  enabled: boolean;
}

const EMPTY_SNAPSHOT: FaultHeatmapSnapshot = {
  cells: [],
  days: [],
  totals: [],
  lastSessionId: null,
};

export function usePersistentFaultSummary(
  options: UsePersistentFaultSummaryOptions = {},
): UsePersistentFaultSummaryResult {
  const { loader, bypassFlag, topN, minCount, displayNames } = options;

  const enabled = bypassFlag === true ? true : isFaultDrillGemmaEnabled();

  const [snapshot, setSnapshot] = useState<FaultHeatmapSnapshot | null>(null);
  const [topFaults, setTopFaults] = useState<DrillFaultInput[]>([]);
  const [loading, setLoading] = useState<boolean>(() => enabled);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Latest options land in a ref so `runLoader`'s identity only depends
  // on `enabled` + `loader` — callers can pass inline-constructed
  // `displayNames` objects without triggering a refetch loop.
  const aggregatorOptsRef = useRef<AggregatePersistentFaultsOptions>({
    topN,
    minCount,
    displayNames,
  });
  aggregatorOptsRef.current = { topN, minCount, displayNames };

  const runLoader = useCallback(async () => {
    if (!enabled) {
      setSnapshot(EMPTY_SNAPSHOT);
      setTopFaults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const source = loader ?? loadFaultHeatmapData;
      const next = await source();
      if (!mountedRef.current) return;
      setSnapshot(next);
      setTopFaults(aggregatePersistentFaults(next.totals, aggregatorOptsRef.current));
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoading(false);
      setError(err instanceof Error ? err : new Error('persistent fault summary load failed'));
    }
  }, [enabled, loader]);

  useEffect(() => {
    void runLoader();
  }, [runLoader]);

  return {
    topFaults,
    snapshot,
    loading,
    error,
    enabled,
    refresh: () => void runLoader(),
  };
}
