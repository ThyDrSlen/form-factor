/**
 * Voice Command Executor (#469)
 *
 * Routes a classified {@link VoiceIntent} to the appropriate session action.
 * All intents land here: the executor is the single integration point
 * between the voice subsystem and the rest of the app.
 *
 * Design:
 *   - Input: a typed intent (from `voice-intent-classifier`) — NEVER a raw
 *     transcript. This enforces the privacy boundary: transcript text does
 *     not flow past the classifier.
 *   - Output: a typed {@link ExecutionResult} with actionTaken + message.
 *     The feedback hook consumes the message to show the UI confirmation.
 *
 * Cross-PR deferrals:
 *   - `restart` intent: session-runner does not yet expose a
 *     resetCurrentSet() action (pending #442). We surface 'unsupported'
 *     so the UI can show "Not yet available" without crashing.
 */
import type { SessionRunnerState } from '@/lib/stores/session-runner';
import type { WorkoutSessionSet } from '@/lib/types/workout-session';
import type { ClassifiedIntent, IntentParams } from './voice-intent-classifier';
import {
  advanceToNextExercise,
  voicePauseSession,
  voiceResumeSession,
  type VoiceSessionRunnerSlice,
} from '@/lib/stores/session-runner.voice';
import { warnWithTs, logWithTs } from '@/lib/logger';

export type ExecutionActionKind =
  | 'advance_exercise'
  | 'pause_session'
  | 'resume_session'
  | 'skip_rest'
  | 'add_weight'
  | 'log_rpe'
  | 'restart'
  | 'noop';

export interface ExecutionResult {
  success: boolean;
  /** Short human-readable message for UI feedback. */
  message: string;
  /** Which action path was taken, or 'noop' when rejected. */
  actionTaken: ExecutionActionKind;
  /** Optional reason when success=false. */
  reason?: string;
}

/**
 * Minimum runner surface required by the executor. We accept a structural
 * subset so tests can mock every field without touching Zustand.
 */
export interface ExecutableRunner {
  skipRest: () => Promise<void>;
  updateSet: (setId: string, fields: Partial<WorkoutSessionSet>) => Promise<void>;
  /** Voice extension slice (activeSession, exercises). */
  voiceSlice: VoiceSessionRunnerSlice;
  /**
   * Resolve the set currently being targeted by voice (usually the
   * last set of the current exercise). Returning null signals that
   * there is no set to mutate.
   */
  getCurrentSet: () => (WorkoutSessionSet | null);
  /**
   * User preference: 'metric' or 'imperial'. Feeds the add_weight unit
   * resolver when the user omits the unit in their utterance.
   */
  weightPreference: 'metric' | 'imperial';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kgFromParams(params: IntentParams, preferred: 'metric' | 'imperial'): number {
  const unit = params.weightUnit ?? (preferred === 'metric' ? 'kg' : 'lb');
  if (params.weight === undefined) return 0;
  if (unit === 'kg') return params.weight;
  // lb → kg, rounded to nearest 0.1
  return Math.round(params.weight * 0.45359237 * 10) / 10;
}

/**
 * Convert from internal kg to the user's preferred display unit. Used when
 * we store weight in the set — we persist using the same unit the session
 * runner expects (kilograms) so downstream math remains consistent.
 */
function normalizeWeightForStorage(
  params: IntentParams,
  preferred: 'metric' | 'imperial',
): number {
  return kgFromParams(params, preferred);
}

// ---------------------------------------------------------------------------
// executeIntent
// ---------------------------------------------------------------------------

/**
 * Dispatch a classified intent to the correct action. Swallows all errors
 * and reports them through the ExecutionResult — the voice UI should never
 * crash because of an unexpected intent.
 */
export async function executeIntent(
  classified: ClassifiedIntent,
  runner: ExecutableRunner,
): Promise<ExecutionResult> {
  const { intent, params } = classified;

  // Guard: every action except 'none' requires an active session.
  if (intent === 'none') {
    return { success: false, message: "I didn't catch that.", actionTaken: 'noop', reason: 'low_confidence' };
  }

  if (!runner.voiceSlice.activeSession) {
    return {
      success: false,
      message: 'Start a workout first.',
      actionTaken: 'noop',
      reason: 'no_active_session',
    };
  }

  try {
    switch (intent) {
      case 'next': {
        const res = await advanceToNextExercise(runner.voiceSlice);
        return res.success
          ? {
              success: true,
              message: 'Next exercise.',
              actionTaken: 'advance_exercise',
            }
          : {
              success: false,
              message:
                res.reason === 'already_last_exercise'
                  ? "You're already on the last exercise."
                  : 'Could not advance.',
              actionTaken: 'noop',
              reason: res.reason,
            };
      }

      case 'pause': {
        const res = await voicePauseSession(runner.voiceSlice);
        return res.success
          ? { success: true, message: 'Paused.', actionTaken: 'pause_session' }
          : {
              success: false,
              message: 'Could not pause.',
              actionTaken: 'noop',
              reason: res.reason,
            };
      }

      case 'resume': {
        const res = await voiceResumeSession(runner.voiceSlice);
        return res.success
          ? { success: true, message: 'Resumed.', actionTaken: 'resume_session' }
          : {
              success: false,
              message: 'Could not resume.',
              actionTaken: 'noop',
              reason: res.reason,
            };
      }

      case 'skip_rest': {
        await runner.skipRest();
        return { success: true, message: 'Rest skipped.', actionTaken: 'skip_rest' };
      }

      case 'add_weight': {
        const set = runner.getCurrentSet();
        if (!set) {
          return {
            success: false,
            message: 'No active set to update.',
            actionTaken: 'noop',
            reason: 'no_current_set',
          };
        }
        const delta = normalizeWeightForStorage(params, runner.weightPreference);
        if (delta <= 0) {
          return {
            success: false,
            message: "Didn't catch the weight.",
            actionTaken: 'noop',
            reason: 'invalid_weight',
          };
        }
        const prev = set.actual_weight ?? set.planned_weight ?? 0;
        const next = Math.round((prev + delta) * 10) / 10;
        await runner.updateSet(set.id, { actual_weight: next });
        logWithTs(`[VoiceExecutor] add_weight: ${prev} + ${delta} = ${next}`);
        return {
          success: true,
          message: `Added ${delta}kg (total ${next}kg).`,
          actionTaken: 'add_weight',
        };
      }

      case 'log_rpe': {
        const set = runner.getCurrentSet();
        if (!set) {
          return {
            success: false,
            message: 'No active set to rate.',
            actionTaken: 'noop',
            reason: 'no_current_set',
          };
        }
        const rpe = params.rpe;
        if (rpe === undefined) {
          return {
            success: false,
            message: "Didn't catch the RPE.",
            actionTaken: 'noop',
            reason: 'invalid_rpe',
          };
        }
        await runner.updateSet(set.id, { perceived_rpe: rpe });
        return { success: true, message: `Logged RPE ${rpe}.`, actionTaken: 'log_rpe' };
      }

      case 'restart': {
        // resetCurrentSet is not yet exposed by session-runner — pending #442.
        // We surface 'unsupported' so the UI shows "Not available yet".
        return {
          success: false,
          message: 'Restart is not supported yet.',
          actionTaken: 'noop',
          reason: 'unsupported',
        };
      }

      default: {
        // Exhaustiveness check — never should hit at runtime.
        const _exhaustive: never = intent;
        void _exhaustive;
        return {
          success: false,
          message: 'Unknown command.',
          actionTaken: 'noop',
          reason: 'unknown_intent',
        };
      }
    }
  } catch (error) {
    warnWithTs('[VoiceExecutor] executeIntent threw', error);
    return {
      success: false,
      message: 'Something went wrong.',
      actionTaken: 'noop',
      reason: 'exception',
    };
  }
}

/**
 * Build an ExecutableRunner adapter from a live session-runner state.
 * Kept as a named helper so UI code can wire it up with one line:
 *
 *   executeIntent(classified, buildExecutableRunner(useSessionRunner.getState(), 'metric'))
 */
export function buildExecutableRunner(
  runnerState: SessionRunnerState,
  weightPreference: 'metric' | 'imperial',
): ExecutableRunner {
  return {
    skipRest: runnerState.skipRest,
    updateSet: runnerState.updateSet,
    voiceSlice: {
      activeSession: runnerState.activeSession ? { id: runnerState.activeSession.id } : null,
      exercises: runnerState.exercises,
      currentExerciseIndex: undefined,
    },
    getCurrentSet: () => {
      // Pick the last set of the last exercise as the "current" set.
      // This matches the UX: voice commands target whatever set the user
      // is about to do / just finished. Pending #442, a dedicated
      // "active set" pointer will replace this heuristic.
      const lastExercise = runnerState.exercises[runnerState.exercises.length - 1];
      if (!lastExercise) return null;
      const setsForEx = runnerState.sets[lastExercise.id] ?? [];
      return setsForEx[setsForEx.length - 1] ?? null;
    },
    weightPreference,
  };
}
