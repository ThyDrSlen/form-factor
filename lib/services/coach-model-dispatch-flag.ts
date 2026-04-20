/**
 * coach-model-dispatch-flag
 *
 * Feature flag gate for the cost-aware model dispatcher in
 * `coach-model-dispatch.ts`. The dispatcher itself is pure and safe to
 * call any time; this flag decides whether callers should respect its
 * decision or collapse back to the legacy single-model (gpt-5.4-mini)
 * path.
 *
 * Parsing:
 * - `EXPO_PUBLIC_COACH_DISPATCH=on`  → dispatch enabled
 * - `EXPO_PUBLIC_COACH_DISPATCH=off` → dispatch disabled
 * - unset / anything else            → dispatch disabled (fail safe)
 *
 * Intentionally strict string matching: we only flip on for the literal
 * `'on'` value, not "true" / "1" / "yes". Keeps the knob unambiguous.
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_DISPATCH';

export function isDispatchEnabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return raw === 'on';
}
