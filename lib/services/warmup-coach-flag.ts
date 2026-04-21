/**
 * warmup-coach-flag
 *
 * Feature flag gate for the pre-session warmup coach flow —
 * `coach-warmup-provider`, `use-pre-session-coach`, and the
 * `session-warmup-coach` modal.
 *
 * Parsing (strict):
 *   - `EXPO_PUBLIC_WARMUP_COACH=1`    → enabled
 *   - `EXPO_PUBLIC_WARMUP_COACH=true` → enabled
 *   - unset / anything else           → disabled (fail-closed)
 *
 * Intentionally strict: only literal `'1'` or `'true'` flip on. The
 * production default must behave identically to pre-PR — no new CTA
 * surfaces, no generator calls, nothing.
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_WARMUP_COACH';

export function isWarmupCoachEnabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return raw === '1' || raw === 'true';
}

export const WARMUP_COACH_FLAG_ENV_VAR = FLAG_ENV_VAR;
