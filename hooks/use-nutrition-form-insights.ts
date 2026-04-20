/**
 * useNutritionFormInsights (issue #470).
 *
 * Thin hook wrapper that glues three sources together:
 *   1. `useFood()`        — offline-first food entries
 *   2. `useHealthKit()`   — weight/steps/HR series (re-used for recovery hints)
 *   3. Session FQI rows   — fetched from Supabase `session_metrics` + `reps`
 *
 * It memoises the correlators, caches the assembled sessions for an hour
 * (so bouncing between tabs does not thrash the network), and exposes a
 * compact `{ data, loading, error, refresh }` surface.
 *
 * The hook is deliberately tolerant of missing inputs: the correlators
 * themselves return graceful zeros, so every downstream component can
 * render straight from the returned object with no additional guarding.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFood } from '@/contexts/FoodContext';
import { useHealthKit } from '@/contexts/HealthKitContext';
import { supabase } from '@/lib/supabase';
import {
  correlateNutritionWithForm,
  type FormSession,
  type NutritionFormCorrelation,
} from '@/lib/services/form-nutrition-correlator';
import {
  correlateRecoveryWithForm,
  type RecoveryDatum,
  type RecoveryFormCorrelation,
} from '@/lib/services/form-recovery-correlator';

const CACHE_TTL_MS = 60 * 60 * 1000;
const DEBOUNCE_MS = 250;
const DEFAULT_SESSION_LIMIT = 120;

interface SessionMetricsRow {
  session_id: string;
  start_at: string | null;
  created_at?: string | null;
}

interface RepsRow {
  session_id: string;
  fqi: number | null;
}

interface SessionsCacheEntry {
  fetchedAt: number;
  sessions: FormSession[];
}

export interface UseNutritionFormInsightsOptions {
  windowHours?: number;
  sessionLimit?: number;
  cacheTtlMs?: number;
}

export interface UseNutritionFormInsightsValue {
  loading: boolean;
  error: Error | null;
  nutrition: NutritionFormCorrelation | null;
  recovery: RecoveryFormCorrelation | null;
  sessions: FormSession[];
  refresh: () => Promise<void>;
}

// Module-level cache so the hook can be remounted without refetching.
let sessionsCache: SessionsCacheEntry | null = null;

function toNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

async function fetchFormSessions(limit: number): Promise<FormSession[]> {
  const { data: metricsData, error: metricsError } = await supabase
    .from('session_metrics')
    .select('session_id,start_at,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (metricsError) throw metricsError;
  const metrics = (metricsData ?? []) as SessionMetricsRow[];
  if (metrics.length === 0) return [];

  const sessionIds = metrics.map((m) => m.session_id);
  const { data: repsRaw, error: repsError } = await supabase
    .from('reps')
    .select('session_id,fqi')
    .in('session_id', sessionIds)
    .limit(limit * 40);
  if (repsError) throw repsError;
  const reps = (repsRaw ?? []) as RepsRow[];

  const fqiBySession = new Map<string, number[]>();
  for (const r of reps) {
    if (r.fqi == null) continue;
    const arr = fqiBySession.get(r.session_id) ?? [];
    arr.push(r.fqi);
    fqiBySession.set(r.session_id, arr);
  }

  return metrics.map<FormSession>((m) => {
    const fqis = fqiBySession.get(m.session_id) ?? [];
    const avg =
      fqis.length > 0
        ? Number(
            (fqis.reduce((sum, v) => sum + v, 0) / fqis.length).toFixed(2),
          )
        : null;
    return {
      id: m.session_id,
      startAt: m.start_at ?? m.created_at ?? 0,
      avgFqi: avg,
    };
  });
}

interface NormalizedPoint {
  date: string | number | null | undefined;
  value: number | null | undefined;
}

function dateToIsoDay(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const t = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(t) || t === 0) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function toRecoveryData(healthMetricPoints: {
  sleep?: NormalizedPoint[];
  hrv?: NormalizedPoint[];
  resting?: NormalizedPoint[];
}): RecoveryDatum[] {
  const byDay = new Map<string, RecoveryDatum>();
  const upsert = (day: string, patch: Partial<RecoveryDatum>) => {
    const prior = byDay.get(day) ?? { date: day };
    byDay.set(day, { ...prior, ...patch, date: day });
  };

  for (const s of healthMetricPoints.sleep ?? []) {
    const day = dateToIsoDay(s.date);
    if (!day) continue;
    upsert(day, { sleepHours: toNumber(s.value) });
  }
  for (const s of healthMetricPoints.hrv ?? []) {
    const day = dateToIsoDay(s.date);
    if (!day) continue;
    upsert(day, { hrvMs: toNumber(s.value) });
  }
  for (const s of healthMetricPoints.resting ?? []) {
    const day = dateToIsoDay(s.date);
    if (!day) continue;
    upsert(day, { restingHeartRateBpm: toNumber(s.value) });
  }
  return [...byDay.values()];
}

export function useNutritionFormInsights(
  options: UseNutritionFormInsightsOptions = {},
): UseNutritionFormInsightsValue {
  const windowHours = options.windowHours ?? 3;
  const sessionLimit = options.sessionLimit ?? DEFAULT_SESSION_LIMIT;
  const ttlMs = options.cacheTtlMs ?? CACHE_TTL_MS;

  const { foods } = useFood();
  const healthKit = useHealthKit();

  const [sessions, setSessions] = useState<FormSession[]>(() =>
    sessionsCache && Date.now() - sessionsCache.fetchedAt < ttlMs
      ? sessionsCache.sessions
      : [],
  );
  const [loading, setLoading] = useState<boolean>(() => !sessionsCache);
  const [error, setError] = useState<Error | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const load = useCallback(
    async (force = false) => {
      try {
        if (
          !force &&
          sessionsCache &&
          Date.now() - sessionsCache.fetchedAt < ttlMs
        ) {
          if (mountedRef.current) {
            setSessions(sessionsCache.sessions);
            setLoading(false);
          }
          return;
        }
        if (mountedRef.current) setLoading(true);
        const result = await fetchFormSessions(sessionLimit);
        sessionsCache = { fetchedAt: Date.now(), sessions: result };
        if (mountedRef.current) {
          setSessions(result);
          setError(null);
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(e);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [sessionLimit, ttlMs],
  );

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void load();
    }, DEBOUNCE_MS);
  }, [load]);

  const refresh = useCallback(async () => {
    sessionsCache = null;
    await load(true);
  }, [load]);

  const nutrition = useMemo<NutritionFormCorrelation | null>(() => {
    if (sessions.length === 0) return null;
    return correlateNutritionWithForm(sessions, foods, { windowHours });
  }, [sessions, foods, windowHours]);

  const recovery = useMemo<RecoveryFormCorrelation | null>(() => {
    if (sessions.length === 0) return null;
    const recoveryData = toRecoveryData({
      // HealthKit context doesn't expose sleep as a series directly; we map
      // the closest proxies (walking HR average as a resting HR stand-in)
      // and leave sleep/HRV null so their correlators return zeros until a
      // native sleep/HRV series lands.
      resting: healthKit.walkingHeartRateAvgHistory,
    });
    return correlateRecoveryWithForm(sessions, recoveryData, {
      useNightBefore: false,
    });
  }, [sessions, healthKit.walkingHeartRateAvgHistory]);

  return {
    loading,
    error,
    nutrition,
    recovery,
    sessions,
    refresh,
  };
}

export function __resetNutritionFormInsightsCacheForTests(): void {
  sessionsCache = null;
}
