/**
 * useExerciseHistory
 *
 * React hook that returns the ExerciseHistorySummary for the given
 * exercise id. Caches per-exercise results in a module-level Map to
 * avoid re-querying SQLite/Supabase on every re-render and on re-visits
 * during the same session.
 *
 * Usage:
 *   const { summary, isLoading, refresh } = useExerciseHistory('ex-pullup');
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EMPTY_EXERCISE_HISTORY,
  getExerciseHistorySummary,
  type ExerciseHistorySummary,
} from '@/lib/services/exercise-history';

interface CacheEntry {
  fetchedAt: number;
  promise?: Promise<ExerciseHistorySummary>;
  summary?: ExerciseHistorySummary;
}

// Module-level session cache. Reset via resetExerciseHistoryCache() (used by tests
// + session lifecycle transitions).
const cache = new Map<string, CacheEntry>();

/** Max age a cache entry stays valid before being considered stale (ms). */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — tuned for a single workout session.

export function resetExerciseHistoryCache(): void {
  cache.clear();
}

export interface UseExerciseHistoryResult {
  summary: ExerciseHistorySummary;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useExerciseHistory(
  exerciseId: string | null | undefined,
  options?: { cacheTtlMs?: number },
): UseExerciseHistoryResult {
  const [summary, setSummary] = useState<ExerciseHistorySummary>(() => {
    if (!exerciseId) return EMPTY_EXERCISE_HISTORY;
    return cache.get(exerciseId)?.summary ?? EMPTY_EXERCISE_HISTORY;
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const ttl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (id: string, force: boolean) => {
      const now = Date.now();
      const entry = cache.get(id);

      // Fresh cached value — use it synchronously.
      if (!force && entry?.summary && now - entry.fetchedAt < ttl) {
        setSummary(entry.summary);
        setIsLoading(false);
        setError(null);
        return;
      }

      // Promise already in-flight — await it instead of firing another query.
      if (!force && entry?.promise) {
        setIsLoading(true);
        try {
          const result = await entry.promise;
          if (mountedRef.current) {
            setSummary(result);
            setError(null);
          }
        } catch (err) {
          if (mountedRef.current) setError(asError(err));
        } finally {
          if (mountedRef.current) setIsLoading(false);
        }
        return;
      }

      // Fire a new query and write the pending promise into the cache.
      setIsLoading(true);
      setError(null);

      const promise = getExerciseHistorySummary(id);
      cache.set(id, { fetchedAt: now, promise });

      try {
        const result = await promise;
        cache.set(id, { fetchedAt: Date.now(), summary: result });
        if (mountedRef.current) setSummary(result);
      } catch (err) {
        // On error, leave any prior summary in place and surface the error.
        cache.delete(id);
        if (mountedRef.current) setError(asError(err));
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [ttl],
  );

  useEffect(() => {
    if (!exerciseId) {
      setSummary(EMPTY_EXERCISE_HISTORY);
      setIsLoading(false);
      setError(null);
      return;
    }
    void load(exerciseId, false);
  }, [exerciseId, load]);

  const refresh = useCallback(async () => {
    if (!exerciseId) return;
    await load(exerciseId, true);
  }, [exerciseId, load]);

  return { summary, isLoading, error, refresh };
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
