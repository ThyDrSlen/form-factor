/**
 * workout-coach-recall-flag
 *
 * Master feature flag for the wave-25 workouts-tab × Gemma
 * retrospective chat bundle. When this flag is off, none of the new
 * user-visible wiring in the bundle should render:
 *   - `AskCoachCTA` on workout rows (`app/(tabs)/workouts.tsx`)
 *   - `workout-debrief-chat` modal (shows a "feature disabled" card)
 *   - `use-workout-coach-context` hook no-ops from `askAboutWorkout`
 *
 * The underlying services (`coach-workout-recall`, `use-workout-coach-context`)
 * are pure and safe to import any time; this flag gates whether callers
 * should actually invoke the coach.
 *
 * Parsing:
 * - `EXPO_PUBLIC_WORKOUT_COACH_RECALL=1`     → enabled
 * - `EXPO_PUBLIC_WORKOUT_COACH_RECALL=true`  → enabled
 * - unset / anything else                     → disabled (fail safe)
 *
 * Strict on accept: only the exact strings `"1"` and `"true"` (case
 * sensitive) flip the flag on. Keeps the knob unambiguous for ops.
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_WORKOUT_COACH_RECALL';

export function isWorkoutCoachRecallEnabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return raw === '1' || raw === 'true';
}
