/**
 * Exercise history aggregator.
 *
 * Composes local-db lookups, the rep-max calculator, and the PR detector
 * into a single read-only view that powers the overload analytics card
 * and the progression plan modal.
 *
 * Pure in terms of logic (no UI), async in terms of I/O. Consumers pass a
 * userId/exerciseNameOrId pair and an optional history window.
 */

import { localDB, type LocalWorkout } from './database/local-db';
import { estimateOneRepMaxAveraged } from './rep-max-calculator';
import {
  detectAllPrs,
  type PrResult,
  type SetRecord,
} from './pr-detector';

export interface ExerciseHistorySet {
  id: string;
  weight: number;
  reps: number;
  sets: number;
  duration?: number;
  date: string;
}

export interface TrendSeries {
  label: string;
  values: number[];
  /** ISO date for each value. */
  dates: string[];
}

export interface ExerciseHistorySummary {
  exercise: string;
  sets: ExerciseHistorySet[];
  volumeTrend: TrendSeries;
  repTrend: TrendSeries;
  lastSession: ExerciseHistorySet | null;
  prData: PrResult[];
  /** Current best estimated 1RM across the entire window. */
  estimatedOneRepMax: number;
}

export interface ExerciseHistoryInput {
  userId: string;
  exerciseNameOrId: string;
  /** Maximum rows to pull from local history. Defaults to 50. */
  limit?: number;
}

const DEFAULT_LIMIT = 50;

function toHistorySet(row: LocalWorkout): ExerciseHistorySet | null {
  if (!row) return null;
  return {
    id: row.id,
    weight: typeof row.weight === 'number' ? row.weight : 0,
    reps: typeof row.reps === 'number' ? row.reps : 0,
    sets: typeof row.sets === 'number' ? row.sets : 0,
    duration: typeof row.duration === 'number' ? row.duration : undefined,
    date: row.date,
  };
}

function buildVolumeTrend(sets: ExerciseHistorySet[]): TrendSeries {
  // sets are newest-first; invert so charts render left-to-right chronologically.
  const ordered = [...sets].reverse();
  return {
    label: 'Volume',
    values: ordered.map((s) => Math.round(s.weight * s.reps * Math.max(1, s.sets))),
    dates: ordered.map((s) => s.date),
  };
}

function buildRepTrend(sets: ExerciseHistorySet[]): TrendSeries {
  const ordered = [...sets].reverse();
  return {
    label: 'Reps per set',
    values: ordered.map((s) => s.reps),
    dates: ordered.map((s) => s.date),
  };
}

function bestOneRepMaxOver(sets: ExerciseHistorySet[]): number {
  let best = 0;
  for (const s of sets) {
    if (!s.weight || !s.reps) continue;
    const est = estimateOneRepMaxAveraged({ weight: s.weight, reps: s.reps }).oneRepMax;
    if (est > best) best = est;
  }
  return Math.round(best);
}

export async function getExerciseHistorySummary(
  input: ExerciseHistoryInput,
): Promise<ExerciseHistorySummary> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const rows = await localDB.getWorkoutsByExercise(
    input.userId,
    input.exerciseNameOrId,
    limit,
  );

  const normalized = rows
    .map(toHistorySet)
    .filter((r): r is ExerciseHistorySet => r !== null && r.weight > 0 && r.reps > 0);

  const lastSession = normalized[0] ?? null;

  let prData: PrResult[] = [];
  if (lastSession && normalized.length > 1) {
    const previous: SetRecord[] = normalized.slice(1).map((s) => ({
      weight: s.weight,
      reps: s.reps,
      date: s.date,
    }));
    prData = detectAllPrs(
      { weight: lastSession.weight, reps: lastSession.reps, date: lastSession.date },
      previous,
    );
  } else if (lastSession) {
    // First-ever set: every category is a PR by default.
    prData = detectAllPrs(
      { weight: lastSession.weight, reps: lastSession.reps, date: lastSession.date },
      [],
    );
  }

  return {
    exercise: input.exerciseNameOrId,
    sets: normalized,
    volumeTrend: buildVolumeTrend(normalized),
    repTrend: buildRepTrend(normalized),
    lastSession,
    prData,
    estimatedOneRepMax: bestOneRepMaxOver(normalized),
  };
}
