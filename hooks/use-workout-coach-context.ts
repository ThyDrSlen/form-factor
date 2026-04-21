/**
 * use-workout-coach-context
 *
 * Wires the coach-workout-recall service to the coach-service under the
 * EXPO_PUBLIC_WORKOUT_COACH_RECALL master flag. Consumers get two
 * things back:
 *
 *   - `loadContext(workoutId)` — builds the structured retrospective
 *     context (no coach call; always safe).
 *   - `askAboutWorkout(workoutId, userMessage)` — sends the recall
 *     prompt plus the user's follow-up question to sendCoachPrompt
 *     and returns the coach's reply.
 *
 * When the master flag is off, `askAboutWorkout` returns `null` and
 * does NOT call the coach service, so the hook can be imported safely
 * from screens that render conditionally based on the flag.
 *
 * The hook purposely does not manage chat history itself — the UI owns
 * the message list and calls `askAboutWorkout` for each turn. Keeping
 * state in the screen keeps the hook trivially testable.
 */
import { useCallback, useMemo } from 'react';
import {
  buildWorkoutRecallContext,
  buildWorkoutRecallPrompt,
  type WorkoutRecallContext,
} from '@/lib/services/coach-workout-recall';
import { isWorkoutCoachRecallEnabled } from '@/lib/services/workout-coach-recall-flag';
import { sendCoachPrompt, type CoachMessage } from '@/lib/services/coach-service';

export interface WorkoutCoachContextApi {
  /** True when the master flag is on. */
  enabled: boolean;
  /** Reloads the recall context for a workout id. Safe regardless of flag. */
  loadContext: (workoutId: string) => Promise<WorkoutRecallContext>;
  /**
   * Sends the recall prompt + user message to the coach. Returns null
   * when the master flag is off (the UI should render a "disabled"
   * fallback instead) or when the workout id is empty.
   */
  askAboutWorkout: (
    workoutId: string,
    userMessage: string,
  ) => Promise<CoachMessage | null>;
}

export function useWorkoutCoachContext(): WorkoutCoachContextApi {
  const enabled = useMemo(() => isWorkoutCoachRecallEnabled(), []);

  const loadContext = useCallback(
    (workoutId: string) => buildWorkoutRecallContext(workoutId),
    [],
  );

  const askAboutWorkout = useCallback(
    async (workoutId: string, userMessage: string): Promise<CoachMessage | null> => {
      if (!isWorkoutCoachRecallEnabled()) return null;
      if (!workoutId) return null;

      const ctx = await buildWorkoutRecallContext(workoutId);
      const recallPrompt = buildWorkoutRecallPrompt(ctx);

      const trimmed = typeof userMessage === 'string' ? userMessage.trim() : '';

      const messages: CoachMessage[] = [
        {
          role: 'system',
          content:
            'You are helping the athlete debrief a past workout. Use the ' +
            'recall context they give you. Keep answers concrete and ' +
            'actionable.',
        },
        { role: 'user', content: recallPrompt },
      ];
      if (trimmed.length > 0) {
        messages.push({ role: 'user', content: trimmed });
      }

      return sendCoachPrompt(messages, {
        focus: 'workout-retrospective',
      });
    },
    [],
  );

  return { enabled, loadContext, askAboutWorkout };
}
