/**
 * voice-pipeline-flag (#wave24-voice)
 *
 * Master kill-switch for the voice-control pipeline surface shipped in
 * wave 24 PR-β. The flag governs:
 *   - VoiceControlContext lifecycle (starts voiceSessionManager)
 *   - VoiceCommandFeedback + VoiceControlBanner mount in coach tab
 *   - Gemma NLU fallback for low-confidence intents
 *
 * When the flag is OFF (the default), the voice subsystem behaves exactly
 * as it did before PR-β: the manager never auto-starts, the feedback
 * overlay is not rendered, and low-confidence intents continue to drop
 * silently through the classifier.
 *
 * Parsing:
 * - `EXPO_PUBLIC_VOICE_CONTROL_PIPELINE=on`  → pipeline enabled
 * - `EXPO_PUBLIC_VOICE_CONTROL_PIPELINE=off` → pipeline disabled
 * - unset / anything else                     → pipeline disabled (fail safe)
 *
 * Intentionally strict string matching mirrors `coach-model-dispatch-flag`:
 * we only flip on for the literal `'on'` value, not "true" / "1" / "yes".
 * Keeps the knob unambiguous and greppable.
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_VOICE_CONTROL_PIPELINE';

/**
 * Returns true when the voice-control pipeline surface should be active.
 * Callers must treat this as the single source of truth — no ad-hoc
 * `process.env[...]` reads elsewhere in the voice code.
 */
export function isVoiceControlPipelineEnabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return raw === 'on';
}

/** Exported for tests and log lines — never hard-code the env var elsewhere. */
export const VOICE_CONTROL_PIPELINE_ENV_VAR = FLAG_ENV_VAR;
