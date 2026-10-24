import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPersonalizedCueRunner,
  type CueInput,
  type CueOutput,
  type UserFaultHistoryItem,
} from '@/lib/services/personalized-cue';

export type PersonalizedCueStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UsePersonalizedCueResult {
  output: CueOutput | null;
  status: PersonalizedCueStatus;
  error: Error | null;
}

/**
 * Runs the active personalized-cue runner for a single detected fault and
 * exposes the result. Defaults to the static runner; swaps to Gemma
 * automatically once `setPersonalizedCueRunner` installs a real runner.
 *
 * The hook deduplicates by a stable key derived from exerciseId, faultId,
 * and a sorted snapshot of the history array so structurally equal arrays
 * with different identity do not trigger a re-run.
 */
export function usePersonalizedCue(
  input: CueInput | null,
): UsePersonalizedCueResult {
  const stableKey = useMemo(() => {
    if (!input) return null;
    const hist = input.userHistory
      ? JSON.stringify(
          [...input.userHistory].sort((a: UserFaultHistoryItem, b: UserFaultHistoryItem) =>
            a.faultId.localeCompare(b.faultId),
          ),
        )
      : '';
    return `${input.exerciseId}::${input.faultId}::${hist}`;
  }, [input]);

  const [output, setOutput] = useState<CueOutput | null>(null);
  const [status, setStatus] = useState<PersonalizedCueStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  // Always hold the latest input so the async callback reads fresh data
  // even if the component re-renders with a new array reference mid-flight.
  const latestInputRef = useRef<CueInput | null>(input);
  latestInputRef.current = input;

  useEffect(() => {
    if (!stableKey) {
      setOutput(null);
      setStatus('idle');
      setError(null);
      return;
    }

    setStatus('loading');
    setError(null);

    const snapshot = latestInputRef.current;
    if (!snapshot) return;

    let cancelled = false;

    getPersonalizedCueRunner()
      .getCue(snapshot)
      .then((result) => {
        if (cancelled) return;
        setOutput(result);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [stableKey]);

  return { output, status, error };
}
