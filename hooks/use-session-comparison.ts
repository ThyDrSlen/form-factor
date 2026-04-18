import { useEffect, useMemo, useState } from 'react';
import {
  buildSessionComparison,
  fetchSessionsForComparison,
  type ExerciseSessionSummary,
  type SessionComparison,
} from '@/lib/services/session-comparison-aggregator';

/**
 * Computes a {@link SessionComparison} from pre-loaded summaries.
 *
 * Intentionally separates compute from I/O — the caller is responsible for
 * fetching (via {@link useSessionComparisonQuery} below or an inline load).
 * Kept pure so the comparison card can be rendered in tests without DB mocks.
 */
export function useSessionComparison(
  current: ExerciseSessionSummary | null,
  prior: ExerciseSessionSummary | null,
): SessionComparison | null {
  return useMemo(() => {
    if (!current) return null;
    return buildSessionComparison(current, prior);
  }, [current, prior]);
}

export interface UseSessionComparisonQueryArgs {
  currentSessionId: string | null;
  exerciseId: string | null;
  userId: string | null;
  /** Optional fetcher override (tests inject a stub). */
  fetcher?: typeof fetchSessionsForComparison;
}

export interface UseSessionComparisonQueryResult {
  comparison: SessionComparison | null;
  loading: boolean;
  error: Error | null;
  /** Force a reload. */
  reload: () => void;
}

/**
 * Loads current+prior session summaries, then computes a comparison.
 * Safe against stale async responses (out-of-order fetches are dropped).
 */
export function useSessionComparisonQuery({
  currentSessionId,
  exerciseId,
  userId,
  fetcher = fetchSessionsForComparison,
}: UseSessionComparisonQueryArgs): UseSessionComparisonQueryResult {
  const [current, setCurrent] = useState<ExerciseSessionSummary | null>(null);
  const [prior, setPrior] = useState<ExerciseSessionSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  useEffect(() => {
    if (!currentSessionId || !exerciseId || !userId) {
      setCurrent(null);
      setPrior(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher({ currentSessionId, exerciseId, userId })
      .then((result) => {
        if (cancelled) return;
        setCurrent(result.current);
        setPrior(result.prior);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, exerciseId, userId, fetcher, reloadToken]);

  const comparison = useSessionComparison(current, prior);

  const reload = (): void => {
    setReloadToken((n) => n + 1);
  };

  return { comparison, loading, error, reload };
}
