/**
 * Workout-history context enricher for the on-device coach.
 *
 * Reads the user's recent local workout data (via `local-db.ts`) and
 * produces a compact free-text summary that the coach prompt builder
 * prepends as "Recent training context". Capped in byte-size so we
 * never blow the ~400-token budget Gemma can comfortably ingest along
 * with the system prompt.
 *
 * Zero cloud dependency — all data is read from SQLite.
 */

import { localDB, type LocalWorkout } from '@/lib/services/database/local-db';
import { warnWithTs } from '@/lib/logger';

/**
 * Roughly 4 chars per token for English text (OpenAI+Gemma heuristic).
 * 400 tokens ≈ 1600 chars, leave headroom for the wrapper string.
 */
export const MAX_CONTEXT_CHARS = 1500;

/** Max workouts to include in the summary, newest first. */
export const MAX_RECENT_WORKOUTS = 10;

export interface EnrichedContextOptions {
  maxWorkouts?: number;
  maxChars?: number;
  /**
   * Dependency injection for testing. Falls back to `localDB.getAllWorkouts`.
   */
  fetchWorkouts?: () => Promise<LocalWorkout[]>;
}

/**
 * Format a single workout row as a terse `date — exercise (sets×reps @ weight)`.
 * Omits missing fields so we don't waste tokens on nulls.
 */
export function formatWorkoutLine(w: LocalWorkout): string {
  const parts: string[] = [];
  if (w.date) parts.push(w.date);
  parts.push(w.exercise);
  const setsReps: string[] = [];
  if (typeof w.sets === 'number') setsReps.push(`${w.sets}s`);
  if (typeof w.reps === 'number') setsReps.push(`${w.reps}r`);
  if (typeof w.weight === 'number') setsReps.push(`${w.weight}lb`);
  if (typeof w.duration === 'number') setsReps.push(`${w.duration}s dur`);
  if (setsReps.length > 0) parts.push(setsReps.join(' '));
  return parts.join(' — ');
}

/**
 * Build the terse summary string. Pure — no I/O.
 */
export function summarizeWorkouts(
  workouts: LocalWorkout[],
  maxChars: number = MAX_CONTEXT_CHARS
): string {
  if (workouts.length === 0) return '';

  // Already sorted by date DESC when coming from getAllWorkouts, but sort
  // defensively in case the caller injects an unsorted list.
  const sorted = [...workouts].sort((a, b) => (a.date > b.date ? -1 : 1));

  const lines: string[] = [];
  let totalLen = 0;
  const header = `Last ${sorted.length} workouts: `;
  totalLen += header.length;

  for (const w of sorted) {
    const line = formatWorkoutLine(w);
    const add = (lines.length === 0 ? 0 : 2) + line.length; // 2 for "; "
    if (totalLen + add > maxChars) break;
    lines.push(line);
    totalLen += add;
  }

  if (lines.length === 0) return '';
  return header + lines.join('; ') + '.';
}

/**
 * Pull the last N workouts from the local DB, guarding against errors.
 * Returns an empty array on failure so the caller can degrade gracefully.
 */
export async function fetchRecentWorkouts(
  limit: number = MAX_RECENT_WORKOUTS,
  fetcher?: () => Promise<LocalWorkout[]>
): Promise<LocalWorkout[]> {
  try {
    const all = fetcher ? await fetcher() : await localDB.getAllWorkouts();
    // Caller may already sort; re-sort defensively and slice to limit.
    return [...all].sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, limit);
  } catch (err) {
    warnWithTs('[coach-context] Failed to load local workouts', err);
    return [];
  }
}

/**
 * Main entrypoint — async because it touches SQLite.
 *
 * Returns `''` (empty string) when there is no usable context. Callers
 * should treat empty as "skip enrichment" and avoid polluting the prompt
 * with a pointless header.
 */
export async function enrichCoachContext(
  options: EnrichedContextOptions = {}
): Promise<string> {
  const { maxWorkouts = MAX_RECENT_WORKOUTS, maxChars = MAX_CONTEXT_CHARS, fetchWorkouts } = options;
  const workouts = await fetchRecentWorkouts(maxWorkouts, fetchWorkouts);
  return summarizeWorkouts(workouts, maxChars);
}
