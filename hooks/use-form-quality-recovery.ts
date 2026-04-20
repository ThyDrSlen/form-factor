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

  const load = useCallback(async () => {
    if (!sessionId) {
      setIsLoading(false);
      setError(null);
      setPrescriptions([]);
      setSummary(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [faults, aggregates] = await Promise.all([
        getSessionFaults(sessionId),
        getSessionAggregates(sessionId),
      ]);
      if (!mountedRef.current) return;
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
      const message = err instanceof Error ? err.message : 'Failed to load session faults.';
      setError(message);
      setPrescriptions([]);
      setSummary(null);
    } finally {
      if (mountedRef.current) setIsLoading(false);
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
