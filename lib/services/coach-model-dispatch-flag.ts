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
 *
 * Observability: the first call logs the resolved state exactly once.
 * When the env var is set to a non-empty non-canonical value (typos like
 * `On`, `1`, `true`) we warn so ops catches config drift; when it's set
 * to the canonical `on` we info-log confirmation so it's obvious dispatch
 * is live. Calls after the first are pure — the log-once guard keeps the
 * hot path free of I/O.
 */

import { warnWithTs } from '@/lib/logger';

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_DISPATCH';

let loggedOnce = false;

export function isDispatchEnabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  const enabled = typeof raw === 'string' && raw === 'on';
  if (!loggedOnce) {
    loggedOnce = true;
    if (enabled) {
      // eslint-disable-next-line no-console
      console.info(`[coach-dispatch-flag] ${FLAG_ENV_VAR}=on — dispatch ENABLED`);
    } else if (typeof raw === 'string' && raw.trim().length > 0) {
      warnWithTs(
        `[coach-dispatch-flag] ${FLAG_ENV_VAR}=${JSON.stringify(raw)} ` +
          `— expected literal "on" (lowercase). Dispatch remains OFF.`,
      );
    }
  }
  return enabled;
}

/**
 * Reset the one-shot log guard. Test-only: lets suites assert the
 * warn/info path fires without leaking flag state across tests.
 */
export function __resetDispatchFlagLogForTests(): void {
  loggedOnce = false;
}
