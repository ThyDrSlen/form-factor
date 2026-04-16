/**
 * On-device coach provider — SCAFFOLD with full pre/post wiring.
 *
 * Mirrors the `sendCoachPrompt` interface from `coach-service.ts` so the
 * dispatcher can swap providers behind `EXPO_PUBLIC_COACH_LOCAL=1` and
 * the cohort gate. Actual model runtime (react-native-executorch + .pte
 * weights) is deferred to PR-D; see `docs/gemma-integration.md` §5.
 *
 * What this file does today:
 *   1. Runs `enrichCoachContext()` to pull recent workouts from SQLite
 *      and produce a <400-token summary.
 *   2. Builds the Gemma-native chat prompt via `renderGemmaChat`.
 *   3. Defines a post-generate hook (`finalizeOutput`) that runs every
 *      candidate through `applySafetyFilter` and emits telemetry.
 *   4. THROWS `COACH_LOCAL_NOT_AVAILABLE` — the dispatcher catches this
 *      sentinel and falls back to cloud.
 *
 * When PR-D lands, the only change required is swapping the throw for:
 *
 *     const raw = await runtime.generate(renderedPrompt);
 *     return finalizeOutput(raw);
 *
 * — safety, context, and telemetry wiring are already ready.
 */

import { createError } from './ErrorHandler';
import type { CoachMessage, CoachContext } from './coach-service';
import { enrichCoachContext } from './coach-context-enricher';
import { applySafetyFilter } from './coach-safety';
import {
  renderGemmaChat,
  type CoachPromptContext,
} from './coach-prompt';
import {
  recordContextTokens,
  recordFallback,
  recordSafetyReject,
} from './coach-telemetry';

export const COACH_LOCAL_NOT_AVAILABLE = 'COACH_LOCAL_NOT_AVAILABLE';

/**
 * Rough char-to-token ratio for telemetry. English text averages ~4
 * chars per token — good enough for a counter, no tokeniser needed.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Apply the post-generation safety filter and return a final assistant
 * message. Exported so tests can exercise the hook directly and so PR-D
 * can call it after `runtime.generate()`.
 */
export function finalizeOutput(raw: string): CoachMessage {
  try {
    const { output } = applySafetyFilter(raw);
    return { role: 'assistant', content: output };
  } catch (err) {
    const details = err && typeof err === 'object' && 'details' in err
      ? (err as { details?: { metric?: string; reason?: string } }).details
      : undefined;
    if (details?.metric) {
      recordSafetyReject(details.metric, details.reason);
    }
    throw err;
  }
}

/**
 * Build the rendered Gemma prompt for the given turn set. Exported so
 * PR-D can reuse it and so tests can assert wiring.
 */
export async function buildLocalPrompt(
  messages: CoachMessage[],
  context?: CoachContext
): Promise<string> {
  // Step 1: enrich context with recent workouts, but only when focus is
  // fitness_coach (nutrition/mobility/etc don't need lifting history).
  let historySummary = '';
  const focus = context?.focus ?? 'fitness_coach';
  if (focus === 'fitness_coach') {
    historySummary = await enrichCoachContext();
  }
  if (historySummary) {
    recordContextTokens(estimateTokens(historySummary));
  }

  // Step 2: render Gemma chat template.
  const promptCtx: CoachPromptContext = {
    profile: context?.profile,
    focus: context?.focus,
    historySummary: historySummary || undefined,
  };
  return renderGemmaChat(messages, promptCtx);
}

export async function sendCoachPromptLocal(
  messages: CoachMessage[],
  context?: CoachContext
): Promise<CoachMessage> {
  // Build the prompt so wiring is tested even though the runtime isn't
  // landed yet. PR-D will hand the result to runtime.generate().
  const renderedPrompt = await buildLocalPrompt(messages, context);
  void renderedPrompt;

  // Reference finalizeOutput so the bundler keeps it alive for PR-D.
  void finalizeOutput;

  recordFallback('runtime_unavailable');

  throw createError(
    'ml',
    COACH_LOCAL_NOT_AVAILABLE,
    'On-device coach runtime is not available yet.',
    {
      retryable: false,
      severity: 'info',
      details: {
        note: 'Falls back to cloud; runtime lands in PR-D (react-native-executorch).',
      },
    }
  );
}
