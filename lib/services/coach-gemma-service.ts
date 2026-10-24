import { invokeEdgeChat } from '@/lib/ai/providers/edge-chat-provider';
import { GEMMA_CLOUD_EDGE } from '@/lib/ai/providers';
import { warnWithTs } from '@/lib/logger';
import { createError, logError } from './ErrorHandler';
import type { CoachContext, CoachMessage } from './coach-service';
import type { CoachProvider } from './coach-provider-types';
import {
  recordCoachUsage,
  type CoachTaskKind as TrackerTaskKind,
} from './coach-cost-tracker';

/** Fallback model identifier emitted when the coach-gemma edge function
 * does not return a `model` field. */
export const UNKNOWN_GEMMA_MODEL = 'gemma-unknown';
let hasWarnedAboutMissingGemmaModel = false;

/** Test-only hook for resetting the once-per-process warn flag. */
export function __resetMissingModelWarnForTests(): void {
  hasWarnedAboutMissingGemmaModel = false;
}

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
    default:
      return 'chat';
  }
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
    const result = await invokeEdgeChat(GEMMA_CLOUD_EDGE, { messages, context, model: opts?.model });
    const responseText = result.text;

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
    // Always emit a `model` annotation. If the edge function returned one,
    // use it; otherwise tag with UNKNOWN_GEMMA_MODEL and emit a once-per-
    // process warn so the server-side gap is visible without log spam.
    const rawModel = result.model;
    Object.defineProperty(reply, 'model', {
      value: rawModel ?? UNKNOWN_GEMMA_MODEL,
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
              details: { responseKeys: result.raw && typeof result.raw === 'object' ? Object.keys(result.raw) : [] },
            },
          ),
          {
            feature: 'coach',
            location: 'coach-gemma-service.sendCoachGemmaPrompt',
          },
        );
      } catch {
        // swallow
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
