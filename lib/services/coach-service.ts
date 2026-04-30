import { supabase } from '@/lib/supabase';
import { localDB, type LocalWorkout } from '@/lib/services/database/local-db';
import { createError, logError } from './ErrorHandler';

export type CoachRole = 'user' | 'assistant' | 'system';

export interface CoachMessage {
  role: CoachRole;
  content: string;
  id?: string;
}

export interface CoachContext {
  profile?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  };
  focus?: string;
  sessionId?: string;
  workoutSummary?: string;
}

interface RawCoachResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
}

const functionName = (process.env.EXPO_PUBLIC_COACH_FUNCTION || 'coach').trim();
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

async function buildCoachContext(context?: CoachContext): Promise<CoachContext | undefined> {
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

async function persistCoachConversation(
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

export async function sendCoachPrompt(
  messages: CoachMessage[],
  context?: CoachContext
): Promise<CoachMessage> {
  try {
    const requestContext = await buildCoachContext(context);
    const { data, error } = await supabase.functions.invoke<RawCoachResponse>(functionName, {
      body: { messages, context: requestContext },
    });

    if (error) {
      // Check for specific error types based on error message or context
      const errorMessage = error.message || '';
      const isConfigError = errorMessage.includes('not configured') || 
                           errorMessage.includes('OPENAI_API_KEY') ||
                           errorMessage.includes('missing');
      const hasStatus = typeof error === 'object' && error !== null && 'status' in error;
      const isNotFound = (hasStatus && (error as { status: unknown }).status === 404) || errorMessage.includes('404');
      
      if (isNotFound) {
        throw createError(
          'validation',
          'COACH_NOT_DEPLOYED',
          'Coach service is not available. Please contact support.',
          { details: error, retryable: false }
        );
      }
      
      if (isConfigError) {
        throw createError(
          'validation',
          'COACH_NOT_CONFIGURED',
          'Coach is not configured. Please contact support.',
          { details: error, retryable: false }
        );
      }
      
      throw createError(
        'network',
        'COACH_INVOKE_FAILED',
        error.message || 'Coach request failed',
        {
          details: error,
          retryable: true,
        }
      );
    }

    // Check if the response itself contains an error field
    if (data?.error) {
      const isConfigError = data.error.includes('not configured') || 
                           data.error.includes('OPENAI_API_KEY');
      throw createError(
        isConfigError ? 'validation' : 'network',
        isConfigError ? 'COACH_NOT_CONFIGURED' : 'COACH_ERROR',
        data.error,
        { retryable: !isConfigError }
      );
    }

    const responseText =
      data?.message?.trim() ||
      data?.content?.trim() ||
      data?.reply?.trim();

    if (!responseText) {
      throw createError(
        'validation',
        'COACH_EMPTY_RESPONSE',
        'Coach did not return a reply'
      );
    }

    if (context?.profile?.id && context.sessionId) {
      const userTurns = messages.filter(m => m.role === 'user');
      const insertPayload = {
        user_id: context.profile.id,
        session_id: context.sessionId,
        turn_index: Math.max(0, userTurns.length - 1),
        user_message: userTurns[userTurns.length - 1]?.content ?? '',
        assistant_message: responseText,
        input_messages: messages,
        context: { focus: context.focus },
        metadata: { model: 'gpt-5.4-mini', timestamp: new Date().toISOString() },
      };
      void persistCoachConversation(insertPayload, context.sessionId, context.profile.id);
    }

    return {
      role: 'assistant',
      content: responseText,
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'domain' in err) {
      throw err;
    }

    throw createError(
      'network',
      'COACH_REQUEST_FAILED',
      'Unable to reach the coach service',
      { details: err, retryable: true }
    );
  }
}
