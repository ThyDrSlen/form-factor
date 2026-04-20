import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ensureUserId } from '@/lib/auth-utils';
import { errorWithTs } from '@/lib/logger';
import {
  buildMesocycleInsights,
  MESOCYCLE_WEEKS,
  type MesocycleInsights,
  type MesocycleRepRow,
  type MesocycleSetRow,
} from '@/lib/services/form-mesocycle-aggregator';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface UseFormMesocycleState {
  loading: boolean;
  error: string | null;
  insights: MesocycleInsights | null;
  refresh: () => Promise<void>;
}

/**
 * Pulls the last 4 weeks of rep + set rows for the current user and runs them
 * through `buildMesocycleInsights`. Safe against unmount, idempotent on rapid
 * refreshes, and silently degrades if either table query fails — a partial
 * view is better than a full error page here.
 */
export function useFormMesocycle(): UseFormMesocycleState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<MesocycleInsights | null>(null);
  const cancelRef = useRef(false);

  const load = useCallback(async () => {
    cancelRef.current = false;
    setLoading(true);
    setError(null);

    try {
      const userId = await ensureUserId();
      const now = new Date();
      const windowStart = new Date(now.getTime() - MESOCYCLE_WEEKS * MS_PER_WEEK).toISOString();

      const [repsResult, setsResult] = await Promise.all([
        supabase
          .from('reps')
          .select('rep_id, session_id, exercise, start_ts, fqi, faults_detected')
          .eq('user_id', userId)
          .gte('start_ts', windowStart),
        supabase
          .from('sets')
          .select('set_id, session_id, exercise, created_at, reps_count, load_value')
          .eq('user_id', userId)
          .gte('created_at', windowStart),
      ]);

      if (cancelRef.current) return;

      if (repsResult.error) {
        errorWithTs('[use-form-mesocycle] reps query failed', repsResult.error);
      }
      if (setsResult.error) {
        errorWithTs('[use-form-mesocycle] sets query failed', setsResult.error);
      }

      const reps: MesocycleRepRow[] = (repsResult.data ?? []).map((row: Record<string, unknown>) => ({
        rep_id: String(row.rep_id ?? ''),
        session_id: String(row.session_id ?? ''),
        exercise: String(row.exercise ?? ''),
        start_ts: String(row.start_ts ?? ''),
        fqi: typeof row.fqi === 'number' ? row.fqi : null,
        faults_detected: Array.isArray(row.faults_detected)
          ? row.faults_detected.filter((f): f is string => typeof f === 'string')
          : [],
      }));

      const sets: MesocycleSetRow[] = (setsResult.data ?? []).map((row: Record<string, unknown>) => ({
        set_id: String(row.set_id ?? ''),
        session_id: String(row.session_id ?? ''),
        exercise: String(row.exercise ?? ''),
        completed_at: String(row.created_at ?? ''),
        reps_count: typeof row.reps_count === 'number' ? row.reps_count : 0,
        load_value: typeof row.load_value === 'number' ? row.load_value : null,
      }));

      const result = buildMesocycleInsights(reps, sets, { reference: now });
      if (!cancelRef.current) setInsights(result);
    } catch (err) {
      if (!cancelRef.current) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      cancelRef.current = true;
    };
  }, [load]);

  return { loading, error, insights, refresh: load };
}
