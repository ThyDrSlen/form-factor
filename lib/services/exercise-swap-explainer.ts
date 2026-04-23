/**
 * exercise-swap-explainer
 *
 * Wave-34 Gemma surface. When a lifter swaps one exercise for another mid
 * session (injury, missing equipment, difficulty, pure variation), this
 * service fires a short tactical Gemma prompt to explain the swap in
 * plain language — what muscle groups are preserved, what load profile
 * changes, and what the user should watch for.
 *
 * Contract notes:
 * - Short prompt (<200 tokens) so the call stays inside the tactical
 *   Gemma budget; maxTokens capped at 180 on the response side.
 * - Failure-tolerant: any Gemma error collapses to a generic fallback
 *   string so callers never see a thrown exception.
 * - taskKind='exercise_swap_explanation' slots this into the tactical
 *   bucket of coach-model-dispatch (see TACTICAL_TASKS).
 */

import { sendCoachPrompt, type CoachMessage } from './coach-service';
import { shapeFinalResponse } from './coach-output-shaper';
import { recordCoachUsage } from './coach-cost-tracker';
import { warnWithTs } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExerciseSwapReason =
  | 'equipment'
  | 'injury'
  | 'variation'
  | 'difficulty';

export interface ExerciseSwapContext {
  fromExerciseId: string;
  toExerciseId: string;
  reason?: ExerciseSwapReason;
  userGoal?: string;
}

export interface ExerciseSwapExplanation {
  explanation: string;
  tradeoffs?: string[];
  provider: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EXERCISE_SWAP_FALLBACK_TEXT =
  'Swap supports similar muscle groups with different load profile.';

export const EXERCISE_SWAP_MAX_TOKENS = 180;

const SYSTEM_PROMPT =
  'You are a strength coach explaining exercise substitutions in plain ' +
  'language. Reply in 2-3 short sentences. Mention (1) what stays the ' +
  'same (muscle groups / movement pattern), (2) what changes (load, ' +
  'range of motion, stability demand). No markdown, no lists, no hype.';

const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN));
}

// ---------------------------------------------------------------------------
// Prompt builder (exported for tests + future prompt iteration)
// ---------------------------------------------------------------------------

export function buildExerciseSwapMessages(
  ctx: ExerciseSwapContext,
): CoachMessage[] {
  const parts: string[] = [
    `Original exercise: ${ctx.fromExerciseId}`,
    `Replacement exercise: ${ctx.toExerciseId}`,
  ];
  if (ctx.reason) parts.push(`Reason for swap: ${ctx.reason}`);
  if (ctx.userGoal) parts.push(`Lifter goal: ${ctx.userGoal}`);
  parts.push('Explain this swap in 2-3 short sentences.');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Explain an exercise swap via a tactical Gemma call. Never throws — any
 * Gemma failure (network, parse, safety) resolves to the fallback string
 * with provider='fallback'.
 */
export async function explainExerciseSwap(
  ctx: ExerciseSwapContext,
): Promise<ExerciseSwapExplanation> {
  const messages = buildExerciseSwapMessages(ctx);
  try {
    const reply = await sendCoachPrompt(messages, undefined, {
      provider: 'gemma',
      taskKind: 'exercise_swap_explanation',
    });

    const rawText = (reply.content ?? '').trim();
    if (!rawText) {
      return {
        explanation: EXERCISE_SWAP_FALLBACK_TEXT,
        provider: 'fallback',
        model: 'fallback',
      };
    }

    const explanation = shapeFinalResponse(rawText);

    // Telemetry — fire-and-forget. char-based estimator because the coach
    // edge response doesn't surface token counts.
    const promptText = messages.map((m) => m.content).join('\n');
    void recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: 'exercise_swap_explanation',
      tokensIn: estimateTokens(promptText),
      tokensOut: estimateTokens(rawText),
    });

    return {
      explanation,
      provider: reply.provider ?? 'gemma',
      model: reply.model ?? 'gemma',
    };
  } catch (err) {
    warnWithTs('[exercise-swap-explainer] explainExerciseSwap failed', err);
    return {
      explanation: EXERCISE_SWAP_FALLBACK_TEXT,
      provider: 'fallback',
      model: 'fallback',
    };
  }
}

export const EXERCISE_SWAP_SYSTEM_PROMPT = SYSTEM_PROMPT;
