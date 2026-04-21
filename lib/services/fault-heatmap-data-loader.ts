/**
 * fault-heatmap-data-loader
 *
 * Pulls recent form-tracking fault data and reshapes it into the
 * `FaultCell[]` + `days[]` tuple the fault-heatmap modal renders.
 *
 * Data source note: fault telemetry lives on the Supabase `reps` table
 * (see `lib/services/rep-analytics.ts` — the on-device
 * `lib/services/database/local-db.ts` deliberately does NOT mirror reps
 * because per-rep payloads would balloon the SQLite file and the reps
 * table is heavily RLS'd on Supabase anyway). We reuse the same
 * `session_metrics → reps` pattern `useFormHomeData` uses so the
 * heatmap, the form-home thumb, and this loader all agree on shape.
 *
 * The aggregation math is deliberately split from the IO so tests can
 * drive it with fixture rows (no supabase mocking required for the
 * hot path).
 */
import { supabase } from '@/lib/supabase';
import { errorWithTs } from '@/lib/logger';
import type { FaultCell } from '@/components/form-home/FaultHeatmapThumb';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_HORIZON_DAYS = 120;
const HEATMAP_WINDOW_DAYS = 7;

export interface FaultHeatmapSnapshot {
  /** Cells in the same shape `FaultHeatmapThumb` consumes. */
  cells: FaultCell[];
  /** 7 day labels, earliest -> today, same format as the thumb. */
  days: string[];
  /**
   * Flat list of per-fault totals across the 7-day window. Convenience
   * for downstream aggregators that only care about "most-frequent
   * fault", not per-day breakdown.
   */
  totals: FaultTotal[];
  /** Most recent session id touched by this aggregation, or null. */
  lastSessionId: string | null;
}

export interface FaultTotal {
  faultId: string;
  count: number;
}

export interface SessionMetricsRow {
  session_id: string;
  start_at: string | null;
  created_at?: string | null;
}

export interface RepsRow {
  session_id: string;
  faults_detected: string[] | null;
  start_ts: string | null;
}

export interface AggregateFaultsInput {
  sessions: SessionMetricsRow[];
  reps: RepsRow[];
  /** Defaults to Date.now(). Overridable for deterministic tests. */
  now?: Date;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shortDayLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Pure aggregator — takes raw session + rep rows and produces the
 * day × fault matrix the heatmap renders. Kept side-effect-free so
 * tests drive it without touching Supabase.
 */
export function aggregateFaultHeatmap(input: AggregateFaultsInput): FaultHeatmapSnapshot {
  const now = input.now ?? new Date();

  // Build 7-day day axis earliest -> today.
  const days: string[] = [];
  const dayIsoByIdx: string[] = [];
  for (let i = HEATMAP_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    days.push(shortDayLabel(d));
    dayIsoByIdx.push(isoDay(d));
  }

  // Session timestamp lookup — rep rows sometimes lack start_ts.
  const sessionStart = new Map<string, string>();
  for (const s of input.sessions) {
    const t = s.start_at ?? s.created_at ?? null;
    if (t) sessionStart.set(s.session_id, t);
  }

  // Per-day fault counts.
  const faultCountByDay = new Map<string, Map<string, number>>();
  for (const iso of dayIsoByIdx) faultCountByDay.set(iso, new Map());
  const totalByFault = new Map<string, number>();

  let lastSessionTs = 0;
  let lastSessionId: string | null = null;

  for (const rep of input.reps) {
    const isoFromRep = rep.start_ts ? rep.start_ts.slice(0, 10) : null;
    const isoFromSession = sessionStart.get(rep.session_id)?.slice(0, 10) ?? null;
    const iso = isoFromRep ?? isoFromSession;
    if (!iso) continue;
    const dayMap = faultCountByDay.get(iso);
    if (!dayMap) continue;
    if (!Array.isArray(rep.faults_detected)) continue;

    for (const f of rep.faults_detected) {
      if (typeof f !== 'string' || f.length === 0) continue;
      dayMap.set(f, (dayMap.get(f) ?? 0) + 1);
      totalByFault.set(f, (totalByFault.get(f) ?? 0) + 1);
    }
  }

  for (const s of input.sessions) {
    const ts = s.start_at ?? s.created_at ?? null;
    if (!ts) continue;
    const epoch = Date.parse(ts);
    if (!Number.isFinite(epoch)) continue;
    if (epoch > lastSessionTs) {
      lastSessionTs = epoch;
      lastSessionId = s.session_id;
    }
  }

  // Flatten day×fault map into cells, labelled with the rendered day string.
  const cells: FaultCell[] = [];
  for (let i = 0; i < dayIsoByIdx.length; i++) {
    const iso = dayIsoByIdx[i];
    const label = days[i];
    const dayMap = faultCountByDay.get(iso);
    if (!dayMap) continue;
    for (const [faultId, count] of dayMap) {
      cells.push({ dayLabel: label, faultId, count });
    }
  }

  const totals: FaultTotal[] = [...totalByFault.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([faultId, count]) => ({ faultId, count }));

  return { cells, days, totals, lastSessionId };
}

/**
 * IO-backed loader. Fetches recent sessions + reps from Supabase and
 * routes them through `aggregateFaultHeatmap`. Returns an empty
 * snapshot on any network / RLS / parse failure so the heatmap can
 * render its empty-state copy instead of crashing.
 */
export async function loadFaultHeatmapData(now?: Date): Promise<FaultHeatmapSnapshot> {
  const anchor = now ?? new Date();
  const emptyDays: string[] = [];
  for (let i = HEATMAP_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * DAY_MS);
    emptyDays.push(shortDayLabel(d));
  }
  const empty: FaultHeatmapSnapshot = {
    cells: [],
    days: emptyDays,
    totals: [],
    lastSessionId: null,
  };

  try {
    const allTimeHorizon = new Date(anchor.getTime() - SESSION_HORIZON_DAYS * DAY_MS);
    const horizonIso = isoDay(allTimeHorizon);

    const { data: sessionsRaw, error: sessionsError } = await supabase
      .from('session_metrics')
      .select('session_id,start_at,created_at')
      .gte('start_at', `${horizonIso}T00:00:00.000Z`)
      .order('created_at', { ascending: false })
      .limit(120);
    if (sessionsError) throw sessionsError;
    const sessions = (sessionsRaw ?? []) as SessionMetricsRow[];
    if (sessions.length === 0) return empty;

    const sessionIds = sessions.map((s) => s.session_id);
    const { data: repsRaw, error: repsError } = await supabase
      .from('reps')
      .select('session_id,faults_detected,start_ts')
      .in('session_id', sessionIds)
      .limit(5000);
    if (repsError) throw repsError;
    const reps = (repsRaw ?? []) as RepsRow[];

    return aggregateFaultHeatmap({ sessions, reps, now: anchor });
  } catch (err) {
    errorWithTs('[fault-heatmap-data-loader] loadFaultHeatmapData failed', err);
    return empty;
  }
}
