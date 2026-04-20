import { logSet } from '@/lib/services/rep-logger';
import type { SetSummary } from '@/lib/types/telemetry';
import type {
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionSet,
  Exercise,
} from '@/lib/types/workout-session';
import { errorWithTs, logWithTs } from '@/lib/logger';

export interface BinderSnapshot {
  activeSession: WorkoutSession | null;
  exercises: (WorkoutSessionExercise & { exercise?: Exercise })[];
  sets: Record<string, WorkoutSessionSet[]>;
}

export type SetLogger = (summary: SetSummary) => Promise<string>;

export interface DetectCompletionOptions {
  /** Default unit when the session didn't record one explicitly. */
  defaultLoadUnit?: 'kg' | 'lbs';
}

export interface CompletedSetPayload {
  summary: SetSummary;
  sessionSetId: string;
}

/**
 * Compare two session-runner snapshots and return `SetSummary` payloads for
 * every set whose `completed_at` transitioned from falsy to truthy.
 *
 * Pure function — no side effects. The binder hook feeds the logger.
 */
export function detectCompletedSets(
  prev: BinderSnapshot | null,
  next: BinderSnapshot,
  options: DetectCompletionOptions = {},
): CompletedSetPayload[] {
  const session = next.activeSession;
  if (!session) return [];

  const prevCompletedIds = new Set<string>();
  if (prev) {
    for (const list of Object.values(prev.sets)) {
      for (const row of list) {
        if (row.completed_at) prevCompletedIds.add(row.id);
      }
    }
  }

  const exerciseById = new Map(next.exercises.map((row) => [row.id, row]));

  const payloads: CompletedSetPayload[] = [];
  for (const [sessionExerciseId, list] of Object.entries(next.sets)) {
    for (const row of list) {
      if (!row.completed_at) continue;
      if (prevCompletedIds.has(row.id)) continue;

      const sessionExercise = exerciseById.get(sessionExerciseId);
      const exerciseName =
        sessionExercise?.exercise?.name ??
        sessionExercise?.exercise_id ??
        sessionExerciseId;

      const summary: SetSummary = {
        sessionId: session.id,
        exercise: exerciseName,
        repsCount: row.actual_reps ?? 0,
        loadValue: row.actual_weight ?? undefined,
        loadUnit: row.actual_weight != null ? options.defaultLoadUnit ?? 'lbs' : undefined,
      };

      payloads.push({ summary, sessionSetId: row.id });
    }
  }

  return payloads;
}

/**
 * Drain pending payloads through the provided logger. Errors are swallowed
 * (already logged by rep-logger) so one failing set never blocks the next.
 */
export async function flushCompletedSets(
  payloads: CompletedSetPayload[],
  logger: SetLogger = logSet,
): Promise<string[]> {
  const ids: string[] = [];
  for (const payload of payloads) {
    try {
      const id = await logger(payload.summary);
      ids.push(id);
      if (__DEV__) {
        logWithTs('[session-telemetry-binder] logged set', {
          sessionSetId: payload.sessionSetId,
          telemetrySetId: id,
          exercise: payload.summary.exercise,
        });
      }
    } catch (error) {
      if (__DEV__) {
        errorWithTs(
          '[session-telemetry-binder] failed to log set',
          error,
          payload.summary,
        );
      }
    }
  }
  return ids;
}
