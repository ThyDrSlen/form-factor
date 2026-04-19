import { supabase } from '@/lib/supabase';
import { warnWithTs } from '@/lib/logger';
import { createError, logError } from './ErrorHandler';
import type { CoachContext, CoachMessage } from './coach-service';
import type { CoachProvider } from './coach-provider-types';
import {
  recordCoachUsage,
  type CoachTaskKind as TrackerTaskKind,
} from './coach-cost-tracker';

/** Fallback model identifier emitted when the coach-gemma edge function
 * does not return a `model` field. Per the fold of Gemma-4 we always emit
 * a non-empty `model` annotation on the reply so downstream telemetry and
 * provider badges always have *something* to display. */
export const UNKNOWN_GEMMA_MODEL = 'gemma-unknown';
let hasWarnedAboutMissingGemmaModel = false;

/** Test-only hook for resetting the once-per-process warn flag. */
export function __resetMissingModelWarnForTests(): void {
  hasWarnedAboutMissingGemmaModel = false;
}

interface RawCoachGemmaResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
  model?: string;
}

/**
 * STUB: char/4 token estimator used when the coach-gemma edge function
 * doesn't return usage counts. Replace when real `usage` plumbing lands.
 */
function estimateGemmaTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function mapGemmaTaskKind(input?: string): TrackerTaskKind {
  switch (input) {
    case 'debrief':
    case 'multi_turn_debrief':
    case 'post_session_debrief':
      return 'debrief';
    case 'drill_explainer':
    case 'fault_explainer':
      return 'drill_explainer';
    case 'session_generator':
      return 'session_generator';
    case 'program_design':
      return 'progression_planner';
    case undefined:
    case '':
      return 'chat';
    default:
      return 'chat';
  }
}

const DEFAULT_FUNCTION_NAME = 'coach-gemma';

function functionName(): string {
  return (process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION || DEFAULT_FUNCTION_NAME).trim();
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
  opts?: { model?: string; taskKind?: string },
): Promise<CoachMessage> {
  try {
    const body: Record<string, unknown> = { messages, context };
    if (opts?.model) body.model = opts.model;

    const { data, error } = await supabase.functions.invoke<RawCoachGemmaResponse>(
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
      const isNotFound =
        (hasStatus && (error as { status: unknown }).status === 404) ||
        errorMessage.includes('404');

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
    // Always emit the `model` annotation (fold of Gemma-4). When the edge
    // function returns a model, we use that; when it doesn't we tag the
    // reply with UNKNOWN_GEMMA_MODEL so callers never have to null-check
    // — that simplifies downstream telemetry / UI badges. The first time
    // we fall back, emit a once-per-process warn-level structured log
    // so the server-side gap is visible without spamming on every reply.
    const rawModel =
      typeof data?.model === 'string' && data.model.trim().length > 0
        ? data.model.trim()
        : undefined;
    const modelValue = rawModel ?? UNKNOWN_GEMMA_MODEL;
    Object.defineProperty(reply, 'model', {
      value: modelValue,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    if (!rawModel && !hasWarnedAboutMissingGemmaModel) {
      hasWarnedAboutMissingGemmaModel = true;
      try {
        logError(
          createError(
            'coach',
            'COACH_GEMMA_MODEL_MISSING',
            'coach-gemma edge function did not return a model field; tagged reply as gemma-unknown',
            {
              retryable: false,
              severity: 'warning',
              details: { responseKeys: data ? Object.keys(data) : [] },
            },
          ),
          {
            feature: 'coach',
            location: 'coach-gemma-service.sendCoachGemmaPrompt',
          },
        );
      } catch {
        // logError never throws in prod; swallow defensively so a test
        // env that misconfigures expo-constants can't cascade into a
        // coach failure.
      }
    }

    // Cost-tracker wiring (#537). Fire-and-forget; never block the reply.
    const promptText = messages.map((m) => m.content ?? '').join('\n');
    void recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: mapGemmaTaskKind(opts?.taskKind),
      tokensIn: estimateGemmaTokens(promptText),
      tokensOut: estimateGemmaTokens(responseText),
    }).catch((err) => {
      warnWithTs('[coach-gemma-service] recordCoachUsage failed', err);
    });

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
