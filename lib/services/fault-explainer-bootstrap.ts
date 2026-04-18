/**
 * One-shot installer that swaps the default static FaultExplainer for the
 * Edge Function–backed runner at app init. Import this module for side
 * effect from `app/_layout.tsx` so the runner is live before any
 * `useFaultSynthesis` consumer renders.
 *
 * The Edge runner already falls back to the static explainer on any
 * failure, so installing it is safe even when the Edge Function is not
 * yet deployed.
 */

import { setFaultExplainerRunner } from './fault-explainer';
import { createEdgeFaultExplainer } from './fault-explainer-edge';
import {
  createCachingFaultExplainer,
  type CacheStats,
  type CachingFaultExplainer,
} from './fault-explainer-cache';

const cachingRunner: CachingFaultExplainer = createCachingFaultExplainer(
  createEdgeFaultExplainer(),
);

setFaultExplainerRunner(cachingRunner);

/** Snapshot of the live cache counters. Returns null if bootstrap hasn't run. */
export function getGlobalSynthesisCacheStats(): CacheStats {
  return cachingRunner.stats();
}

/** Clears the global synthesis cache. Useful from debug panels and tests. */
export function clearGlobalSynthesisCache(): void {
  cachingRunner.clear();
}
