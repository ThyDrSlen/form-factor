/**
 * coach-vision-flag
 *
 * Feature flag gate for the Gemma 4 multimodal form-check pipeline
 * (`coach-vision.ts`). The pipeline itself is pure and safe to import any
 * time; this flag decides whether callers should actually send vision
 * requests or short-circuit with a `{ skipped: true, reason: 'flag-off' }`
 * response.
 *
 * Parsing:
 * - `EXPO_PUBLIC_COACH_VISION=on`  → vision enabled
 * - `EXPO_PUBLIC_COACH_VISION=off` → vision disabled
 * - unset / anything else          → vision disabled (fail safe)
 *
 * Strict string match: only the literal `'on'` flips the flag. "true", "1",
 * "yes", "ON" are intentionally rejected so the knob stays unambiguous.
 * Mirrors the pattern established by `coach-model-dispatch-flag.ts` (#503).
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_VISION';

export function isCoachVisionEnabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return raw === 'on';
}
