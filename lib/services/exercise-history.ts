/**
 * Exercise History Service
 *
 * Queries local SQLite (+ Supabase fallback) for per-exercise historical
 * summaries used to contextualize live form tracking. Powers the
 * ExerciseHistoryStrip chips and coaching decisions.
 *
 * Returned summary shape:
 *   - lastSession: most recent completed session for the exercise
 *   - last5SessionsAvgFqi: rolling average FQI over last 5 completed sessions
 *   - maxReps: best single-set rep count on record
 *   - maxVolume: best (reps * weight_lb) on record
 */
import { localDB } from '@/lib/services/database/local-db';
import { supabase } from '@/lib/supabase';
import { warnWithTs } from '@/lib/logger';

export interface ExerciseHistoryLastSession {
  /** Session id (workout_sessions.id) */
  sessionId: string;
  /** ISO8601 timestamp — when the session ended (or most recent set completed) */
  endedAt: string;
  /** Total completed sets in that session for this exercise */
  sets: number;
  /** Total reps across those sets */
  totalReps: number;
  /** Heaviest working weight in lb (null if bodyweight/timed) */
  topWeightLb: number | null;
  /** Session-level average FQI for this exercise (0-100, null if none logged) */
  avgFqi: number | null;
}

export interface ExerciseHistorySummary {
  lastSession: ExerciseHistoryLastSession | null;
  last5SessionsAvgFqi: number | null;
  maxReps: number | null;
  maxVolume: number | null;
}

export const EMPTY_EXERCISE_HISTORY: ExerciseHistorySummary = {
  lastSession: null,
  last5SessionsAvgFqi: null,
  maxReps: null,
  maxVolume: null,
};

interface SessionSetRow {
  session_id: string;
  ended_at: string | null;
  started_at: string | null;
  set_id: string;
  completed_at: string | null;
  actual_reps: number | null;
  actual_weight: number | null;
}

interface FqiRow {
  session_id: string;
  fqi: number | null;
}

interface RemoteSetRow {
  id: string;
  actual_reps: number | null;
  actual_weight: number | null;
  completed_at: string | null;
  workout_session_exercises?: {
    exercise_id?: string;
    workout_sessions?: {
      id?: string;
      started_at?: string;
      ended_at?: string | null;
    };
  };
}

/**
 * Return a best-effort history summary for the given exercise id.
 * Never throws — returns EMPTY_EXERCISE_HISTORY on any failure.
 */
export async function getExerciseHistorySummary(
  exerciseId: string,
): Promise<ExerciseHistorySummary> {
  if (!exerciseId) return EMPTY_EXERCISE_HISTORY;

  const local = await queryLocal(exerciseId).catch((err) => {
    if (__DEV__) warnWithTs('[exercise-history] local query failed', err);
    return null;
  });

  if (local && local.lastSession) {
    return local;
  }

  // Fallback to Supabase when local SQLite is unavailable (web) or empty
  const remote = await queryRemote(exerciseId).catch((err) => {
    if (__DEV__) warnWithTs('[exercise-history] remote query failed', err);
    return null;
  });

  return remote ?? local ?? EMPTY_EXERCISE_HISTORY;
}

// ---------------------------------------------------------------------------
// Local SQLite
// ---------------------------------------------------------------------------

async function queryLocal(exerciseId: string): Promise<ExerciseHistorySummary | null> {
  const db = localDB.db;
  if (!db) return null;

  // Pull all completed sets for this exercise, newest session first.
  const rows = await db.getAllAsync<SessionSetRow>(
    `SELECT
       s.id AS session_id,
       s.ended_at AS ended_at,
       s.started_at AS started_at,
       ws.id AS set_id,
       ws.completed_at AS completed_at,
       ws.actual_reps AS actual_reps,
       ws.actual_weight AS actual_weight
     FROM workout_session_exercises e
     JOIN workout_sessions s ON s.id = e.session_id AND COALESCE(s.deleted, 0) = 0
     JOIN workout_session_sets ws ON ws.session_exercise_id = e.id AND COALESCE(ws.deleted, 0) = 0
     WHERE e.exercise_id = ?
       AND COALESCE(e.deleted, 0) = 0
       AND ws.completed_at IS NOT NULL
     ORDER BY COALESCE(s.ended_at, s.started_at) DESC, ws.sort_order ASC`,
    [exerciseId],
  );

  if (!rows || rows.length === 0) return null;

  return buildSummaryFromRows(rows, await queryFqiLocal(db, exerciseId));
}

async function queryFqiLocal(
  db: NonNullable<typeof localDB.db>,
  exerciseId: string,
): Promise<FqiRow[]> {
  try {
    return await db.getAllAsync<FqiRow>(
      `SELECT session_id, fqi FROM reps
         WHERE exercise = ? AND fqi IS NOT NULL
         ORDER BY end_ts DESC
         LIMIT 500`,
      [exerciseId],
    );
  } catch {
    // reps table may not exist locally yet — harmless
    return [];
  }
}

// ---------------------------------------------------------------------------
// Supabase fallback
// ---------------------------------------------------------------------------

async function queryRemote(exerciseId: string): Promise<ExerciseHistorySummary | null> {
  try {
    const { data, error } = await supabase
      .from('workout_session_sets')
      .select(
        'id, actual_reps, actual_weight, completed_at, ' +
          'workout_session_exercises!inner(exercise_id, workout_sessions!inner(id, started_at, ended_at))',
      )
      .eq('workout_session_exercises.exercise_id', exerciseId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(500);

    if (error || !data) return null;

    const rows: SessionSetRow[] = (data as unknown as RemoteSetRow[]).map((row) => {
      const sess = row.workout_session_exercises?.workout_sessions;
      return {
        session_id: sess?.id ?? '',
        started_at: sess?.started_at ?? null,
        ended_at: sess?.ended_at ?? null,
        set_id: row.id,
        completed_at: row.completed_at ?? null,
        actual_reps: row.actual_reps ?? null,
        actual_weight: row.actual_weight ?? null,
      };
    }).filter((r) => r.session_id.length > 0);

    if (rows.length === 0) return null;

    // FQI from reps table
    const fqiRows = await queryFqiRemote(exerciseId);
    return buildSummaryFromRows(rows, fqiRows);
  } catch {
    return null;
  }
}

async function queryFqiRemote(exerciseId: string): Promise<FqiRow[]> {
  try {
    const { data, error } = await supabase
      .from('reps')
      .select('session_id, fqi')
      .eq('exercise', exerciseId)
      .not('fqi', 'is', null)
      .order('end_ts', { ascending: false })
      .limit(500);
    if (error || !data) return [];
    return data as unknown as FqiRow[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function buildSummaryFromRows(
  rows: SessionSetRow[],
  fqiRows: FqiRow[],
): ExerciseHistorySummary {
  // Group by session
  const bySession = new Map<string, SessionSetRow[]>();
  for (const row of rows) {
    const arr = bySession.get(row.session_id);
    if (arr) arr.push(row);
    else bySession.set(row.session_id, [row]);
  }

  // Sort sessions most-recent first by ended/started
  const sessionIdsOrdered = Array.from(bySession.keys()).sort((a, b) => {
    const aTs = sessionTimestamp(bySession.get(a)?.[0]);
    const bTs = sessionTimestamp(bySession.get(b)?.[0]);
    return bTs.localeCompare(aTs);
  });

  // FQI grouped by session
  const fqiBySession = new Map<string, number[]>();
  for (const r of fqiRows) {
    if (r.fqi == null) continue;
    const arr = fqiBySession.get(r.session_id);
    if (arr) arr.push(r.fqi);
    else fqiBySession.set(r.session_id, [r.fqi]);
  }

  // Last session summary
  const lastSessionId = sessionIdsOrdered[0];
  const lastSessionRows = bySession.get(lastSessionId) ?? [];
  const lastSession = buildLastSession(lastSessionId, lastSessionRows, fqiBySession);

  // Rolling avg FQI over the last 5 sessions
  const recent5 = sessionIdsOrdered.slice(0, 5);
  const recentFqis: number[] = [];
  for (const sid of recent5) {
    const arr = fqiBySession.get(sid);
    if (arr && arr.length > 0) {
      recentFqis.push(average(arr));
    }
  }
  const last5SessionsAvgFqi = recentFqis.length > 0 ? round(average(recentFqis)) : null;

  // Max reps and max volume across all completed sets
  let maxReps: number | null = null;
  let maxVolume: number | null = null;
  for (const row of rows) {
    if (row.actual_reps != null && (maxReps == null || row.actual_reps > maxReps)) {
      maxReps = row.actual_reps;
    }
    if (row.actual_reps != null && row.actual_weight != null) {
      const volume = row.actual_reps * row.actual_weight;
      if (maxVolume == null || volume > maxVolume) maxVolume = volume;
    }
  }

  return {
    lastSession,
    last5SessionsAvgFqi,
    maxReps,
    maxVolume: maxVolume != null ? round(maxVolume) : null,
  };
}

function buildLastSession(
  sessionId: string | undefined,
  rows: SessionSetRow[],
  fqiBySession: Map<string, number[]>,
): ExerciseHistoryLastSession | null {
  if (!sessionId || rows.length === 0) return null;
  const endedAt =
    rows[0].ended_at ?? rows[0].started_at ?? rows[0].completed_at ?? new Date().toISOString();
  let totalReps = 0;
  let topWeight: number | null = null;
  for (const row of rows) {
    totalReps += row.actual_reps ?? 0;
    if (row.actual_weight != null && (topWeight == null || row.actual_weight > topWeight)) {
      topWeight = row.actual_weight;
    }
  }
  const fqis = fqiBySession.get(sessionId) ?? [];
  return {
    sessionId,
    endedAt,
    sets: rows.length,
    totalReps,
    topWeightLb: topWeight,
    avgFqi: fqis.length > 0 ? round(average(fqis)) : null,
  };
}

function sessionTimestamp(row: SessionSetRow | undefined): string {
  if (!row) return '';
  return row.ended_at ?? row.started_at ?? row.completed_at ?? '';
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
