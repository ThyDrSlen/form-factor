/**
 * coach-vision
 *
 * Multimodal form-check pipeline for Gemma 4. Encodes a single JPEG frame
 * captured from the ARKit scan session into base64 and wraps it in the
 * Anthropic/Gemma-compatible multimodal message shape. Dispatch (with the
 * flag/provider routing) lives in this same module but is layered on top
 * of the pure encoder + composer in a separate commit so each piece can
 * be reviewed in isolation.
 *
 * Design goals:
 * - Pure module. No React, no navigation, no UI. The
 *   `SnapForFeedbackButton` component is the only mount point.
 * - Feature-flag gated at the dispatch layer (not here) via
 *   `EXPO_PUBLIC_COACH_VISION`.
 *
 * Not in scope for this PR:
 * - Mounting the SnapForFeedbackButton into `app/(tabs)/scan-arkit.tsx`
 *   (follow-up PR to avoid merge conflicts with another in-flight PR
 *   touching that screen).
 * - Wiring the dispatch return value into coach chat history.
 * - Retry/backoff — a single shot is enough for the launch cut.
 */

import { File as ExpoFile } from 'expo-file-system';
import {
  decideCoachModel,
  type CoachUserTier,
  type DispatchDecision,
} from './coach-model-dispatch';
import { isCoachVisionEnabled } from './coach-vision-flag';
import type { CoachCloudProvider } from './coach-cloud-provider';

// ---------------------------------------------------------------------------
// Multimodal message shape
// ---------------------------------------------------------------------------

export interface VisionTextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface VisionImageSource {
  readonly type: 'base64';
  readonly media_type: 'image/jpeg';
  readonly data: string;
}

export interface VisionImagePart {
  readonly type: 'image';
  readonly source: VisionImageSource;
}

export type VisionContentPart = VisionTextPart | VisionImagePart;

export interface VisionMessage {
  readonly role: 'user';
  readonly content: VisionContentPart[];
}

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

export interface ComposeVisionPromptArgs {
  /** Canonical exercise key, e.g. 'squat', 'deadlift', 'pullup'. */
  readonly exercise: string;
  /**
   * Session phase when the frame was captured. Used verbatim in the text
   * part so the model knows whether to critique setup, bottom, or lockout.
   */
  readonly phase: string;
  /** Raw base64-encoded JPEG payload from `encodeJpegToBase64`. */
  readonly base64Image: string;
  /**
   * Optional free-form note from the user ("feels off at the bottom").
   * Capped at 240 chars to match the rest of the coach prompt hygiene and
   * keep token usage predictable.
   */
  readonly userNote?: string;
}

const USER_NOTE_MAX_LENGTH = 240;
const EXERCISE_FALLBACK = 'lift';
const PHASE_FALLBACK = 'setup';

function cleanExercise(raw: string): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : EXERCISE_FALLBACK;
}

function cleanPhase(raw: string): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : PHASE_FALLBACK;
}

function cleanNote(note: string | undefined): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim().slice(0, USER_NOTE_MAX_LENGTH);
  return trimmed || null;
}

/**
 * Compose the multimodal message the coach edge function expects. The
 * shape is intentionally the Anthropic/Gemma vision format:
 *
 *   `{ role, content: [{type:'text'}, {type:'image', source:{...}}] }`
 *
 * The text part spells out the exercise and phase so the model doesn't
 * have to infer them from the frame alone. The image part carries the
 * raw base64 JPEG; callers must have already verified the data is a
 * JPEG (via `encodeJpegToBase64` or otherwise).
 */
export function composeVisionPrompt(
  args: ComposeVisionPromptArgs,
): VisionMessage {
  const exercise = cleanExercise(args.exercise);
  const phase = cleanPhase(args.phase);
  const note = cleanNote(args.userNote);

  const textLines = [
    `Critique my ${exercise} form during the ${phase} phase.`,
    'Point out the top-1 or top-2 faults I can fix right now. Be concise.',
  ];
  if (note) {
    textLines.push(`User note: ${note}`);
  }

  return {
    role: 'user',
    content: [
      { type: 'text', text: textLines.join(' ') },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: args.base64Image,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// JPEG encoder
// ---------------------------------------------------------------------------

/**
 * Read a file URI (typically produced by `CameraView.takePictureAsync`)
 * and return its base64 representation. Throws if the file does not
 * exist; lets `expo-file-system` surface any IO errors so the caller
 * can classify them.
 *
 * Uses the modern `new File(uri).base64()` API (matches the pattern in
 * `hooks/use-premium-cue-audio.ts`). The legacy `readAsStringAsync` is
 * deprecated in expo-file-system 19.
 */
export async function encodeJpegToBase64(uri: string): Promise<string> {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error('encodeJpegToBase64: uri is required');
  }
  const file = new ExpoFile(uri);
  if (!file.exists) {
    throw new Error(`encodeJpegToBase64: file not found at ${uri}`);
  }
  return await file.base64();
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type VisionSkipReason = 'flag-off';

export interface VisionDispatchSkipped {
  readonly skipped: true;
  readonly reason: VisionSkipReason;
}

export interface VisionDispatchSent {
  readonly skipped: false;
  readonly decision: DispatchDecision;
  readonly provider: CoachCloudProvider;
  readonly message: VisionMessage;
}

export type VisionDispatchResult = VisionDispatchSkipped | VisionDispatchSent;

export interface DispatchVisionOptions {
  /**
   * Overrides the flag check. When omitted the env flag
   * `EXPO_PUBLIC_COACH_VISION` is consulted via `isCoachVisionEnabled()`.
   * Exposed primarily for tests and for call sites that already know the
   * flag state (e.g. settings screen surface).
   */
  readonly flag?: boolean;
  /**
   * Which cloud provider the caller expects to serve this turn. The
   * dispatcher itself doesn't care — it only picks a model id — but the
   * returned result carries the provider so callers can hand the message
   * to the right edge function.
   */
  readonly provider?: CoachCloudProvider;
  /** User tier, defaults to `free`. */
  readonly userTier?: CoachUserTier;
  /**
   * Pass-through to the dispatcher. When true, degrades to gpt-5.4-mini
   * (text-only) with `reason: 'vision_fallback_cloud'`. Callers set this
   * after observing Gemma failures.
   */
  readonly fallbackToCloud?: boolean;
}

/**
 * Flag-gated vision dispatch shim. Does NOT call the coach-service or
 * any network transport yet — that wiring is the next PR. This function
 * is the single place where the flag check, dispatch decision, and
 * provider selection live so unit tests can pin the routing logic.
 *
 * Return shape:
 * - `{ skipped: true, reason: 'flag-off' }` when the flag is off or when
 *   an explicit `flag: false` override was passed.
 * - `{ skipped: false, decision, provider, message }` otherwise. The
 *   caller (coach-service wiring, landing in a follow-up) is responsible
 *   for sending the message.
 */
export function dispatchVisionRequest(
  message: VisionMessage,
  options?: DispatchVisionOptions,
): VisionDispatchResult {
  const flagOn = options?.flag ?? isCoachVisionEnabled();
  if (!flagOn) {
    return { skipped: true, reason: 'flag-off' };
  }

  const decision = decideCoachModel(
    'form_vision_check',
    {},
    options?.userTier ?? 'free',
    { visionFallbackToCloud: options?.fallbackToCloud === true },
  );

  return {
    skipped: false,
    decision,
    provider: options?.provider ?? 'gemma',
    message,
  };
}
