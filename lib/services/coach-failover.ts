// Cross-provider automatic failover for the coach (#465 Item 2).
//
// When the primary provider (gemma by default) returns 429 or 5xx, we
// transparently retry against the secondary (openai by default) so the user
// sees a coach reply instead of an error toast. Genuine 4xx errors (other
// than 429) are caller mistakes and surface immediately.
//
// We invoke the existing supabase Edge Function endpoints rather than
// duplicating the OpenAI/Gemini transport code; the only routing knob is
// the function name (?coach vs ?coach-gemma).
//
// Note on architectural equivalence: `coach-gemma-service.sendCoachGemmaPrompt`
// (shipped in #457) ultimately calls `supabase.functions.invoke('coach-gemma', ...)`
// with the same `{ messages, context, model? }` body, so routing the gemma
// branch through this direct invoke is behavior-equivalent. The failover
// tests assert on the function-name-based `invokeImpl` contract, so we
// preserve that surface here; callers that need model-parameter
// pass-through can use `sendCoachGemmaPrompt` directly via the non-failover
// code path.

import { supabase } from '@/lib/supabase';
import { createError } from './ErrorHandler';
import { recordCoachFailoverUsed } from './coach-telemetry';
import type { CoachContext, CoachMessage } from './coach-service';

export type CoachProvider = 'gemma' | 'openai';

export interface CoachFailoverOptions {
  /** Provider to try first. Defaults to `gemma`. */
  primary?: CoachProvider;
  /** Provider to retry on 429/5xx. Defaults to `openai`. */
  secondary?: CoachProvider;
  /** Inject for tests; defaults to supabase.functions.invoke. */
  invokeImpl?: (
    fn: string,
    body: unknown
  ) => Promise<{ data: RawProviderResponse | null; error: ProviderError | null }>;
}

export interface RawProviderResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
  /**
   * Some upstreams set a status field on the response object so callers can
   * differentiate quota errors from other 5xx without parsing the message.
   */
  status?: number;
}

export interface ProviderError {
  message?: string;
  status?: number;
  /**
   * Optional `Retry-After` value surfaced by the upstream. When present as a
   * number we treat it as seconds; when a string we pass it through so the
   * user-friendly message can render it verbatim (HTTP-date or delta-seconds).
   */
  retryAfter?: number | string;
}

const FUNCTION_FOR: Record<CoachProvider, string> = {
  gemma: (process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION || 'coach-gemma').trim(),
  openai: (process.env.EXPO_PUBLIC_COACH_FUNCTION || 'coach').trim(),
};

/**
 * Send the coach prompt with automatic provider failover.
 * Retries on 429 / 5xx (per #465 Item 2 acceptance criteria); surfaces
 * everything else.
 */
export async function sendCoachPromptWithFailover(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  opts?: CoachFailoverOptions
): Promise<CoachMessage> {
  const primary = opts?.primary ?? 'gemma';
  const secondary = opts?.secondary ?? 'openai';
  const invoke = opts?.invokeImpl ?? defaultInvoke;

  const primaryResult = await callProvider(primary, messages, context, invoke);
  if (primaryResult.ok) return primaryResult.message;

  if (!shouldFailover(primaryResult.status)) {
    // Non-retriable primary error: if it's a 429, map to the friendly
    // rate-limited code so `ErrorHandler.mapToUserMessage` can render the
    // dedicated copy instead of the generic coach domain default.
    if (primaryResult.status === 429) {
      throw toRateLimitedError(primary, primaryResult);
    }
    throw primaryResult.error;
  }

  // Telemetry: record which secondary we are about to try.
  recordCoachFailoverUsed(secondary);

  const secondaryResult = await callProvider(secondary, messages, context, invoke);
  if (secondaryResult.ok) return secondaryResult.message;

  // Both failed - if the most-recent (secondary) failure was a 429, surface
  // the friendly rate-limit message so the user learns they hit a quota
  // rather than a generic "coach unavailable".
  if (secondaryResult.status === 429) {
    throw toRateLimitedError(secondary, secondaryResult);
  }
  // Otherwise surface the secondary's error since it's most recent.
  throw secondaryResult.error;
}

/**
 * Build a user-friendly AppError for an HTTP 429 from a coach provider. The
 * `ErrorHandler.mapToUserMessage` rendering picks this up via the
 * `COACH_RATE_LIMITED` code and returns the short "rate-limited" copy.
 */
function toRateLimitedError(
  provider: CoachProvider,
  failure: ProviderFailure,
): ReturnType<typeof createError> {
  const detail = failure.error.details as
    | { error?: ProviderError; provider?: CoachProvider; status?: number }
    | undefined;
  const retryAfter = detail?.error?.retryAfter;
  const retryHint = formatRetryAfter(retryAfter);
  const message = retryHint
    ? `Coach is rate-limited — try again ${retryHint}.`
    : 'Coach is rate-limited — try again in a few minutes.';
  return createError('coach', 'COACH_RATE_LIMITED', message, {
    details: {
      provider,
      status: 429,
      retryAfter: retryAfter ?? null,
      underlying: detail?.error ?? null,
    },
    retryable: true,
  });
}

function formatRetryAfter(value: number | string | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    if (value < 60) return `in ${Math.ceil(value)}s`;
    const minutes = Math.ceil(value / 60);
    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    // Numeric string (delta-seconds) → same treatment.
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return formatRetryAfter(asNumber);
    }
    // Otherwise it's an HTTP-date; surface it verbatim for the user.
    return `after ${value.trim()}`;
  }
  return null;
}

interface ProviderSuccess {
  ok: true;
  message: CoachMessage;
}
interface ProviderFailure {
  ok: false;
  status: number;
  error: ReturnType<typeof createError>;
}

async function callProvider(
  provider: CoachProvider,
  messages: CoachMessage[],
  context: CoachContext | undefined,
  invoke: NonNullable<CoachFailoverOptions['invokeImpl']>
): Promise<ProviderSuccess | ProviderFailure> {
  const functionName = FUNCTION_FOR[provider];
  let raw: { data: RawProviderResponse | null; error: ProviderError | null };
  try {
    raw = await invoke(functionName, { messages, context });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: createError(
        'network',
        'COACH_FAILOVER_TRANSPORT',
        `Coach transport failed for provider=${provider}`,
        { details: err, retryable: true }
      ),
    };
  }

  if (raw.error) {
    const status = inferStatus(raw.error);
    return {
      ok: false,
      status,
      error: createError(
        'network',
        'COACH_FAILOVER_PROVIDER_ERROR',
        raw.error.message ?? `provider=${provider} failed`,
        { details: { provider, status, error: raw.error }, retryable: shouldFailover(status) }
      ),
    };
  }

  const message =
    raw.data?.message?.trim() ||
    raw.data?.content?.trim() ||
    raw.data?.reply?.trim();

  if (!message) {
    if (raw.data?.error) {
      return {
        ok: false,
        status: raw.data.status ?? 502,
        error: createError(
          'network',
          'COACH_FAILOVER_PROVIDER_ERROR',
          raw.data.error,
          {
            details: { provider, payload: raw.data },
            retryable: shouldFailover(raw.data.status ?? 502),
          }
        ),
      };
    }
    return {
      ok: false,
      status: 502,
      error: createError(
        'validation',
        'COACH_FAILOVER_EMPTY_RESPONSE',
        `provider=${provider} returned an empty reply`,
        { details: { provider, payload: raw.data }, retryable: true }
      ),
    };
  }

  return {
    ok: true,
    message: { role: 'assistant', content: message },
  };
}

/** Default invoke goes through the supabase functions client. */
async function defaultInvoke(
  fn: string,
  body: unknown
): Promise<{ data: RawProviderResponse | null; error: ProviderError | null }> {
  const result = await supabase.functions.invoke<RawProviderResponse>(fn, {
    body: body as Record<string, unknown>,
  });
  if (!result.error) {
    return { data: result.data ?? null, error: null };
  }
  const err = result.error as {
    message?: string;
    status?: number;
    context?: { headers?: Record<string, string> };
  };
  const retryAfter = readRetryAfter(err?.context?.headers);
  return {
    data: result.data ?? null,
    error: {
      message: err.message,
      status: err.status,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    },
  };
}

function readRetryAfter(
  headers: Record<string, string> | undefined,
): number | string | undefined {
  if (!headers) return undefined;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return undefined;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return asNumber;
  return raw;
}

/**
 * Failover criteria per #465: retry on 429 (quota) and 5xx (server). Do NOT
 * retry on other 4xx (caller errors).
 */
export function shouldFailover(status: number | undefined): boolean {
  if (status === undefined) return false;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 0) return true; // transport failure (network down)
  return false;
}

/** Parse a status from supabase function-error shapes that vary by version. */
function inferStatus(err: ProviderError): number {
  if (typeof err.status === 'number') return err.status;
  const msg = err.message ?? '';
  const match = msg.match(/\b(4\d{2}|5\d{2})\b/);
  return match ? Number(match[1]) : 502;
}
