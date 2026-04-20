/**
 * useFaultExplanations
 *
 * React hook that wraps the `fault-explainability` service with a
 * component-scoped memoisation cache. Keys are `(repId, faultId)` so the
 * same rep's rationale is only computed once per mount even if the
 * consuming chip list re-renders.
 *
 * The cache is a simple `Map` stored in a `useRef` — it survives the
 * component's lifetime but is dropped on unmount. For persistence across
 * screens, callers can promote the cache to a context.
 */
import { useCallback, useMemo, useRef } from 'react';

import type { RepContext } from '@/lib/types/workout-definitions';
import {
  generateFaultExplanationDetail,
  renderExplanation,
  type FaultExplanation,
} from '@/lib/services/fault-explainability';

// =============================================================================
// Types
// =============================================================================

export interface UseFaultExplanationsResult {
  /**
   * Resolve (or compute + cache) the structured explanation for a fault on
   * a specific rep. `repId` is any stable identifier — we recommend the
   * `session_set_id` suffixed with `:<repNumber>`.
   */
  getExplanation: (
    repId: string,
    faultId: string,
    rep: RepContext,
    workoutId: string,
  ) => FaultExplanation;

  /**
   * Convenience wrapper returning the flattened display string.
   */
  getExplanationText: (
    repId: string,
    faultId: string,
    rep: RepContext,
    workoutId: string,
  ) => string;

  /** Clear the in-memory cache (useful when switching sessions). */
  clearCache: () => void;

  /** Current cache size (primarily for testing / debugging). */
  readonly cacheSize: number;
}

// =============================================================================
// Internal helpers
// =============================================================================

function cacheKey(repId: string, faultId: string): string {
  return `${repId}::${faultId}`;
}

// =============================================================================
// Hook
// =============================================================================

export function useFaultExplanations(): UseFaultExplanationsResult {
  // `useRef` keeps a stable reference across renders. We intentionally
  // mutate the underlying Map rather than replacing it so consumers don't
  // have to deal with "did the Map change" memo invalidation.
  const cacheRef = useRef<Map<string, FaultExplanation>>(new Map());

  const getExplanation = useCallback(
    (
      repId: string,
      faultId: string,
      rep: RepContext,
      workoutId: string,
    ): FaultExplanation => {
      const key = cacheKey(repId, faultId);
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      const detail = generateFaultExplanationDetail(faultId, rep, workoutId);
      cacheRef.current.set(key, detail);
      return detail;
    },
    [],
  );

  const getExplanationText = useCallback(
    (
      repId: string,
      faultId: string,
      rep: RepContext,
      workoutId: string,
    ): string => renderExplanation(getExplanation(repId, faultId, rep, workoutId)),
    [getExplanation],
  );

  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  return useMemo<UseFaultExplanationsResult>(
    () => ({
      getExplanation,
      getExplanationText,
      clearCache,
      get cacheSize() {
        return cacheRef.current.size;
      },
    }),
    [getExplanation, getExplanationText, clearCache],
  );
}
