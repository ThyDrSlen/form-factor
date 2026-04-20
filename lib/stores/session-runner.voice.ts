/**
 * Session Runner — voice extension module (#469)
 *
 * Mirrors the extension-file pattern introduced by #434's
 * `session-runner.pause.ts`. We deliberately do NOT edit
 * `session-runner.ts` so voice input is isolated and can be merged
 * independently of the main session-runner refactor.
 *
 * What this module does:
 *   - advanceToNextExercise() — emits an 'exercise_advanced' session event
 *     (string-literal; formal enum extension deferred until #442 lands, see
 *     docs/voice-control.md "Cross-PR TODO" block)
 *   - voicePauseSession() / voiceResumeSession() — emit
 *     'session_paused'/'session_resumed' events and toggle a local
 *     `voiceSessionPaused` flag on the voice-control store (NOT
 *     isWorkoutInProgress — #434 owns that flag).
 *
 * Why an extension file:
 *   - No edits to `lib/stores/session-runner.ts` (#434 owns structural
 *     changes).
 *   - No edits to `lib/types/workout-session.ts` (#442 owns the
 *     SessionEventType enum).
 *   - Callers (voice-command-executor) depend on this file only.
 */
import * as Crypto from 'expo-crypto';
import type { WorkoutSessionExercise, Exercise } from '@/lib/types/workout-session';
import { genericLocalUpsert } from '@/lib/services/database/generic-sync';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { logWithTs, warnWithTs } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal surface of the session-runner state that the voice module needs.
 * Typed as a subset so tests can pass a stub without pulling in the full
 * Zustand store.
 */
export interface VoiceSessionRunnerSlice {
  activeSession: { id: string } | null;
  exercises: (WorkoutSessionExercise & { exercise?: Exercise })[];
  /** Ordered index of the exercise currently being worked on. */
  currentExerciseIndex?: number;
}

export interface VoiceActionResult {
  success: boolean;
  /** Short, user-facing reason the action succeeded or was a no-op. */
  reason?: string;
  /** Event type emitted, or undefined if no event was emitted. */
  eventType?: string;
  /** ID of the exercise moved to, when applicable. */
  nextExerciseId?: string;
}

// Voice-specific string-literal event types — added to payload.type in the
// workout_session_events table until #442 lands an enum extension.
export const VOICE_EVENT_TYPES = {
  exerciseAdvanced: 'voice.exercise_advanced',
  sessionPaused: 'voice.session_paused',
  sessionResumed: 'voice.session_resumed',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Persist a voice event to workout_session_events.
 *
 * We bypass the typed `emitEvent` helper in session-runner.ts because that
 * helper constrains `type` to the existing SessionEventType enum. Writing
 * the row directly lets voice emit string-literal types until the enum is
 * extended in #442.
 */
async function emitVoiceEvent(
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const event: Record<string, unknown> = {
    id: Crypto.randomUUID(),
    session_id: sessionId,
    created_at: nowIso(),
    type: eventType,
    session_exercise_id: (payload.sessionExerciseId as string | null | undefined) ?? null,
    session_set_id: null,
    payload: JSON.stringify(payload),
    synced: 0,
  };
  await genericLocalUpsert('workout_session_events', 'id', event, 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Advance the session to the next exercise in the ordered `exercises` list.
 *
 * Uses `currentExerciseIndex` if present on the runner slice; otherwise
 * defaults to index 0 (first exercise). Because the main session-runner does
 * not yet track `currentExerciseIndex` (pending #442), we return a success
 * result after emitting an 'exercise_advanced' event — the scan UI is
 * expected to consume the event to update its own current-exercise state.
 *
 * @returns a {@link VoiceActionResult}. `success: false` only when the
 *   session is missing or the user is already on the last exercise.
 */
export async function advanceToNextExercise(
  runner: VoiceSessionRunnerSlice,
): Promise<VoiceActionResult> {
  const { activeSession, exercises } = runner;
  if (!activeSession) {
    return { success: false, reason: 'no_active_session' };
  }
  if (!exercises || exercises.length === 0) {
    return { success: false, reason: 'no_exercises' };
  }

  const currentIndex = runner.currentExerciseIndex ?? 0;
  const nextIndex = currentIndex + 1;
  if (nextIndex >= exercises.length) {
    return { success: false, reason: 'already_last_exercise' };
  }

  const nextExercise = exercises[nextIndex];
  try {
    await emitVoiceEvent(activeSession.id, VOICE_EVENT_TYPES.exerciseAdvanced, {
      sessionExerciseId: nextExercise.id,
      fromIndex: currentIndex,
      toIndex: nextIndex,
    });
    logWithTs(
      `[SessionRunner.voice] advanced from exercise index ${currentIndex} to ${nextIndex}`,
    );
    return {
      success: true,
      eventType: VOICE_EVENT_TYPES.exerciseAdvanced,
      nextExerciseId: nextExercise.id,
    };
  } catch (error) {
    warnWithTs('[SessionRunner.voice] emitVoiceEvent failed (advance)', error);
    return { success: false, reason: 'event_emit_failed' };
  }
}

/**
 * Emit a 'session_paused' voice event. Does NOT flip the
 * `isWorkoutInProgress` flag — that's #434's territory. The voice-control
 * store holds its own `voiceSessionPaused` flag instead so the two pause
 * mechanisms can coexist without conflict.
 */
export async function voicePauseSession(
  runner: VoiceSessionRunnerSlice,
): Promise<VoiceActionResult> {
  const { activeSession } = runner;
  if (!activeSession) {
    return { success: false, reason: 'no_active_session' };
  }
  try {
    await emitVoiceEvent(activeSession.id, VOICE_EVENT_TYPES.sessionPaused);
    return { success: true, eventType: VOICE_EVENT_TYPES.sessionPaused };
  } catch (error) {
    warnWithTs('[SessionRunner.voice] emitVoiceEvent failed (pause)', error);
    return { success: false, reason: 'event_emit_failed' };
  }
}

/**
 * Emit a 'session_resumed' voice event. Mirror of {@link voicePauseSession}.
 */
export async function voiceResumeSession(
  runner: VoiceSessionRunnerSlice,
): Promise<VoiceActionResult> {
  const { activeSession } = runner;
  if (!activeSession) {
    return { success: false, reason: 'no_active_session' };
  }
  try {
    await emitVoiceEvent(activeSession.id, VOICE_EVENT_TYPES.sessionResumed);
    return { success: true, eventType: VOICE_EVENT_TYPES.sessionResumed };
  } catch (error) {
    warnWithTs('[SessionRunner.voice] emitVoiceEvent failed (resume)', error);
    return { success: false, reason: 'event_emit_failed' };
  }
}

/**
 * Convenience: reads the current session-runner state as a voice slice so
 * callers that don't already hold a handle can grab one without coupling
 * to the full store signature.
 */
export function getVoiceRunnerSlice(): VoiceSessionRunnerSlice {
  const state = useSessionRunner.getState();
  return {
    activeSession: state.activeSession ? { id: state.activeSession.id } : null,
    exercises: state.exercises,
    // currentExerciseIndex is not yet tracked on the store; pending #442.
    currentExerciseIndex: undefined,
  };
}
