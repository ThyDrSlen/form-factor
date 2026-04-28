import { supabase } from '@/lib/supabase';
import { createError } from './ErrorHandler';
import { parseRetryAfterMs, type CoachContext, type CoachMessage } from './coach-service';
import type { CoachProvider } from './coach-provider-types';

interface RawCoachGemmaResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
  model?: string;
}

const DEFAULT_FUNCTION_NAME = 'coach-gemma';

function functionName(): string {
  return (process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION || DEFAULT_FUNCTION_NAME).trim();
}

/**
 * Extract a `Retry-After` delay (ms) from a Supabase Functions failure tuple.
 * Checks the raw `Response` first (present when the SDK surfaces a
 * `FunctionsHttpError`) and falls back to `error.context.headers` when the
 * Response is only reachable through the error wrapper.
 */
function readRetryAfterMs(
  response: Response | undefined,
  error: unknown,
): number | undefined {
  const fromResponse = response?.headers?.get?.('Retry-After');
  if (fromResponse) {
    const parsed = parseRetryAfterMs(fromResponse);
    if (parsed !== undefined) return parsed;
  }
  const ctx = (error as { context?: unknown } | null | undefined)?.context;
  if (ctx && typeof ctx === 'object' && 'headers' in ctx) {
    const headers = (ctx as { headers?: { get?: (k: string) => string | null } }).headers;
    const raw = headers?.get?.('Retry-After') ?? null;
    const parsed = parseRetryAfterMs(raw);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/**
 * Send a coach prompt to the Gemma cloud provider (Supabase edge function
 * coach-gemma) which proxies to Google's Gemini `generateContent` API for the
 * Gemma 3 family.
 *
 * The wire format on the edge function is identical to the OpenAI-backed
 * coach function: `{ messages, context }`. The provider differs on the
 * server; the client returns the same `CoachMessage` shape.
 */
export async function sendCoachGemmaPrompt(
  messages: CoachMessage[],
  context?: CoachContext,
  opts?: { model?: string },
): Promise<CoachMessage> {
  try {
    const body: Record<string, unknown> = { messages, context };
    if (opts?.model) body.model = opts.model;

    const { data, error, response } = await supabase.functions.invoke<RawCoachGemmaResponse>(
      functionName(),
      { body },
    );

    if (error) {
      const errorMessage = error.message || '';
      const isConfigError =
        errorMessage.includes('not configured') ||
        errorMessage.includes('GEMINI_API_KEY') ||
        errorMessage.includes('missing');
      const hasStatus =
        typeof error === 'object' && error !== null && 'status' in error;
      const status = hasStatus ? (error as { status: unknown }).status : undefined;
      const isNotFound = status === 404 || errorMessage.includes('404');
      const isRateLimited =
        status === 429 ||
        /\b429\b/.test(errorMessage) ||
        /rate.?limit/i.test(errorMessage) ||
        /too many requests/i.test(errorMessage);

      if (isNotFound) {
        throw createError(
          'validation',
          'COACH_GEMMA_NOT_DEPLOYED',
          'Gemma coach service is not available. Please contact support.',
          { details: error, retryable: false },
        );
      }

      if (isConfigError) {
        throw createError(
          'validation',
          'COACH_GEMMA_NOT_CONFIGURED',
          'Gemma coach is not configured. Please contact support.',
          { details: error, retryable: false },
        );
      }

      if (isRateLimited) {
        const retryAfterMs = readRetryAfterMs(response, error);
        throw createError(
          'network',
          'COACH_GEMMA_RATE_LIMITED',
          'Gemma coach is rate-limited — try again in a moment.',
          {
            details: retryAfterMs !== undefined ? { error, retryAfterMs } : error,
            retryable: true,
          },
        );
      }

      throw createError(
        'network',
        'COACH_GEMMA_INVOKE_FAILED',
        error.message || 'Gemma coach request failed',
        { details: error, retryable: true },
      );
    }

    if (data?.error) {
      const isConfigError =
        data.error.includes('not configured') ||
        data.error.includes('GEMINI_API_KEY');
      throw createError(
        isConfigError ? 'validation' : 'network',
        isConfigError ? 'COACH_GEMMA_NOT_CONFIGURED' : 'COACH_GEMMA_ERROR',
        data.error,
        { retryable: !isConfigError },
      );
    }

    const responseText =
      data?.message?.trim() || data?.content?.trim() || data?.reply?.trim();

    if (!responseText) {
      throw createError(
        'validation',
        'COACH_GEMMA_EMPTY_RESPONSE',
        'Gemma coach did not return a reply',
      );
    }

    // Annotate the reply with provider + model so the UI + telemetry can
    // distinguish Gemma responses from OpenAI without re-inferring from the
    // model string. `model` is an optional passthrough — the coach-gemma
    // edge function returns it at `{ message, model }` (see
    // supabase/functions/coach-gemma/index.ts).
    //
    // WHY non-enumerable: `provider` / `model` are supplementary annotations.
    // Keeping them non-enumerable preserves backward-compatible equality
    // semantics for consumers (and tests) that shallow/deep-compare replies,
    // while still letting TypeScript + the UI read the fields directly. This
    // mirrors the pattern in `coach-service.sendCoachPromptInner`.
    const reply: CoachMessage = {
      role: 'assistant',
      content: responseText,
    };
    Object.defineProperty(reply, 'provider', {
      value: 'gemma-cloud' satisfies CoachProvider,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    if (typeof data?.model === 'string' && data.model.trim().length > 0) {
      Object.defineProperty(reply, 'model', {
        value: data.model.trim(),
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
    return reply;
  } catch (err) {
    if (err && typeof err === 'object' && 'domain' in err) {
      throw err;
    }

    throw createError(
      'network',
      'COACH_GEMMA_REQUEST_FAILED',
      'Unable to reach the Gemma coach service',
      { details: err, retryable: true },
    );
  }
}
