/**
 * coach-workout-recall
 *
 * Assembles a structured retrospective context for the Gemma coach when
 * a user asks to review a past workout. The service is pure and safe to
 * call regardless of whether the EXPO_PUBLIC_WORKOUT_COACH_RECALL flag
 * is enabled — the gating happens at the hook layer.
 *
 * Data sources:
 *   - `workouts` table in local-db (exercise name, sets/reps/weight, date)
 *   - `form-session-history` AsyncStorage log (avg FQI per exercise, ended-at)
 *
 * Emitted context:
 *   - `WorkoutRecallContext` — structured summary used by the hook/UI.
 *   - `buildWorkoutRecallPrompt` — renders the context to a single string
 *     that the coach service can consume as the user's opening prompt.
 *
 * Best-effort: each dependency (db, history store) can fail independently
 * and the service degrades to partial context rather than throwing. The
 * caller always gets a `WorkoutRecallContext` — the `found` flag says
 * whether the workout id was actually resolved.
 */
import { localDB } from '@/lib/services/database/local-db';
import { warnWithTs } from '@/lib/logger';
import {
  getFormSessionHistory,
  type FormSessionHistoryEntry,
} from '@/lib/services/form-session-history';
import { resolveExerciseKey } from '@/lib/services/form-session-history-lookup';

// =============================================================================
// Types
// =============================================================================

export interface WorkoutRecallContext {
  /** The workout id requested by the caller. */
  workoutId: string;
  /** True when the workout row was found in local-db. */
  found: boolean;
  /** User-facing exercise name, or null when the workout wasn't found. */
  exerciseName: string | null;
  /** ISO date string from the workouts row, or null. */
  dateIso: string | null;
  /** Logged set count (0 when missing). */
  sets: number;
  /** Logged rep count per set (null when not recorded). */
  reps: number | null;
  /** Logged weight value (null when not recorded). */
  weight: number | null;
  /** Logged duration in minutes (null when not recorded). */
  durationMinutes: number | null;
  /**
   * Most-recent form-session-history entry for this exercise when one
   * exists. Lets the coach reference an FQI baseline without us having
   * to round-trip through coach-service.
   */
  latestFormEntry: FormSessionHistoryEntry | null;
}

interface WorkoutRow {
  id: string;
  exercise: string;
  sets: number;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  date: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Builds the retrospective context for a given workout id. Always
 * returns a `WorkoutRecallContext` — callers inspect `.found` to decide
 * whether to render the prompt or a "workout not found" fallback.
 */
export async function buildWorkoutRecallContext(
  workoutId: string,
): Promise<WorkoutRecallContext> {
  const empty: WorkoutRecallContext = {
    workoutId,
    found: false,
    exerciseName: null,
    dateIso: null,
    sets: 0,
    reps: null,
    weight: null,
    durationMinutes: null,
    latestFormEntry: null,
  };

  if (!workoutId || typeof workoutId !== 'string') {
    return empty;
  }

  const row = await safeFetchWorkoutRow(workoutId);
  if (!row) {
    return empty;
  }

  const latestFormEntry = await safeFetchLatestFormEntry(row.exercise);

  return {
    workoutId,
    found: true,
    exerciseName: row.exercise,
    dateIso: row.date,
    sets: Number.isFinite(row.sets) ? row.sets : 0,
    reps: row.reps,
    weight: row.weight,
    durationMinutes: row.duration,
    latestFormEntry,
  };
}

/**
 * Renders a `WorkoutRecallContext` into a single human-readable prompt
 * the coach can use as the opening user turn. The prompt deliberately
 * reads as a first-person user summary so Gemma treats it as the
 * athlete's own framing rather than a system directive.
 *
 * When the context was not found, returns a graceful fallback string
 * so callers never need to branch on `ctx.found`.
 */
export function buildWorkoutRecallPrompt(ctx: WorkoutRecallContext): string {
  if (!ctx.found || !ctx.exerciseName) {
    return (
      "I wanted to review an old workout but I can't find it in my " +
      'history. Can you ask me what I remember about it so we can still ' +
      'talk through it?'
    );
  }

  const dateLabel = formatDateLabel(ctx.dateIso);
  const setsLabel = ctx.sets > 0 ? `${ctx.sets} set${ctx.sets === 1 ? '' : 's'}` : 'some sets';
  const repsLabel =
    ctx.reps != null && Number.isFinite(ctx.reps) && ctx.reps > 0
      ? `${ctx.reps} reps each`
      : null;
  const weightLabel =
    ctx.weight != null && Number.isFinite(ctx.weight) && ctx.weight > 0
      ? `${ctx.weight} lb`
      : null;
  const durationLabel =
    ctx.durationMinutes != null &&
    Number.isFinite(ctx.durationMinutes) &&
    ctx.durationMinutes > 0
      ? `${ctx.durationMinutes} min`
      : null;

  const fqiLabel = ctx.latestFormEntry
    ? `My most-recent tracked form FQI was ${Math.round(ctx.latestFormEntry.avgFqi)} out of 100.`
    : 'I have no tracked form-quality data for this exercise yet.';

  const statsParts = [setsLabel, repsLabel, weightLabel, durationLabel].filter(
    (part): part is string => !!part,
  );
  const statsLine = statsParts.length > 0 ? statsParts.join(', ') : 'no detailed stats';

  return [
    `I want to look back at my ${ctx.exerciseName} workout from ${dateLabel}.`,
    `Here is what I logged: ${statsLine}.`,
    fqiLabel,
    'Can you help me debrief this session and suggest what to work on next?',
  ].join(' ');
}

// =============================================================================
// Internals
// =============================================================================

async function safeFetchWorkoutRow(workoutId: string): Promise<WorkoutRow | null> {
  try {
    const db = localDB.db;
    if (!db) return null;
    const rows = await db.getAllAsync<WorkoutRow>(
      `SELECT id, exercise, sets, reps, weight, duration, date
         FROM workouts
        WHERE id = ? AND deleted = 0
        LIMIT 1`,
      workoutId,
    );
    return rows[0] ?? null;
  } catch (err) {
    warnWithTs('[coach-workout-recall] workout lookup failed', err);
    return null;
  }
}

async function safeFetchLatestFormEntry(
  exerciseName: string,
): Promise<FormSessionHistoryEntry | null> {
  try {
    const key = resolveExerciseKey(exerciseName);
    if (!key) return null;
    const history = await getFormSessionHistory(key);
    return history[0] ?? null;
  } catch (err) {
    warnWithTs('[coach-workout-recall] form-history lookup failed', err);
    return null;
  }
}

function formatDateLabel(iso: string | null): string {
  if (!iso) return 'an earlier day';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'an earlier day';
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'an earlier day';
  }
}
