/**
 * Caching wrapper around any FaultExplainer. Identical fault clusters
 * within a session are very common — a user's 3rd rep of the set usually
 * fires the same fault ids as rep 2 — so caching at the runner boundary
 * cuts Gemini cost and tail latency dramatically.
 *
 * Cache key: `${exerciseId}::${sortedFaultIds}::${historySignature}`.
 * setContext is intentionally excluded: the synthesis copy should be
 * robust to rep/set/rpe variation, and including it would destroy hit
 * rate. Recent-history occurrence counts ARE included, so the key
 * invalidates when personalization data changes.
 *
 * Non-persistent — lives only for the process lifetime. Pair with a
 * SQLite cache in a later iteration if we want cross-launch reuse.
 */

import type {
  FaultExplainer,
  FaultSynthesisInput,
  FaultSynthesisOutput,
} from './fault-explainer';

export interface CachingFaultExplainerOptions {
  /** Maximum cached entries. Oldest (least-recently-used) are evicted. */
  maxEntries?: number;
  /** TTL in ms; entries older than this are treated as misses. */
  ttlMs?: number;
  /** Override for tests. */
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  output: FaultSynthesisOutput;
  storedAt: number;
}

function buildCacheKey(input: FaultSynthesisInput): string {
  const sortedFaults = [...input.faultIds].sort().join('|');
  const historySig =
    input.recentHistory && input.recentHistory.length > 0
      ? [...input.recentHistory]
          .sort((a, b) => a.faultId.localeCompare(b.faultId))
          .map((h) => `${h.faultId}:${h.occurrencesInLastNSessions}`)
          .join(',')
      : '';
  return `${input.exerciseId}::${sortedFaults}::${historySig}`;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

export interface CachingFaultExplainer extends FaultExplainer {
  /** Returns the number of cached entries currently held. */
  size(): number;
  /** Snapshot of cache counters since the wrapper was created. */
  stats(): CacheStats;
  /** Clears the cache — useful for tests and user-triggered invalidation. */
  clear(): void;
}

export function createCachingFaultExplainer(
  inner: FaultExplainer,
  options: CachingFaultExplainerOptions = {},
): CachingFaultExplainer {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  function isFresh(entry: CacheEntry): boolean {
    if (ttlMs === 0) return true;
    return now() - entry.storedAt <= ttlMs;
  }

  function touch(key: string, entry: CacheEntry): void {
    cache.delete(key);
    cache.set(key, entry);
  }

  return {
    async synthesize(input: FaultSynthesisInput): Promise<FaultSynthesisOutput> {
      if (input.faultIds.length === 0) return inner.synthesize(input);

      const key = buildCacheKey(input);
      const existing = cache.get(key);
      if (existing && isFresh(existing)) {
        hits += 1;
        touch(key, existing);
        return existing.output;
      }
      if (existing) cache.delete(key);
      misses += 1;

      const output = await inner.synthesize(input);
      cache.set(key, { output, storedAt: now() });

      while (cache.size > maxEntries) {
        const oldestKey = cache.keys().next().value;
        if (!oldestKey) break;
        cache.delete(oldestKey);
        evictions += 1;
      }

      return output;
    },
    size() {
      return cache.size;
    },
    stats() {
      return { hits, misses, evictions, size: cache.size };
    },
    clear() {
      cache.clear();
      hits = 0;
      misses = 0;
      evictions = 0;
    },
  };
}
