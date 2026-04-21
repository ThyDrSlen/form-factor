/**
 * gemma-session-gen-flag
 *
 * Feature flag gate for the Gemma-powered session / warmup / cooldown /
 * rest-advisor generators shipped under issue #468.
 *
 * All four generator services (`session-generator`, `warmup-generator`,
 * `cooldown-generator`, `rest-advisor`) are safe to import and call at any
 * time — they all accept a custom `dispatch` runtime override and they all
 * have offline fallbacks. This flag lets callers short-circuit the dispatch
 * entirely without mocking, so production can ship the generators dark and
 * staff / beta users can opt in via env.
 *
 * Parsing:
 * - `EXPO_PUBLIC_GEMMA_SESSION_GEN=on`  → generators active
 * - `EXPO_PUBLIC_GEMMA_SESSION_GEN=1`   → generators active
 * - `EXPO_PUBLIC_GEMMA_SESSION_GEN=true`→ generators active
 * - unset / `off` / anything else       → generators inactive (fail safe)
 *
 * The parser is intentionally permissive on the enabled side (`on` | `1` |
 * `true`, case-insensitive) because this is a user-facing rollout knob that
 * docs commonly write three different ways. It is strictly disabled by
 * default so a missing env var never lights up LLM traffic in production.
 */

const FLAG_ENV_VAR = 'EXPO_PUBLIC_GEMMA_SESSION_GEN';

const ENABLED_VALUES = new Set(['on', '1', 'true']);

/**
 * Read the flag from `process.env` with a permissive parser. Returns `false`
 * unless the env var matches one of the explicit enable tokens.
 */
export function isGemmaSessionGenEnabled(): boolean {
  const raw = process.env[FLAG_ENV_VAR];
  if (typeof raw !== 'string') return false;
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Exported name of the env var so consumers can surface it in settings UIs,
 * error messages, or telemetry without duplicating the string literal.
 */
export const GEMMA_SESSION_GEN_ENV_VAR = FLAG_ENV_VAR;

/**
 * Error thrown by generator services when the flag is disabled. Callers
 * (hooks, UI) can match on `FLAG_DISABLED_ERROR_CODE` or on `instanceof
 * GemmaSessionGenDisabledError` to route to offline fallbacks.
 */
export const FLAG_DISABLED_ERROR_CODE = 'GEMMA_SESSION_GEN_DISABLED';

export class GemmaSessionGenDisabledError extends Error {
  public readonly code = FLAG_DISABLED_ERROR_CODE;
  public readonly envVar = FLAG_ENV_VAR;

  constructor(surface: string) {
    super(
      `Gemma session generator is disabled (${FLAG_ENV_VAR} not set). ` +
        `Caller: ${surface}. Set ${FLAG_ENV_VAR}=on to enable.`,
    );
    this.name = 'GemmaSessionGenDisabledError';
  }
}

/**
 * Assert the flag is on before dispatching. Throws a typed error so hooks
 * can branch to their offline fallback deterministically.
 */
export function assertGemmaSessionGenEnabled(surface: string): void {
  if (!isGemmaSessionGenEnabled()) {
    throw new GemmaSessionGenDisabledError(surface);
  }
}
