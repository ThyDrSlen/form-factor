import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getFaultExplainer,
  type FaultFrequencyHint,
  type FaultSynthesisInput,
  type FaultSynthesisOutput,
  type FaultSynthesisSetContext,
} from '@/lib/services/fault-explainer';

export type FaultSynthesisStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseFaultSynthesisResult {
  output: FaultSynthesisOutput | null;
  status: FaultSynthesisStatus;
  error: Error | null;
}

export interface UseFaultSynthesisOptions {
  exerciseId: string | null | undefined;
  faultIds: string[];
  setContext?: FaultSynthesisSetContext;
  recentHistory?: FaultFrequencyHint[];
  /**
   * When true the hook skips synthesis even if inputs are valid. Useful
   * when the caller wants to gate synthesis behind a user preference or
   * A/B flag.
   */
  disabled?: boolean;
}

/**
 * Runs the active fault explainer for a set of concurrently-detected
 * faults and exposes the synthesized output. Defaults to the static
 * fallback; swaps to Gemma automatically once `setFaultExplainerRunner`
 * installs a real runner.
 *
 * The hook deduplicates by a stable key derived from the inputs, so
 * re-renders that pass structurally equal data do not re-run synthesis.
 */
export function useFaultSynthesis({
  exerciseId,
  faultIds,
  setContext,
  recentHistory,
  disabled,
}: UseFaultSynthesisOptions): UseFaultSynthesisResult {
  const stableKey = useMemo(() => {
    if (!exerciseId || faultIds.length === 0 || disabled) return null;
    const sortedFaults = [...faultIds].sort().join('|');
    const ctx = setContext ? JSON.stringify(setContext) : '';
    const hist = recentHistory
      ? JSON.stringify(
          [...recentHistory].sort((a, b) => a.faultId.localeCompare(b.faultId)),
        )
      : '';
    return `${exerciseId}::${sortedFaults}::${ctx}::${hist}`;
  }, [exerciseId, faultIds, setContext, recentHistory, disabled]);

  const [output, setOutput] = useState<FaultSynthesisOutput | null>(null);
  const [status, setStatus] = useState<FaultSynthesisStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const latestInputsRef = useRef({ exerciseId, faultIds, setContext, recentHistory });
  latestInputsRef.current = { exerciseId, faultIds, setContext, recentHistory };

  useEffect(() => {
    if (!stableKey) {
      setOutput(null);
      setStatus('idle');
      setError(null);
      return;
    }

    setStatus('loading');
    setError(null);

    const snapshot = latestInputsRef.current;
    if (!snapshot.exerciseId) return;

    const payload: FaultSynthesisInput = {
      exerciseId: snapshot.exerciseId,
      faultIds: snapshot.faultIds,
      setContext: snapshot.setContext,
      recentHistory: snapshot.recentHistory,
    };

    let cancelled = false;
    getFaultExplainer()
      .synthesize(payload)
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
