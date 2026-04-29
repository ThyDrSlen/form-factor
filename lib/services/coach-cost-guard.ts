/**
 * Coach cost guard — weekly-cap wrapper over `coach-cost-tracker`.
 *
 * Callers wrap a Gemma invocation with `assertUnderWeeklyCap(provider)` to
 * check if the provider's weekly token usage is still under the configured
 * budget. If we're over, a typed `COACH_COST_CAP_EXCEEDED` error is thrown —
 * callers catch it and silently fall back to a different provider (usually
 * OpenAI). When the env cap is unset, the function is a no-op.
 *
 * Per #537: only wired into the three Gemma entry points (coach-service
 * Gemma branch, coach-auto-debrief direct call, pre-set-preview direct call).
 * The OpenAI default path stays unguarded to preserve existing behavior.
 */

import { createError } from './ErrorHandler';
import {
  getWeeklyAggregate,
  type CoachProvider as TrackerProvider,
} from './coach-cost-tracker';

const CAP_ENV_VAR = 'EXPO_PUBLIC_COACH_WEEKLY_TOKEN_CAP';

/**
 * Read the configured weekly token cap. Returns `Number.POSITIVE_INFINITY`
 * (i.e. cap disabled) when the env var is unset, empty, or unparseable.
 * Matches the pattern used elsewhere for feature-flag style env vars — we
 * fail *open* (unlimited) so a mis-set env never blocks coach requests.
 */
export function getWeeklyTokenCap(): number {
  const raw = process.env[CAP_ENV_VAR];
  if (typeof raw !== 'string' || raw.trim() === '') return Number.POSITIVE_INFINITY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.POSITIVE_INFINITY;
  return parsed;
}

/**
 * Assert the given provider is still under its weekly token cap. Throws a
 * domain-shaped `COACH_COST_CAP_EXCEEDED` error when the cap is exceeded so
 * callers can `.catch()` and fall back to OpenAI. When no cap is configured
 * (env unset) this is a cheap no-op — we still read the aggregate for a
 * single-roundtrip consistency check, then return immediately.
 */
export async function assertUnderWeeklyCap(provider: TrackerProvider): Promise<void> {
  const cap = getWeeklyTokenCap();
  if (!Number.isFinite(cap)) return;

  const agg = await getWeeklyAggregate();
  const providerTotals = agg.byProvider[provider];
  if (!providerTotals) return;
  const used = providerTotals.tokensIn + providerTotals.tokensOut;
  if (used < cap) return;

  throw createError(
    'validation',
    'COACH_COST_CAP_EXCEEDED',
    `Weekly token cap exceeded for ${provider} (${used}/${cap})`,
    {
      retryable: false,
      severity: 'warning',
      details: { provider, used, cap },
    },
  );
}
