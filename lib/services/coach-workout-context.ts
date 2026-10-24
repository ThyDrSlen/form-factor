import { supabase } from '@/lib/supabase';
import { localDB, type LocalWorkout } from '@/lib/services/database/local-db';
import { createError, logError } from './ErrorHandler';
import type { CoachContext } from './coach-service';

/** Compact workout history clause and conversation persistence for coach turns. */

const MAX_RECENT_WORKOUT_CONTEXT_ITEMS = 5;
const MAX_BEST_PERFORMANCE_ITEMS = 2;
const MAX_WORKOUT_CONTEXT_LENGTH = 420;

function formatWorkoutValue(value?: number): string | null {
  if (typeof value !== 'number' || isNaN(value) || value <= 0) {
    return null;
  }

  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

function formatWorkoutSummaryItem(workout: LocalWorkout): string {
  const dateLabel = workout.date.split('T')[0] || workout.date;
  const exerciseLabel = workout.exercise.trim() || 'Workout';
  const details: string[] = [];

  if (workout.sets > 0 && typeof workout.reps === 'number' && workout.reps > 0) {
    details.push(`${workout.sets}x${workout.reps}`);
  } else if (workout.sets > 0) {
    details.push(`${workout.sets} sets`);
  } else if (typeof workout.reps === 'number' && workout.reps > 0) {
    details.push(`${workout.reps} reps`);
  }

  const weightLabel = formatWorkoutValue(workout.weight);
  if (weightLabel) {
    details.push(`weight ${weightLabel}`);
  }

  const durationLabel = formatWorkoutValue(workout.duration);
  if (durationLabel) {
    details.push(`${durationLabel} min`);
  }

  return details.length > 0
    ? `${dateLabel}: ${exerciseLabel} (${details.join(', ')})`
    : `${dateLabel}: ${exerciseLabel}`;
}

function formatBestPerformanceItem(workout: LocalWorkout): string | null {
  const exerciseLabel = workout.exercise.trim();
  if (!exerciseLabel) {
    return null;
  }

  const weightLabel = formatWorkoutValue(workout.weight);
  const repsLabel = formatWorkoutValue(workout.reps);

  if (weightLabel && repsLabel) {
    return `${exerciseLabel} ${weightLabel} x ${repsLabel}`;
  }

  if (weightLabel) {
    return `${exerciseLabel} ${weightLabel}`;
  }

  if (repsLabel) {
    return `${exerciseLabel} ${repsLabel} reps`;
  }

  return null;
}

function pickBestPerformanceWorkouts(workouts: LocalWorkout[]): LocalWorkout[] {
  const workoutsWithWeight = workouts.filter(
    (workout) => typeof workout.weight === 'number' && !isNaN(workout.weight) && workout.weight > 0
  );
  const workoutsWithReps = workouts.filter(
    (workout) => typeof workout.reps === 'number' && !isNaN(workout.reps) && workout.reps > 0
  );

  const heaviestWorkout = workoutsWithWeight.sort((a, b) => {
    if ((b.weight || 0) !== (a.weight || 0)) {
      return (b.weight || 0) - (a.weight || 0);
    }

    return b.date.localeCompare(a.date);
  })[0];

  const highestRepWorkout = workoutsWithReps
    .filter((workout) => !heaviestWorkout || workout.id !== heaviestWorkout.id)
    .sort((a, b) => {
      if ((b.reps || 0) !== (a.reps || 0)) {
        return (b.reps || 0) - (a.reps || 0);
      }

      return b.date.localeCompare(a.date);
    })[0];

  return [heaviestWorkout, highestRepWorkout]
    .filter((workout): workout is LocalWorkout => Boolean(workout))
    .slice(0, MAX_BEST_PERFORMANCE_ITEMS);
}

function summarizeRecentWorkouts(workouts: LocalWorkout[]): string | undefined {
  const recentWorkouts = workouts.slice(0, MAX_RECENT_WORKOUT_CONTEXT_ITEMS);
  if (recentWorkouts.length === 0) {
    return undefined;
  }

  const summary = `Recent workouts: ${recentWorkouts
    .map(formatWorkoutSummaryItem)
    .join('; ')}`;

  return summary.length > MAX_WORKOUT_CONTEXT_LENGTH
    ? `${summary.slice(0, MAX_WORKOUT_CONTEXT_LENGTH - 1).replace(/\s+$/, '')}…`
    : summary;
}

function summarizeBestPerformances(workouts: LocalWorkout[]): string | undefined {
  const bestSummary = pickBestPerformanceWorkouts(workouts)
    .map(formatBestPerformanceItem)
    .filter((item): item is string => Boolean(item));

  if (bestSummary.length === 0) {
    return undefined;
  }

  return `Best performance: ${bestSummary.join('; ')}`;
}

function combineWorkoutContextSummary(workouts: LocalWorkout[]): string | undefined {
  const parts = [
    summarizeRecentWorkouts(workouts),
    summarizeBestPerformances(workouts),
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return undefined;
  }

  const summary = parts.join('. ');
  return summary.length > MAX_WORKOUT_CONTEXT_LENGTH
    ? `${summary.slice(0, MAX_WORKOUT_CONTEXT_LENGTH - 1).replace(/\s+$/, '')}…`
    : summary;
}

export async function buildCoachContext(context?: CoachContext): Promise<CoachContext | undefined> {
  let workoutSummary: string | undefined;

  try {
    workoutSummary = combineWorkoutContextSummary(await localDB.getAllWorkouts());
  } catch (err) {
    logError(
      createError(
        'storage',
        'COACH_WORKOUT_CONTEXT_FAILED',
        'Unable to load workout history for coach context',
        {
          details: err,
          retryable: false,
          severity: 'warning',
        }
      ),
      {
        feature: 'workouts',
        location: 'sendCoachPrompt.buildCoachContext',
      }
    );
  }

  if (!context && !workoutSummary) {
    return undefined;
  }

  if (!workoutSummary) {
    return context;
  }

  return {
    ...context,
    workoutSummary,
  };
}

export async function persistCoachConversation(
  insertPayload: Record<string, unknown>,
  sessionId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('coach_conversations').insert(insertPayload);

  if (!error) {
    return;
  }

  logError(
    createError(
      'storage',
      'COACH_CONVERSATION_PERSIST_FAILED',
      'Failed to persist coach conversation',
      {
        details: error,
        retryable: true,
        severity: 'warning',
      }
    ),
    {
      feature: 'app',
      location: 'sendCoachPrompt.persistCoachConversation',
      meta: { sessionId, userId },
    }
  );
}
