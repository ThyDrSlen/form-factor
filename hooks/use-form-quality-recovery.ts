import { useCallback, useEffect, useRef, useState } from 'react';

import {
  explainDrill,
  type ExplainDrillInput,
  type ExplainDrillResult,
} from '@/lib/services/coach-drill-explainer';
import {
  prescribeDrills,
  type DrillPrescription,
} from '@/lib/services/form-quality-recovery';
import {
  getSessionAggregates,
  getSessionFaults,
  type FormTrackingFault,
  type SessionFaultAggregate,
} from '@/lib/services/form-tracking-fault-reporter';

export interface RecoverySummary {
  sessionId: string;
  totalFaults: number;
  exerciseCount: number;
  aggregates: SessionFaultAggregate[];
  fetchedAt: number;
}

export interface DrillExplanationState {
  isLoading: boolean;
  result?: ExplainDrillResult;
}

export interface UseFormQualityRecoveryResult {
  isLoading: boolean;
  error: string | null;
  prescriptions: DrillPrescription[];
  summary: RecoverySummary | null;
  refresh: () => Promise<void>;
  requestExplanation: (drillId: string, input: ExplainDrillInput) => Promise<void>;
  explanations: Record<string, DrillExplanationState>;
}

export function useFormQualityRecovery(sessionId: string | null | undefined): UseFormQualityRecoveryResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prescriptions, setPrescriptions] = useState<DrillPrescription[]>([]);
  const [summary, setSummary] = useState<RecoverySummary | null>(null);
  const [explanations, setExplanations] = useState<Record<string, DrillExplanationState>>({});
  const mountedRef = useRef(true);
  // Request-ID token so a slow in-flight fetch for an earlier sessionId
  // cannot clobber the state of a newer, fresher fetch. Every call bumps
  // the counter; completions compare their captured id against the latest
  // value and bail silently if outdated.
  const latestRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!sessionId) {
      setIsLoading(false);
      setError(null);
      setPrescriptions([]);
      setSummary(null);
      return;
    }
    const requestId = ++latestRequestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const [faults, aggregates] = await Promise.all([
        getSessionFaults(sessionId),
        getSessionAggregates(sessionId),
      ]);
      if (!mountedRef.current) return;
      // Drop stale response — a newer load() has already superseded us.
      if (requestId !== latestRequestIdRef.current) return;
      setPrescriptions(prescribeDrills(faults as FormTrackingFault[]));
      setSummary({
        sessionId,
        totalFaults: faults.length,
        exerciseCount: aggregates.length,
        aggregates,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      if (!mountedRef.current) return;
      if (requestId !== latestRequestIdRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load session faults.';
      setError(message);
      setPrescriptions([]);
      setSummary(null);
    } finally {
      if (mountedRef.current && requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const requestExplanation = useCallback(
    async (drillId: string, input: ExplainDrillInput) => {
      setExplanations((prev) => ({
        ...prev,
        [drillId]: { isLoading: true, result: prev[drillId]?.result },
      }));
      const result = await explainDrill(input);
      if (!mountedRef.current) return;
      setExplanations((prev) => ({
        ...prev,
        [drillId]: { isLoading: false, result },
      }));
    },
    []
  );

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return {
    isLoading,
    error,
    prescriptions,
    summary,
    refresh,
    requestExplanation,
    explanations,
  };
}
