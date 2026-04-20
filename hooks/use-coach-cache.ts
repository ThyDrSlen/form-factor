// useCachedCoachPrompt: small wrapper that calls sendCoachPrompt with
// opts.cacheMs and surfaces loading/data/error state. Issue #465 Item 3.
//
// Designed for callers like the auto-debrief screen (#461) that have a fixed
// prompt and want a cache hit on subsequent visits.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  sendCoachPrompt,
  type CoachContext,
  type CoachMessage,
  type CoachSendOptions,
} from '@/lib/services/coach-service';

export interface UseCachedCoachOptions {
  /** Cache TTL in ms; 0 disables caching. Default 12h (auto-debrief use case). */
  cacheMs?: number;
  /** Forwarded to sendCoachPrompt for cache-key isolation (Item 5). */
  shaper?: boolean;
  /** Forwarded to sendCoachPrompt for failover routing. */
  allowFailover?: boolean;
  /** Forwarded to sendCoachPrompt for provider hint. */
  provider?: CoachSendOptions['provider'];
}

export interface UseCachedCoachReturn {
  data: CoachMessage | null;
  loading: boolean;
  error: Error | null;
  /** Re-fetch (bypassing cache via cacheMs=0). */
  refresh: () => Promise<CoachMessage | null>;
  /** Re-fetch and respect cache. */
  reload: () => Promise<CoachMessage | null>;
}

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Returns a cached coach reply for `(messages, context, opts)`. The hook
 * automatically fires once on mount and on any input change.
 */
export function useCachedCoachPrompt(
  messages: CoachMessage[],
  context?: CoachContext,
  opts?: UseCachedCoachOptions
): UseCachedCoachReturn {
  const [data, setData] = useState<CoachMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const cacheMs = opts?.cacheMs ?? TWELVE_HOURS_MS;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (overrideCacheMs?: number): Promise<CoachMessage | null> => {
      if (!mountedRef.current) return null;
      setLoading(true);
      setError(null);
      try {
        const result = await sendCoachPrompt(messages, context, {
          cacheMs: overrideCacheMs ?? cacheMs,
          shaper: opts?.shaper,
          allowFailover: opts?.allowFailover,
          provider: opts?.provider,
        });
        if (mountedRef.current) setData(result);
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(e);
        return null;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [
      messages,
      context,
      cacheMs,
      opts?.shaper,
      opts?.allowFailover,
      opts?.provider,
    ]
  );

  // Fire once on mount + on input change.
  useEffect(() => {
    void run();
  }, [run]);

  const refresh = useCallback(() => run(0), [run]);
  const reload = useCallback(() => run(), [run]);

  return { data, loading, error, refresh, reload };
}
