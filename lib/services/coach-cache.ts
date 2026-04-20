// Response cache for the coach service (#465 Item 3).
//
// Why we ship this:
// - Auto-debrief (#461) replays the same prompt+context every time the user
//   reopens the post-workout screen; that's a guaranteed cache hit.
// - Repeat user questions ("plan my push day") burn through Gemma's daily
//   free quota; an AsyncStorage TTL cache lets us serve those instantly.
//
// Design:
// - Cache key = FNV-1a(JSON.stringify({prompt: lastUser, ctx, shaper}))
// - Storage backend = AsyncStorage (works on RN + web fallback)
// - In-flight dedup map: simultaneous identical requests share one promise
// - Shaper flag (Item 5) is folded into the cache key so a shaped vs.
//   unshaped response never collides.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoachContext, CoachMessage } from './coach-service';

export interface CoachCacheEntry {
  /** Wall-clock ms when this entry was written. */
  ts: number;
  /** TTL in ms; expired when `now > ts + ttlMs`. */
  ttlMs: number;
  /** The cached coach response. */
  message: CoachMessage;
  /** True if the message is the post-shaper text (Item 5). */
  shaped?: boolean;
}

export interface WithCacheOptions {
  /** True when the upstream call has already shaped the response (Item 5). */
  shaper?: boolean;
}

const CACHE_KEY_PREFIX = 'coach:cache:v1:';

/** Map of in-flight cache keys -> promise so simultaneous identical calls dedup. */
const inFlightMap = new Map<string, Promise<CoachMessage>>();

/**
 * Compute a stable cache key for a `(messages, context, shaper)` triple via
 * FNV-1a hashing. We hash the JSON serialization of the last user message,
 * the focus + sessionId from context, and the shaper flag - this is enough
 * to differentiate "plan my push day" from "plan my pull day" while ignoring
 * volatile fields like profile.email or timestamps.
 *
 * Exported so callers (and tests) can pre-compute keys for cache busting.
 */
export function getCacheKey(
  messages: CoachMessage[],
  context?: CoachContext,
  opts?: WithCacheOptions
): string {
  const lastUser = [...messages]
    .reverse()
    .find((m) => m.role === 'user')?.content ?? '';
  const stable = JSON.stringify({
    prompt: lastUser,
    focus: context?.focus ?? null,
    sessionId: context?.sessionId ?? null,
    shaper: opts?.shaper ? 1 : 0,
  });
  return CACHE_KEY_PREFIX + fnv1a(stable);
}

/** FNV-1a 32-bit hash, returned as a base36 string for compactness. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // imul keeps the multiplication within 32-bit signed range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned + base36 for a short stable id.
  return (hash >>> 0).toString(36);
}

/** Read a cached entry; returns null on miss / expiry / corruption. */
export async function readCache(key: string): Promise<CoachCacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoachCacheEntry;
    if (typeof parsed?.ts !== 'number' || typeof parsed?.ttlMs !== 'number') {
      return null;
    }
    if (Date.now() > parsed.ts + parsed.ttlMs) {
      // Best-effort cleanup so a long-lived cache doesn't leak entries.
      AsyncStorage.removeItem(key).catch(() => undefined);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Write a cached entry; failures are swallowed (cache is best-effort). */
export async function writeCache(
  key: string,
  message: CoachMessage,
  ttlMs: number,
  opts?: WithCacheOptions
): Promise<void> {
  if (ttlMs <= 0) return;
  const entry: CoachCacheEntry = {
    ts: Date.now(),
    ttlMs,
    message,
    shaped: opts?.shaper,
  };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // No-op: cache writes must never break the user-facing call.
  }
}

/** Remove a cached entry. Useful for tests + manual invalidation. */
export async function clearCacheKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // No-op
  }
}

/**
 * Wrap a coach producer with a TTL + dedup cache. If a cached entry exists and
 * is still fresh, return it. Otherwise call the producer; if another caller
 * with the same key is already in flight, await its promise instead.
 */
export async function withCoachCache(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  ttlMs: number,
  produce: () => Promise<CoachMessage>,
  opts?: WithCacheOptions
): Promise<CoachMessage> {
  // ttlMs <= 0 means caller explicitly disabled caching - bypass entirely.
  if (ttlMs <= 0) return produce();

  const key = getCacheKey(messages, context, opts);

  const cached = await readCache(key);
  if (cached) return cached.message;

  const inFlight = inFlightMap.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const message = await produce();
      await writeCache(key, message, ttlMs, opts);
      return message;
    } finally {
      inFlightMap.delete(key);
    }
  })();
  inFlightMap.set(key, promise);
  return promise;
}

/** Test helper: clear the in-flight dedup map between tests. */
export function __resetInFlightMapForTest(): void {
  inFlightMap.clear();
}
