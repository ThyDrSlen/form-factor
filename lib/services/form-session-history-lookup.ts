/**
 * Form Session History — Exercise-Name Lookup
 *
 * Helper utilities that bridge a user-facing exercise string (e.g.
 * "Pull-Up", "pullups", "pull up") to the detection-mode key used by
 * form-session-history (e.g. `pullup`). Kept out of the history service
 * so the store stays key-agnostic.
 */
import { getFormSessionHistory } from '@/lib/services/form-session-history';
import { getWorkoutIds } from '@/lib/workouts';

function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve a user-facing exercise name / id to the canonical detection
 * mode used by form-session-history. Returns null when no match exists.
 */
export function resolveExerciseKey(exerciseName: string): string | null {
  if (!exerciseName) return null;
  const normalised = normalise(exerciseName);
  const candidates = getWorkoutIds();
  // 1) exact match on the canonical id (already normalised).
  for (const id of candidates) {
    if (normalise(id) === normalised) return id;
  }
  // 2) substring match ("pullups" → "pullup", "pull_up" → "pullup").
  for (const id of candidates) {
    const normId = normalise(id);
    if (normalised.startsWith(normId) || normId.startsWith(normalised)) {
      return id;
    }
  }
  return null;
}

/**
 * Fetch the most-recent session FQI for a given exercise name, or null
 * when the exercise has no tracked sessions yet. Caller maps to a badge.
 */
export async function getMostRecentAvgFqi(
  exerciseName: string,
): Promise<number | null> {
  const key = resolveExerciseKey(exerciseName);
  if (!key) return null;
  const history = await getFormSessionHistory(key);
  if (!history.length) return null;
  const latest = history[0];
  return latest.avgFqi;
}
