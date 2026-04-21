/**
 * Session-to-session form comparison aggregator.
 *
 * Pure functions that diff two `ExerciseSessionSummary` objects for the same
 * exercise and produce a {@link SessionComparison} — used by the form
 * comparison modal and `useSessionComparison` hook.
 *
 * No React, no database, no side effects. A loader helper
 * ({@link fetchSessionsForComparison}) sits in this file for convenience but
 * is called only from the hook/modal.
 */

import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

/** Per-session aggregate for a single exercise within that session. */
export interface ExerciseSessionSummary {
  sessionId: string;
  exerciseId: string;
  /** ISO end timestamp of the session. */
  completedAt: string;
  repCount: number;
  avgFqi: number | null;
  avgRomDeg: number | null;
  avgDepthRatio: number | null;
  /** Mean left/right asymmetry in degrees. Higher = worse. */
  avgSymmetryDeg: number | null;
  /**
   * Mean inter-rep pause in seconds (end of rep N → start of rep N+1).
   * `null` (or omitted) when there are fewer than 2 reps or timestamps are
   * missing. Optional so callers built before this field existed compile
   * unchanged; the aggregator + delta helpers treat missing the same as
   * `null`.
   */
  avgRestSec?: number | null;
  /** fault_id → number of reps with that fault detected in this session. */
  faultCounts: Record<string, number>;
}

export type OverallTrend =
  | 'improving'
  | 'regressing'
  | 'mixed'
  | 'unchanged'
  | 'baseline';

export interface SessionComparison {
  currentSessionId: string;
  /** `null` when this is the user's first session for the exercise. */
  priorSessionId: string | null;
  currentSummary: ExerciseSessionSummary;
  /** `null` when there is no prior session to compare against. */
  priorSummary: ExerciseSessionSummary | null;
  /** Current minus prior. Positive = improvement. `null` if either side missing. */
  fqiDelta: number | null;
  romDeltaDeg: number | null;
  depthDeltaRatio: number | null;
  /** Current minus prior. Negative = improvement (less asymmetry). */
  symmetryDeltaDeg: number | null;
  /** Current minus prior. Positive = added reps. `null` when baseline. */
  repCountDelta: number | null;
  /**
   * Current minus prior average inter-rep rest in seconds. Direction is not
   * a straight win/loss — callers decide how to color a swing (e.g. shorter
   * rest on a conditioning block is positive; longer rest on a strength
   * session can also be positive).
   */
  restDeltaSec: number | null;
  /** Current minus prior total fault events. Negative = improvement. */
  faultCountDelta: number | null;
  /** Fault ids that appeared in current but not prior. */
  newFaults: string[];
  /** Fault ids that appeared in prior but not current. */
  resolvedFaults: string[];
  overallTrend: OverallTrend;
}

// =============================================================================
// Pure helpers
// =============================================================================

function subtract(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return a - b;
}

function totalFaultCount(counts: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(counts)) total += value;
  return total;
}

/** New and resolved faults given prior and current fault histograms. */
export function diffFaultIds(
  current: Record<string, number>,
  prior: Record<string, number>,
): { newFaults: string[]; resolvedFaults: string[] } {
  const currentActive = new Set(
    Object.entries(current)
      .filter(([, count]) => count > 0)
      .map(([id]) => id),
  );
  const priorActive = new Set(
    Object.entries(prior)
      .filter(([, count]) => count > 0)
      .map(([id]) => id),
  );
  const newFaults: string[] = [];
  for (const id of currentActive) if (!priorActive.has(id)) newFaults.push(id);
  const resolvedFaults: string[] = [];
  for (const id of priorActive) if (!currentActive.has(id)) resolvedFaults.push(id);
  newFaults.sort();
  resolvedFaults.sort();
  return { newFaults, resolvedFaults };
}

/** Classify direction across the four metric deltas. */
export function classifyTrend(deltas: {
  fqiDelta: number | null;
  romDeltaDeg: number | null;
  symmetryDeltaDeg: number | null;
  faultCountDelta: number | null;
}): OverallTrend {
  const signals: Array<1 | -1> = [];
  if (deltas.fqiDelta != null && Math.abs(deltas.fqiDelta) >= 1) {
    signals.push(deltas.fqiDelta > 0 ? 1 : -1);
  }
  if (deltas.romDeltaDeg != null && Math.abs(deltas.romDeltaDeg) >= 2) {
    signals.push(deltas.romDeltaDeg > 0 ? 1 : -1);
  }
  if (deltas.symmetryDeltaDeg != null && Math.abs(deltas.symmetryDeltaDeg) >= 1) {
    signals.push(deltas.symmetryDeltaDeg < 0 ? 1 : -1);
  }
  if (deltas.faultCountDelta != null && deltas.faultCountDelta !== 0) {
    signals.push(deltas.faultCountDelta < 0 ? 1 : -1);
  }

  if (signals.length === 0) return 'unchanged';
  const positives = signals.filter((s) => s === 1).length;
  const negatives = signals.length - positives;
  if (positives > 0 && negatives === 0) return 'improving';
  if (negatives > 0 && positives === 0) return 'regressing';
  return 'mixed';
}

// =============================================================================
// Main aggregator
// =============================================================================

/**
 * Compute a full {@link SessionComparison} from two session summaries.
 * If `prior` is `null`, returns a comparison marked as `baseline` (first session).
 */
export function buildSessionComparison(
  current: ExerciseSessionSummary,
  prior: ExerciseSessionSummary | null,
): SessionComparison {
  if (!prior) {
    return {
      currentSessionId: current.sessionId,
      priorSessionId: null,
      currentSummary: current,
      priorSummary: null,
      fqiDelta: null,
      romDeltaDeg: null,
      depthDeltaRatio: null,
      symmetryDeltaDeg: null,
      repCountDelta: null,
      restDeltaSec: null,
      faultCountDelta: null,
      newFaults: [],
      resolvedFaults: [],
      overallTrend: 'baseline',
    };
  }

  const fqiDelta = subtract(current.avgFqi, prior.avgFqi);
  const romDeltaDeg = subtract(current.avgRomDeg, prior.avgRomDeg);
  const depthDeltaRatio = subtract(current.avgDepthRatio, prior.avgDepthRatio);
  const symmetryDeltaDeg = subtract(current.avgSymmetryDeg, prior.avgSymmetryDeg);
  const repCountDelta = current.repCount - prior.repCount;
  const restDeltaSec = subtract(current.avgRestSec ?? null, prior.avgRestSec ?? null);
  const faultCountDelta =
    totalFaultCount(current.faultCounts) - totalFaultCount(prior.faultCounts);
  const { newFaults, resolvedFaults } = diffFaultIds(
    current.faultCounts,
    prior.faultCounts,
  );

  return {
    currentSessionId: current.sessionId,
    priorSessionId: prior.sessionId,
    currentSummary: current,
    priorSummary: prior,
    fqiDelta,
    romDeltaDeg,
    depthDeltaRatio,
    symmetryDeltaDeg,
    repCountDelta,
    restDeltaSec,
    faultCountDelta,
    newFaults,
    resolvedFaults,
    overallTrend: classifyTrend({
      fqiDelta,
      romDeltaDeg,
      symmetryDeltaDeg,
      faultCountDelta,
    }),
  };
}

// =============================================================================
// Data loader (Supabase)
// =============================================================================

type RepRow = {
  session_id: string;
  exercise: string;
  start_ts: string;
  end_ts: string;
  fqi: number | null;
  features: Record<string, number | undefined> | null;
  faults_detected: string[] | null;
};

interface SummarizeArgs {
  rows: RepRow[];
  sessionId: string;
  exerciseId: string;
}

/** Build an {@link ExerciseSessionSummary} from raw rep rows. Exported for testing. */
export function summarizeSessionFromReps({
  rows,
  sessionId,
  exerciseId,
}: SummarizeArgs): ExerciseSessionSummary | null {
  const filtered = rows.filter(
    (row) => row.session_id === sessionId && row.exercise === exerciseId,
  );
  if (filtered.length === 0) return null;

  const fqis: number[] = [];
  const roms: number[] = [];
  const depths: number[] = [];
  const symmetries: number[] = [];
  const faultCounts: Record<string, number> = {};
  let completedAt = filtered[0].end_ts;

  for (const row of filtered) {
    if (row.end_ts > completedAt) completedAt = row.end_ts;
    if (row.fqi != null) fqis.push(row.fqi);
    const features = row.features ?? {};
    const rom = features.romDeg;
    if (typeof rom === 'number' && Number.isFinite(rom)) roms.push(rom);
    const depth = features.depthRatio;
    if (typeof depth === 'number' && Number.isFinite(depth)) depths.push(depth);
    const symmetry = features.symmetryDeg;
    if (typeof symmetry === 'number' && Number.isFinite(symmetry)) symmetries.push(symmetry);
    for (const faultId of row.faults_detected ?? []) {
      faultCounts[faultId] = (faultCounts[faultId] ?? 0) + 1;
    }
  }

  const mean = (values: number[]): number | null =>
    values.length === 0
      ? null
      : Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100;

  const avgRestSec = computeAvgRestSec(filtered);

  return {
    sessionId,
    exerciseId,
    completedAt,
    repCount: filtered.length,
    avgFqi: mean(fqis),
    avgRomDeg: mean(roms),
    avgDepthRatio: mean(depths),
    avgSymmetryDeg: mean(symmetries),
    avgRestSec,
    faultCounts,
  };
}

/**
 * Mean gap between the end of rep N and the start of rep N+1, in seconds.
 * Skips negative gaps (malformed data) and returns `null` when we cannot
 * derive at least one valid gap (e.g. a single-rep session).
 */
function computeAvgRestSec(rows: RepRow[]): number | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => (a.start_ts < b.start_ts ? -1 : 1));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prevEnd = Date.parse(sorted[i - 1].end_ts);
    const thisStart = Date.parse(sorted[i].start_ts);
    if (!Number.isFinite(prevEnd) || !Number.isFinite(thisStart)) continue;
    const gapMs = thisStart - prevEnd;
    if (gapMs <= 0) continue;
    gaps.push(gapMs / 1000);
  }
  if (gaps.length === 0) return null;
  const sum = gaps.reduce((acc, v) => acc + v, 0);
  return Math.round((sum / gaps.length) * 10) / 10;
}

export interface FetchComparisonArgs {
  currentSessionId: string;
  exerciseId: string;
  userId: string;
}

export interface FetchComparisonResult {
  current: ExerciseSessionSummary | null;
  prior: ExerciseSessionSummary | null;
}

/**
 * Load the given session and the most recent prior session for the same
 * exercise from Supabase, then aggregate both into summaries.
 * Returns `{ current: null, prior: null }` when the current session has no
 * reps yet (empty result set).
 */
export async function fetchSessionsForComparison({
  currentSessionId,
  exerciseId,
  userId,
}: FetchComparisonArgs): Promise<FetchComparisonResult> {
  const { data: currentRows, error: currentError } = await supabase
    .from('reps')
    .select('session_id, exercise, start_ts, end_ts, fqi, features, faults_detected')
    .eq('user_id', userId)
    .eq('session_id', currentSessionId)
    .eq('exercise', exerciseId);

  if (currentError) throw currentError;
  const current = summarizeSessionFromReps({
    rows: (currentRows ?? []) as RepRow[],
    sessionId: currentSessionId,
    exerciseId,
  });

  if (!current) return { current: null, prior: null };

  const { data: priorSessionRow, error: priorSessionError } = await supabase
    .from('reps')
    .select('session_id, end_ts')
    .eq('user_id', userId)
    .eq('exercise', exerciseId)
    .lt('end_ts', current.completedAt)
    .order('end_ts', { ascending: false })
    .limit(1);

  if (priorSessionError) throw priorSessionError;
  const priorSessionId = priorSessionRow?.[0]?.session_id ?? null;
  if (!priorSessionId) return { current, prior: null };

  const { data: priorRows, error: priorError } = await supabase
    .from('reps')
    .select('session_id, exercise, start_ts, end_ts, fqi, features, faults_detected')
    .eq('user_id', userId)
    .eq('session_id', priorSessionId)
    .eq('exercise', exerciseId);

  if (priorError) throw priorError;
  const prior = summarizeSessionFromReps({
    rows: (priorRows ?? []) as RepRow[],
    sessionId: priorSessionId,
    exerciseId,
  });

  return { current, prior };
}
