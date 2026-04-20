/**
 * Coach Memory Context
 *
 * Turns raw session history into a short prompt clause the coach model can
 * read. Two responsibilities:
 *
 *   1. Query `workout_sessions` (last 7 / 30 days) and derive a
 *      `TrainingWeekSummary` that includes a heuristic training `phase`
 *      (recovery / building / peaking).
 *   2. Synthesize a 3–5 sentence `MemoryPromptClause` from the cached
 *      `SessionBrief` + `TrainingWeekSummary` for prepending to outgoing
 *      coach prompts.
 *
 * The phase heuristic is intentionally simple (avgRpe + volume trend); a
 * richer model is a deferred follow-up. See issue #458 non-goals.
 */

import { supabase } from '@/lib/supabase';
import { warnWithTs } from '@/lib/logger';
import {
  cacheWeekSummary,
  getCachedSessionBrief,
  getCachedWeekSummary,
  type SessionBrief,
  type TrainingWeekSummary,
} from './coach-memory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryPromptClause {
  /** 3–5 sentence plain-text clause, or `null` when there is nothing to say. */
  text: string | null;
  /**
   * Structured data used to build `text`. Exposed so callers (tests, UI
   * debug) can inspect inputs without re-parsing the string.
   */
  weekSummary: TrainingWeekSummary | null;
  lastBrief: SessionBrief | null;
}

interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  goal_profile: string | null;
}

interface SetAggregateRow {
  session_id: string;
  set_count: number;
  avg_rpe: number | null;
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function inferPhase(opts: {
  avgRpe: number | null;
  volumeTrend: TrainingWeekSummary['volumeTrend'];
  sessionCount: number;
}): TrainingWeekSummary['phase'] {
  const { avgRpe, volumeTrend, sessionCount } = opts;

  if (sessionCount === 0) return 'unknown';

  const isFalling = volumeTrend === 'falling';
  const isRising = volumeTrend === 'rising';

  // Low RPE or falling volume -> recovery / deload.
  if ((avgRpe !== null && avgRpe < 6) || isFalling) {
    return 'recovery';
  }

  // High RPE with flat/low volume -> peaking (intensity up, volume down).
  if (avgRpe !== null && avgRpe >= 8.5 && !isRising) {
    return 'peaking';
  }

  // Moderate-to-high RPE and rising/steady volume -> building.
  if (avgRpe !== null && avgRpe >= 6) {
    return 'building';
  }

  return 'unknown';
}

export function computeVolumeTrend(
  currentTotalSets: number,
  priorTotalSets: number,
): TrainingWeekSummary['volumeTrend'] {
  if (priorTotalSets === 0 && currentTotalSets === 0) return 'flat';
  if (priorTotalSets === 0) return 'rising';
  const ratio = currentTotalSets / priorTotalSets;
  if (ratio >= 1.15) return 'rising';
  if (ratio <= 0.85) return 'falling';
  return 'flat';
}

// ---------------------------------------------------------------------------
// Supabase queries
// ---------------------------------------------------------------------------

/**
 * Build a `TrainingWeekSummary` for a user by querying the last 7 days vs.
 * the prior 7 days. Results are cached in AsyncStorage for reuse on next
 * prompt.
 *
 * Errors are logged and swallowed — a missing summary is acceptable; callers
 * fall back to the most recent brief alone.
 */
export async function buildWeekSummary(userId: string, now = Date.now()): Promise<TrainingWeekSummary | null> {
  try {
    const windowStart = new Date(now - WEEK_MS).toISOString();
    const priorWindowStart = new Date(now - 2 * WEEK_MS).toISOString();

    const { data: recent, error: recentErr } = await supabase
      .from('workout_sessions')
      .select('id, started_at, ended_at, goal_profile')
      .eq('user_id', userId)
      .gte('started_at', windowStart)
      .order('started_at', { ascending: false })
      .limit(30);

    if (recentErr) {
      warnWithTs('[coach-memory-context] recent sessions query failed', recentErr.message);
      return null;
    }

    const { data: prior, error: priorErr } = await supabase
      .from('workout_sessions')
      .select('id')
      .eq('user_id', userId)
      .gte('started_at', priorWindowStart)
      .lt('started_at', windowStart);

    if (priorErr) {
      warnWithTs('[coach-memory-context] prior sessions query failed', priorErr.message);
    }

    const recentRows = (recent ?? []) as SessionRow[];
    const priorRows = (prior ?? []) as Pick<SessionRow, 'id'>[];

    const setAggregates = await fetchSetAggregates(recentRows.map((r) => r.id));
    const priorAggregates = await fetchSetAggregates(priorRows.map((r) => r.id));

    const totalSets = sumSets(setAggregates);
    const priorTotalSets = sumSets(priorAggregates);
    const avgRpe = averageRpe(setAggregates);

    const summary: TrainingWeekSummary = {
      windowStartedAt: windowStart,
      sessionCount: recentRows.length,
      totalSets,
      avgRpe,
      avgFqi: null, // FQI aggregate is owned by #444 — kept null here on purpose.
      volumeTrend: computeVolumeTrend(totalSets, priorTotalSets),
      phase: 'unknown', // filled below once all inputs are known
      cachedAt: new Date(now).toISOString(),
    };
    summary.phase = inferPhase({
      avgRpe,
      volumeTrend: summary.volumeTrend,
      sessionCount: summary.sessionCount,
    });

    await cacheWeekSummary(summary);
    return summary;
  } catch (err) {
    warnWithTs('[coach-memory-context] buildWeekSummary failed', err);
    return null;
  }
}

async function fetchSetAggregates(sessionIds: string[]): Promise<SetAggregateRow[]> {
  if (sessionIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('workout_session_sets_with_session')
      .select('session_id, set_count, avg_rpe')
      .in('session_id', sessionIds);
    if (error) {
      // View may not exist on all deployments; fall back to a lighter query.
      return fetchSetAggregatesFallback(sessionIds);
    }
    return (data ?? []) as SetAggregateRow[];
  } catch {
    return fetchSetAggregatesFallback(sessionIds);
  }
}

async function fetchSetAggregatesFallback(_sessionIds: string[]): Promise<SetAggregateRow[]> {
  // Fallback path: the joined view isn't available on all deployments and
  // we don't want a second round-trip on every coach call. Returning empty
  // aggregates keeps the week summary deterministic (null-rpe / trend=flat)
  // until the view lands. Full FQI/volume aggregation is owned by #444.
  return [];
}

function sumSets(rows: SetAggregateRow[]): number {
  return rows.reduce((acc, r) => acc + (r.set_count ?? 0), 0);
}

function averageRpe(rows: SetAggregateRow[]): number | null {
  const withRpe = rows.filter((r) => typeof r.avg_rpe === 'number' && r.avg_rpe !== null);
  if (withRpe.length === 0) return null;
  const sum = withRpe.reduce((acc, r) => acc + (r.avg_rpe as number), 0);
  return sum / withRpe.length;
}

// ---------------------------------------------------------------------------
// Clause synthesis
// ---------------------------------------------------------------------------

/**
 * Build a 3–5 sentence clause from the cached brief + summary. Returns
 * `{ text: null }` when there's not enough signal (new user, cleared memory).
 *
 * Callers can pass pre-resolved inputs for testing; without them we read
 * from the AsyncStorage caches populated by `coach-memory` + `buildWeekSummary`.
 */
export async function synthesizeMemoryClause(inputs?: {
  lastBrief?: SessionBrief | null;
  weekSummary?: TrainingWeekSummary | null;
}): Promise<MemoryPromptClause> {
  const lastBrief = inputs?.lastBrief ?? (await getCachedSessionBrief());
  const weekSummary = inputs?.weekSummary ?? (await getCachedWeekSummary());

  if (!lastBrief && !weekSummary) {
    return { text: null, lastBrief: null, weekSummary: null };
  }

  const sentences: string[] = [];

  if (lastBrief) {
    const hours = briefHoursAgo(lastBrief);
    const when = hours === null ? 'Recently' : hours < 36 ? `About ${Math.round(hours)}h ago` : 'In a prior session';
    const focus = lastBrief.topExerciseName ? ` focused on ${lastBrief.topExerciseName}` : '';
    const volume = `${lastBrief.totalSets} sets / ${lastBrief.totalReps} reps`;
    const rpe = lastBrief.avgRpe !== null ? `, avg RPE ${lastBrief.avgRpe.toFixed(1)}` : '';
    sentences.push(`${when} the athlete trained${focus}: ${volume}${rpe}.`);

    if (lastBrief.notablePositive) {
      sentences.push(`Positive: ${lastBrief.notablePositive}.`);
    }
    if (lastBrief.notableNegative) {
      sentences.push(`Watch-out: ${lastBrief.notableNegative}.`);
    }
  }

  if (weekSummary && weekSummary.sessionCount > 0) {
    const phase = weekSummary.phase === 'unknown' ? 'mixed' : weekSummary.phase;
    const trend = weekSummary.volumeTrend;
    const rpe = weekSummary.avgRpe !== null ? `, avg RPE ${weekSummary.avgRpe.toFixed(1)}` : '';
    sentences.push(
      `Over the last 7 days: ${weekSummary.sessionCount} session(s), ${weekSummary.totalSets} total sets, volume ${trend}${rpe}; current phase: ${phase}.`,
    );
  }

  // Cap at 5 sentences to keep prompt tokens bounded.
  const capped = sentences.slice(0, 5);
  return {
    text: capped.length === 0 ? null : capped.join(' '),
    lastBrief,
    weekSummary,
  };
}

function briefHoursAgo(brief: SessionBrief): number | null {
  const end = brief.endedAt ? Date.parse(brief.endedAt) : Date.parse(brief.startedAt);
  if (Number.isNaN(end)) return null;
  return (Date.now() - end) / (60 * 60 * 1000);
}
