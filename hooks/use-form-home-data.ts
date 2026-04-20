/**
 * useFormHomeData (issue #470).
 *
 * Aggregates everything the form-home tab needs into a single state value:
 *   - today's best + avg FQI + set count
 *   - 7-day trend points (earliest -> today)
 *   - personal P90 FQI + all-time average
 *   - top-3 faults with a day x fault cell matrix
 *   - most recent session id (for the insights modal)
 *
 * Drives off the same Supabase tables as `workout-insights.ts` but kept
 * isolated so the hook is cheap and easy to mock in tests. Results are
 * cached at module scope for 60s — the tab is highly visited and we'd
 * rather serve stale-by-a-minute data than spam the network.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { WeeklyTrendPoint } from '@/components/form-home/WeeklyTrendChart';
import type { FaultCell } from '@/components/form-home/FaultHeatmapThumb';

const CACHE_TTL_MS = 60 * 1000;
const DEBOUNCE_MS = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

interface SessionMetricsRow {
  session_id: string;
  start_at: string | null;
  created_at?: string | null;
}

interface RepsRow {
  session_id: string;
  fqi: number | null;
  faults_detected: string[] | null;
  start_ts: string;
}

export interface FormHomeData {
  todayBestFqi: number | null;
  todayAvgFqi: number | null;
  todaySetCount: number;
  trend: WeeklyTrendPoint[];
  p90: number | null;
  allTimeAvg: number | null;
  faultCells: FaultCell[];
  faultDays: string[];
  lastSessionId: string | null;
}

interface CacheEntry {
  fetchedAt: number;
  data: FormHomeData;
}

let cache: CacheEntry | null = null;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shortDayLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

const EMPTY_DATA: FormHomeData = {
  todayBestFqi: null,
  todayAvgFqi: null,
  todaySetCount: 0,
  trend: [],
  p90: null,
  allTimeAvg: null,
  faultCells: [],
  faultDays: [],
  lastSessionId: null,
};

async function fetchFormHomeData(): Promise<FormHomeData> {
  const now = new Date();
  const todayIso = isoDay(now);
  const weekAgo = new Date(now.getTime() - 6 * DAY_MS);
  const weekAgoIso = isoDay(weekAgo);
  const allTimeHorizon = new Date(now.getTime() - 120 * DAY_MS);
  const allTimeHorizonIso = isoDay(allTimeHorizon);

  const { data: sessionsRaw, error: sessionsError } = await supabase
    .from('session_metrics')
    .select('session_id,start_at,created_at')
    .gte('start_at', `${allTimeHorizonIso}T00:00:00.000Z`)
    .order('created_at', { ascending: false })
    .limit(120);
  if (sessionsError) throw sessionsError;
  const sessions = (sessionsRaw ?? []) as SessionMetricsRow[];
  if (sessions.length === 0) {
    return EMPTY_DATA;
  }

  const sessionIds = sessions.map((s) => s.session_id);
  const { data: repsRaw, error: repsError } = await supabase
    .from('reps')
    .select('session_id,fqi,faults_detected,start_ts')
    .in('session_id', sessionIds)
    .limit(5000);
  if (repsError) throw repsError;
  const reps = (repsRaw ?? []) as RepsRow[];

  // Session timestamp lookup → used for day grouping.
  const sessionStart = new Map<string, string>();
  for (const s of sessions) {
    const t = s.start_at ?? s.created_at ?? null;
    if (t) sessionStart.set(s.session_id, t);
  }

  // Today metrics
  const todayReps = reps.filter((r) => {
    const t = sessionStart.get(r.session_id);
    return t != null && t.slice(0, 10) === todayIso;
  });
  const todayFqi = todayReps
    .map((r) => r.fqi)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const todayBestFqi = todayFqi.length > 0 ? Math.max(...todayFqi) : null;
  const todayAvgFqi = mean(todayFqi);
  const todaySetCount = new Set(todayReps.map((r) => r.session_id)).size;

  // Trend buckets: 7 daily averages, earliest -> today
  const trend: WeeklyTrendPoint[] = [];
  const faultDays: string[] = [];
  const dailyBuckets = new Map<string, number[]>();
  const faultCountByDay = new Map<string, Map<string, number>>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = isoDay(d);
    const label = shortDayLabel(d);
    trend.push({ label, avgFqi: null });
    faultDays.push(label);
    dailyBuckets.set(key, []);
    faultCountByDay.set(key, new Map());
  }
  for (const r of reps) {
    const startIso = r.start_ts?.slice(0, 10) ?? sessionStart.get(r.session_id)?.slice(0, 10);
    if (!startIso) continue;
    if (!dailyBuckets.has(startIso)) continue;
    if (typeof r.fqi === 'number' && Number.isFinite(r.fqi)) {
      dailyBuckets.get(startIso)!.push(r.fqi);
    }
    if (Array.isArray(r.faults_detected)) {
      const dayMap = faultCountByDay.get(startIso)!;
      for (const f of r.faults_detected) {
        if (typeof f !== 'string') continue;
        dayMap.set(f, (dayMap.get(f) ?? 0) + 1);
      }
    }
  }
  const trendKeys = [...dailyBuckets.keys()];
  for (let i = 0; i < trend.length; i++) {
    const key = trendKeys[i];
    const vals = dailyBuckets.get(key) ?? [];
    const avg = mean(vals);
    trend[i] = { ...trend[i], avgFqi: avg === null ? null : Number(avg.toFixed(1)) };
  }

  // Full-history all-time average + p90.
  const allFqi = reps
    .map((r) => r.fqi)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const allTimeAvg = mean(allFqi);
  const p90 = percentile(allFqi, 90);

  // Fault cells.
  const faultCells: FaultCell[] = [];
  for (let i = 0; i < trendKeys.length; i++) {
    const key = trendKeys[i];
    const dayLabel = faultDays[i];
    const dayMap = faultCountByDay.get(key) ?? new Map<string, number>();
    for (const [faultId, count] of dayMap) {
      faultCells.push({ dayLabel, faultId, count });
    }
  }

  return {
    todayBestFqi,
    todayAvgFqi: todayAvgFqi === null ? null : Number(todayAvgFqi.toFixed(1)),
    todaySetCount,
    trend,
    p90: p90 === null ? null : Number(p90.toFixed(1)),
    allTimeAvg: allTimeAvg === null ? null : Number(allTimeAvg.toFixed(1)),
    faultCells,
    faultDays,
    lastSessionId: sessions[0]?.session_id ?? null,
  };
}

export interface UseFormHomeDataValue {
  data: FormHomeData;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useFormHomeData(): UseFormHomeDataValue {
  const [data, setData] = useState<FormHomeData>(() =>
    cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS
      ? cache.data
      : EMPTY_DATA,
  );
  const [loading, setLoading] = useState<boolean>(() => !cache);
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

  const load = useCallback(async (force = false) => {
    try {
      if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        if (mountedRef.current) {
          setData(cache.data);
          setLoading(false);
        }
        return;
      }
      if (mountedRef.current) setLoading(true);
      const next = await fetchFormHomeData();
      cache = { fetchedAt: Date.now(), data: next };
      if (mountedRef.current) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) setError(e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void load();
    }, DEBOUNCE_MS);
  }, [load]);

  const refresh = useCallback(async () => {
    cache = null;
    await load(true);
  }, [load]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}

export function __resetFormHomeDataCacheForTests(): void {
  cache = null;
}
