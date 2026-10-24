import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { listWorkoutSessionHistory, getWorkoutSessionHistoryDetail } from '@/lib/services/workout-session-history';
import { buildPersonalFormObservations, learnPersonalForm, rateHypertrophyTraining, type PersonalFormRep } from '@/lib/services/personalized-coaching';

export interface PersonalCoachingData {
  learning: ReturnType<typeof learnPersonalForm>;
  training: ReturnType<typeof rateHypertrophyTraining>;
  sessionCount: number;
  warnings: string[];
}

/** Existing authenticated read APIs only. Model is fit in JS on this device;
 * no feature upload, model persistence, HealthKit permission or coach call.
 */
async function loadPersonalCoaching(userId: string): Promise<PersonalCoachingData> {
  const now = new Date();
  const since = new Date(now.getTime() - 120 * 86400000).toISOString();
  const history = await listWorkoutSessionHistory(userId);
  const reps: (PersonalFormRep & { user_id: string })[] = [];
  const warnings: string[] = [];
  for (let offset = 0; ; offset += 500) {
    if (offset >= 5000) throw new Error('Form history exceeds safe read limit');
    const response = await supabase.from('reps').select('rep_id,user_id,session_id,exercise,start_ts,end_ts,fqi')
      .eq('user_id', userId).gte('start_ts', since).lt('end_ts', now.toISOString())
      .order('start_ts', { ascending: true }).order('rep_id', { ascending: true }).range(offset, offset + 499)
      .then(result => result, error => ({ data: null, error }));
    if (response.error) {
      // Never fit an apparently complete model on a partially downloaded history.
      reps.length = 0;
      warnings.push('Synced form history unavailable; no form association was calculated.');
      break;
    }
    const page = (response.data ?? []) as (PersonalFormRep & { user_id: string })[];
    reps.push(...page);
    if (page.length < 500) break;
  }
  const selected = history.filter(row => row.ended_at >= since && row.ended_at <= now.toISOString()).slice(0, 30);
  const details = [];
  // Bounded sequential reads avoid flooding the local database.
  for (const session of selected) details.push(await getWorkoutSessionHistoryDetail(userId, session.id));
  return {
    learning: learnPersonalForm(buildPersonalFormObservations(reps.filter(row => row.user_id === userId))),
    training: rateHypertrophyTraining(details.flatMap(detail => detail?.exercises.flatMap(exercise => exercise.sets) ?? [])),
    sessionCount: details.filter(Boolean).length,
    warnings,
  };
}

export function usePersonalCoachingInsights() {
  const { user } = useAuth();
  const owner = user?.id ?? null;
  const request = useRef(0);
  const [state, setState] = useState<{ owner: string | null; data: PersonalCoachingData | null; loading: boolean; error: string | null }>({ owner: null, data: null, loading: false, error: null });
  const refresh = useCallback(async () => {
    const token = ++request.current;
    setState({ owner, data: null, loading: Boolean(owner), error: null });
    if (!owner) return;
    try {
      const data = await loadPersonalCoaching(owner);
      if (request.current === token) setState({ owner, data, loading: false, error: null });
    } catch {
      if (request.current === token) setState({ owner, data: null, loading: false, error: 'Personal insights unavailable. Your existing records were not changed.' });
    }
  }, [owner]);
  useEffect(() => { void refresh(); return () => { request.current += 1; }; }, [refresh]);
  // Synchronous owner gate prevents even one render of another account's result.
  const visible = state.owner === owner ? state : { data: null, loading: Boolean(owner), error: null };
  return { ...visible, signedIn: Boolean(owner), refresh };
}
