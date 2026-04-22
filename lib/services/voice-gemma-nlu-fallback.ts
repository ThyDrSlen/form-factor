/**
 * voice-gemma-nlu-fallback (#wave24-voice)
 *
 * Low-confidence safety net for the regex-based voice intent classifier.
 * When `classifyIntent` returns 'none' (confidence below
 * CONFIDENCE_THRESHOLD) AND the voice-control pipeline master flag is on,
 * callers may delegate the transcript to a tiny Gemma prompt that picks
 * the best-matching intent from the known candidate list.
 *
 * Contract:
 *   - Input: the raw (post-wake-word) transcript.
 *   - Output: a ClassifiedIntent with `intent` ∈ {one of the candidates}
 *     OR `none` if Gemma fails/rejects. Confidence is pinned to 0.80 on
 *     a successful Gemma match — higher than the regex threshold (0.70)
 *     so downstream code treats it as actionable, but clearly below an
 *     exact regex hit (1.0) for telemetry purposes.
 *
 * Implementation notes:
 *   - The prompt is deliberately minimal (zero-shot, 1 line) to keep
 *     latency + cost low. Gemma 3-4B is plenty for intent picking.
 *   - Params (weight/rpe) are NEVER extracted here — that's the regex
 *     classifier's job. Fallback is phrase-only.
 *   - Errors (network, parse failure) collapse to 'none' so the voice
 *     loop never crashes because the cloud is unreachable.
 */

import type {
  ClassifiedIntent,
  VoiceIntent,
} from './voice-intent-classifier';
import type {
  CoachContext,
  CoachMessage,
  CoachSendOptions,
} from './coach-service';
import { recordCoachUsage } from './coach-cost-tracker';
import { warnWithTs } from '@/lib/logger';

/**
 * Rough token estimator used for telemetry when the Gemma reply doesn't
 * surface a token count. 4 chars ≈ 1 token is the standard llama/gpt-family
 * approximation and is good enough for weekly aggregation.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Intents eligible for the phrase-only fallback. Numeric intents are excluded. */
export const FALLBACK_CANDIDATES: Exclude<
  VoiceIntent,
  'none' | 'add_weight' | 'log_rpe'
>[] = ['next', 'pause', 'resume', 'skip_rest', 'restart'];

/** Confidence assigned to a successful Gemma pick. */
export const GEMMA_FALLBACK_CONFIDENCE = 0.8;

/**
 * Builds the zero-shot Gemma prompt. Kept in its own function for unit
 * testing + future prompt iteration without touching call sites.
 */
export function buildGemmaNluPrompt(transcript: string): CoachMessage[] {
  const candidates = FALLBACK_CANDIDATES.join(', ');
  const system: CoachMessage = {
    role: 'system',
    content:
      'You classify short fitness-app voice commands into a fixed set of ' +
      'intents. Reply with ONLY the intent name (one token) or the literal ' +
      "word 'none'. Never explain.",
  };
  const user: CoachMessage = {
    role: 'user',
    content:
      `Candidate intents: ${candidates}\n` +
      `Transcript: "${transcript.trim()}"\n` +
      "Reply with the single best-matching intent, or 'none'.",
  };
  return [system, user];
}

/**
 * Parse the Gemma reply back into a VoiceIntent. Defensive — any shape
 * we don't recognize collapses to 'none'.
 */
export function parseGemmaNluResponse(raw: string): VoiceIntent {
  if (typeof raw !== 'string') return 'none';
  // Take the first whitespace-delimited token, lowercase, strip punctuation.
  const token = raw
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z_]/g, '') ?? '';
  if (token === 'none') return 'none';
  if ((FALLBACK_CANDIDATES as readonly string[]).includes(token)) {
    return token as VoiceIntent;
  }
  return 'none';
}

/**
 * Shape accepted by `classifyViaGemma`. Matches the public
 * `sendCoachPrompt` signature so production can pass it directly; tests
 * can supply a narrower stub since the extra params are optional.
 */
export type VoiceGemmaSendPrompt = (
  messages: CoachMessage[],
  ctx?: CoachContext,
  opts?: CoachSendOptions,
) => Promise<CoachMessage>;

/**
 * Invoke Gemma to pick the best candidate intent for the given
 * transcript. Returns a well-formed ClassifiedIntent — never throws.
 *
 * sendPrompt is injected to keep this module test-friendly. Production
 * callers pass `sendCoachPrompt` from coach-service; tests pass a mock.
 */
export async function classifyViaGemma(
  transcript: string,
  sendPrompt: VoiceGemmaSendPrompt,
): Promise<ClassifiedIntent> {
  const normalized = transcript.trim().toLowerCase();
  if (!normalized) {
    return { intent: 'none', params: {}, confidence: 0, normalized: '' };
  }
  const messages = buildGemmaNluPrompt(normalized);
  try {
    const reply = await sendPrompt(messages, undefined, {
      provider: 'gemma',
      taskKind: 'voice_nlu',
    });
    // Telemetry: record the Gemma turn so weekly dashboards capture
    // voice-NLU traffic. Uses the char-based estimator since the coach
    // edge function does not surface token counts for Gemma today.
    const promptText = messages.map((m) => m.content).join('\n');
    void recordCoachUsage({
      provider: 'gemma_cloud',
      taskKind: 'voice_nlu',
      tokensIn: estimateTokens(promptText),
      tokensOut: estimateTokens(reply.content ?? ''),
    });
    const intent = parseGemmaNluResponse(reply.content ?? '');
    if (intent === 'none') {
      return { intent: 'none', params: {}, confidence: 0, normalized };
    }
    return {
      intent,
      params: {},
      confidence: GEMMA_FALLBACK_CONFIDENCE,
      normalized,
    };
  } catch (err) {
    warnWithTs('[VoiceGemmaNlu] classifyViaGemma failed', err);
    return { intent: 'none', params: {}, confidence: 0, normalized };
  }
}
