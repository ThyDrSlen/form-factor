/**
 * PR Detector
 *
 * Detects whether a just-completed set constitutes a new Personal Record
 * for a given user+exercise. Three PR types are recognised:
 *
 *  - `weight`      — the set moved more weight than any prior set (any reps)
 *  - `reps_at_weight` — same weight as a prior max, but more reps
 *  - `fqi_at_weight`  — same weight+reps, but better form quality
 *
 * Query target: Supabase `sets` table (created in migration 018) which stores
 *   set_id, user_id, session_id, exercise, load_value, load_unit, reps_count,
 *   avg_fqi, created_at. RLS restricts rows to the owning user.
 *
 * Failure modes (all return `null`, never throw):
 *   - Supabase error / RLS denial / network offline → log + null
 *   - Empty history → null (first-ever set is not treated as a PR)
 *   - NaN / missing weight on current set → null
 *   - Invalid exerciseId → null
 *
 * Issue #447 W3-C item #2.
 */

import { supabase } from '@/lib/supabase';
import { errorWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal shape of a set we need to detect a PR. Designed to match
 * `WorkoutSessionSet` or an ad-hoc set logged elsewhere — callers only need
 * to supply these three fields plus an optional FQI.
 */
export interface Set {
  /** Weight lifted on this set. Unit matches the user's preference. */
  weight: number;
  /** Reps completed on this set. */
  reps: number;
  /** Optional average FQI (0-100) from form tracking. */
  avgFqi?: number | null;
}

export type PRType = 'weight' | 'reps_at_weight' | 'fqi_at_weight';

export interface PRResult {
  /** Which variety of PR was hit. */
  type: PRType;
  /** The value that became the new record (weight/reps/fqi depending on type). */
  value: number;
  /** The prior best we beat (null when there was no comparable prior set). */
  previousBest: number | null;
  /** Exercise identifier the PR applies to. */
  exerciseId: string;
}

// =============================================================================
// Internal helpers
// =============================================================================

interface SupabaseSetRow {
  load_value: number | null;
  reps_count: number | null;
  avg_fqi: number | null;
}

/** Query historical sets for (userId, exerciseId). Returns `null` on error. */
async function fetchHistory(
  userId: string,
  exerciseId: string,
): Promise<SupabaseSetRow[] | null> {
  try {
    const { data, error } = await supabase
      .from('sets')
      .select('load_value, reps_count, avg_fqi')
      .eq('user_id', userId)
      .eq('exercise', exerciseId);

    if (error) {
      errorWithTs('[pr-detector] Supabase error fetching history', {
        code: error.code,
        message: error.message,
        userId,
        exerciseId,
      });
      return null;
    }
    return (data ?? []) as SupabaseSetRow[];
  } catch (err) {
    errorWithTs('[pr-detector] Unexpected error fetching history', err);
    return null;
  }
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Detect whether `currentSet` is a PR for `(userId, exerciseId)`.
 *
 * Checks PR types in descending priority: weight → reps-at-weight → fqi-at-weight.
 * Returns the first hit; returns `null` if no PR or any error occurs.
 */
export async function detectNewPR(
  userId: string,
  exerciseId: string,
  currentSet: Set,
): Promise<PRResult | null> {
  // --- Input guards --------------------------------------------------------
  if (!userId || typeof userId !== 'string') return null;
  if (!exerciseId || typeof exerciseId !== 'string') return null;
  if (!currentSet || typeof currentSet !== 'object') return null;
  if (!isFiniteNumber(currentSet.weight)) return null;
  if (!isFiniteNumber(currentSet.reps) || currentSet.reps <= 0) return null;

  const history = await fetchHistory(userId, exerciseId);
  if (history === null) return null; // query failed → no PR claim
  if (history.length === 0) return null; // first-ever set — don't celebrate

  // --- PR type 1: new max weight ------------------------------------------
  let priorMaxWeight = -Infinity;
  for (const row of history) {
    if (isFiniteNumber(row.load_value) && row.load_value > priorMaxWeight) {
      priorMaxWeight = row.load_value;
    }
  }
  if (priorMaxWeight !== -Infinity && currentSet.weight > priorMaxWeight) {
    return {
      type: 'weight',
      value: currentSet.weight,
      previousBest: priorMaxWeight,
      exerciseId,
    };
  }

  // --- PR type 2: new reps at this weight ---------------------------------
  // Compare against rows that lifted the same load.
  let priorMaxRepsAtWeight = -Infinity;
  for (const row of history) {
    if (!isFiniteNumber(row.load_value) || row.load_value !== currentSet.weight) continue;
    if (isFiniteNumber(row.reps_count) && row.reps_count > priorMaxRepsAtWeight) {
      priorMaxRepsAtWeight = row.reps_count;
    }
  }
  if (priorMaxRepsAtWeight !== -Infinity && currentSet.reps > priorMaxRepsAtWeight) {
    return {
      type: 'reps_at_weight',
      value: currentSet.reps,
      previousBest: priorMaxRepsAtWeight,
      exerciseId,
    };
  }

  // --- PR type 3: better FQI at same weight+reps --------------------------
  if (isFiniteNumber(currentSet.avgFqi) && currentSet.avgFqi >= 0) {
    let priorBestFqiAt = -Infinity;
    for (const row of history) {
      if (!isFiniteNumber(row.load_value) || row.load_value !== currentSet.weight) continue;
      if (!isFiniteNumber(row.reps_count) || row.reps_count !== currentSet.reps) continue;
      if (isFiniteNumber(row.avg_fqi) && row.avg_fqi > priorBestFqiAt) {
        priorBestFqiAt = row.avg_fqi;
      }
    }
    if (priorBestFqiAt !== -Infinity && currentSet.avgFqi > priorBestFqiAt) {
      return {
        type: 'fqi_at_weight',
        value: currentSet.avgFqi,
        previousBest: priorBestFqiAt,
        exerciseId,
      };
    }
  }

  return null;
}

/**
 * Format a PR result into a short user-facing celebration string.
 * Kept pure (no haptics/telemetry) so both tests and UI layers can use it.
 */
export function formatPRMessage(pr: PRResult, unit: 'lb' | 'kg' = 'lb'): string {
  switch (pr.type) {
    case 'weight':
      return `New weight PR: ${pr.value} ${unit} (was ${pr.previousBest ?? '–'} ${unit})`;
    case 'reps_at_weight':
      return `New reps PR: ${pr.value} reps (was ${pr.previousBest ?? '–'})`;
    case 'fqi_at_weight':
      return `New form PR: ${Math.round(pr.value)}% FQI`;
  }
}
