/**
 * Pure rate-limiter cleanup helpers for the coach-gemma edge function.
 *
 * The Deno handler in `./index.ts` cannot be imported by Bun/Jest (Deno-only
 * `https://` imports), so we extract the cleanup primitives into this pure
 * module and assert against them with a standard Jest test. `index.ts`
 * continues to own the shared module-scope `rateLimitMap` / interval id and
 * delegates to these helpers so behavior stays in sync.
 *
 * Closes #557 finding B1: lower request-based cleanup cadence from 500 to
 * 100 and add a time-based `setInterval` that fires every 30s regardless
 * of traffic, evicting entries whose window ended >120s ago.
 */
export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface CleanupConfig {
  /** 2 × RATE_LIMIT_WINDOW_MS — entries older than this are always safe to drop. */
  staleAgeMs: number;
  /** Hard cap on map size before emergency LRU eviction by windowStart. */
  maxEntries: number;
}

/**
 * One cleanup pass. Drops stale entries, then enforces the hard cap by
 * evicting oldest-by-windowStart if we're still over `maxEntries`. Does
 * not mutate the semantics of the rate limiter itself (a dropped entry
 * will simply be re-created on the user's next request).
 */
export function cleanupRateLimitMap(
  map: Map<string, RateLimitEntry>,
  now: number,
  config: CleanupConfig,
): void {
  // Pass 1: drop stale entries whose window ended long enough ago that
  // `isRateLimited` would have reset them anyway.
  for (const [userId, entry] of map.entries()) {
    if (now - entry.windowStart > config.staleAgeMs) {
      map.delete(userId);
    }
  }

  // Pass 2: if we're still over the hard cap (pathological burst, e.g. a
  // DDoS spraying unique user ids), evict the oldest entries by
  // windowStart so memory is strictly bounded.
  if (map.size > config.maxEntries) {
    const overBy = map.size - config.maxEntries;
    const sorted = Array.from(map.entries()).sort(
      (a, b) => a[1].windowStart - b[1].windowStart,
    );
    for (let i = 0; i < overBy && i < sorted.length; i += 1) {
      map.delete(sorted[i][0]);
    }
  }
}

/** Tunables kept here so the test doesn't have to re-derive them. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const STALE_AGE_MS = RATE_LIMIT_WINDOW_MS * 2;
export const MAX_RATE_LIMIT_ENTRIES = 10_000;
export const CLEANUP_EVERY_N = 100;
export const CLEANUP_INTERVAL_MS = 30_000;
