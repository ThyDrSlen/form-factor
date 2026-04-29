/**
 * Unit coverage for the rate-limiter cleanup primitives used by
 * `supabase/functions/coach-gemma/index.ts` (#557 finding B1).
 *
 * These tests drive the pure helpers in `./cleanup.ts` directly because the
 * Deno edge handler can't be imported by Jest (Deno-only URL imports). The
 * handler delegates to the same helpers, so behavior stays in sync.
 */
import {
  CLEANUP_EVERY_N,
  CLEANUP_INTERVAL_MS,
  MAX_RATE_LIMIT_ENTRIES,
  RATE_LIMIT_WINDOW_MS,
  STALE_AGE_MS,
  cleanupRateLimitMap,
  type RateLimitEntry,
} from './cleanup';

describe('coach-gemma cleanup', () => {
  const config = {
    staleAgeMs: STALE_AGE_MS,
    maxEntries: MAX_RATE_LIMIT_ENTRIES,
  };

  it('lowers request-based cleanup cadence to 100', () => {
    // Sanity guard: if someone raises this back above 100 we want the test
    // to remind them that finding B1 explicitly asked for the lower cadence.
    expect(CLEANUP_EVERY_N).toBe(100);
  });

  it('exposes a 30-second time-based cleanup interval', () => {
    expect(CLEANUP_INTERVAL_MS).toBe(30_000);
  });

  it('derives STALE_AGE_MS as 2x the limiter window', () => {
    expect(STALE_AGE_MS).toBe(RATE_LIMIT_WINDOW_MS * 2);
  });

  it('evicts entries whose window ended more than staleAgeMs ago', () => {
    const map = new Map<string, RateLimitEntry>();
    const now = 1_000_000;
    // Stale: windowStart older than staleAgeMs
    map.set('stale-user', { count: 1, windowStart: now - STALE_AGE_MS - 1 });
    // Fresh: within the current window
    map.set('fresh-user', { count: 3, windowStart: now - 1_000 });

    cleanupRateLimitMap(map, now, config);

    expect(map.has('stale-user')).toBe(false);
    expect(map.has('fresh-user')).toBe(true);
  });

  it('keeps entries exactly at the staleAge boundary', () => {
    const map = new Map<string, RateLimitEntry>();
    const now = 1_000_000;
    // Boundary: now - windowStart === staleAgeMs (not strictly greater)
    map.set('boundary-user', { count: 1, windowStart: now - STALE_AGE_MS });

    cleanupRateLimitMap(map, now, config);

    expect(map.has('boundary-user')).toBe(true);
  });

  it('enforces the hard cap by evicting oldest entries when over limit', () => {
    const map = new Map<string, RateLimitEntry>();
    const now = 1_000_000;
    // All entries fresh (within window) so pass 1 can't trim — pass 2 must.
    const overBy = 3;
    const total = MAX_RATE_LIMIT_ENTRIES + overBy;
    for (let i = 0; i < total; i += 1) {
      map.set(`user-${i}`, { count: 1, windowStart: now - (total - i) });
    }
    expect(map.size).toBe(total);

    cleanupRateLimitMap(map, now, config);

    expect(map.size).toBe(MAX_RATE_LIMIT_ENTRIES);
    // The first `overBy` entries had the oldest windowStart and must be gone.
    for (let i = 0; i < overBy; i += 1) {
      expect(map.has(`user-${i}`)).toBe(false);
    }
  });

  it('no-ops when map is already under the hard cap and nothing stale', () => {
    const map = new Map<string, RateLimitEntry>();
    const now = 1_000_000;
    map.set('u1', { count: 1, windowStart: now - 1_000 });
    map.set('u2', { count: 2, windowStart: now - 2_000 });

    cleanupRateLimitMap(map, now, config);

    expect(map.size).toBe(2);
    expect(map.get('u1')?.count).toBe(1);
    expect(map.get('u2')?.count).toBe(2);
  });

  describe('time-based eviction via setInterval', () => {
    // Fake timers let us assert that a caller wiring setInterval(cleanup, 30s)
    // against the same helper evicts stale entries without any request traffic
    // at all — the core of finding B1.
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('evicts stale entries after one interval even with zero requests', () => {
      const map = new Map<string, RateLimitEntry>();
      // Freeze wall clock at t=0 so windowStart math is deterministic. The
      // entry is seeded at t=-(STALE_AGE_MS+1), i.e. expired.
      const t0 = 10_000_000;
      jest.setSystemTime(t0);
      map.set('idle-user', {
        count: 1,
        windowStart: t0 - STALE_AGE_MS - 1,
      });

      const intervalId = setInterval(() => {
        cleanupRateLimitMap(map, Date.now(), config);
      }, CLEANUP_INTERVAL_MS);

      // Before the interval fires the stale entry is still present.
      expect(map.has('idle-user')).toBe(true);

      // Advance real time PAST one CLEANUP_INTERVAL_MS tick. The entry's
      // windowStart is unchanged, so it's even staler now.
      jest.setSystemTime(t0 + CLEANUP_INTERVAL_MS);
      jest.advanceTimersByTime(CLEANUP_INTERVAL_MS);

      expect(map.has('idle-user')).toBe(false);

      clearInterval(intervalId);
    });

    it('fires repeatedly on the interval schedule', () => {
      const map = new Map<string, RateLimitEntry>();
      const t0 = 20_000_000;
      jest.setSystemTime(t0);

      let fires = 0;
      const intervalId = setInterval(() => {
        fires += 1;
        cleanupRateLimitMap(map, Date.now(), config);
      }, CLEANUP_INTERVAL_MS);

      jest.advanceTimersByTime(CLEANUP_INTERVAL_MS * 3);
      expect(fires).toBe(3);

      clearInterval(intervalId);
    });

    it('guards against double-registration pattern', () => {
      // Simulate the ensureCleanupInterval guard: if the module registers
      // the interval twice, cleanup would run twice per tick. The guard
      // pattern is "only register when id === null" — we prove that
      // following that pattern prevents the double call.
      let id: ReturnType<typeof setInterval> | null = null;
      let fires = 0;
      const register = () => {
        if (id !== null) return;
        id = setInterval(() => {
          fires += 1;
        }, CLEANUP_INTERVAL_MS);
      };

      register();
      register();
      register();

      jest.advanceTimersByTime(CLEANUP_INTERVAL_MS);
      expect(fires).toBe(1);

      if (id !== null) clearInterval(id);
    });
  });
});
