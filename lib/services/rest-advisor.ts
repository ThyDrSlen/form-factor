/**
 * Rest Duration Advisor
 *
 * Recommends rest seconds between sets based on the last rep's tempo, optional
 * heart rate, and optional RPE. Calls Gemma/coach in JSON mode with few-shot
 * priming, with a deterministic fallback for offline / timeout scenarios.
 *
 * IMPORTANT: This service intentionally does NOT edit lib/services/rest-timer.ts.
 * The existing computeRestSeconds() heuristic remains the source of truth for
 * default session timers; rest-advisor is an opt-in AI refinement.
 */
import { sendCoachPrompt, type CoachContext, type CoachMessage } from './coach-service';
import { parseGemmaJsonResponse, schema, type JsonSchema } from './gemma-json-parser';
import { isGemmaSessionGenEnabled } from './gemma-session-gen-flag';
import { getFewShots } from './template-generation-few-shots';

export interface RestAdvisorInput {
  /** Duration of the final rep in the just-completed set, in milliseconds. */
  readonly lastRepTempoMs: number;
  /** Optional current heart rate in bpm. */
  readonly hrBpm?: number;
  /** Optional perceived exertion 1-10. */
  readonly setRpe?: number;
  /** Optional goal profile to bias recommendation. */
  readonly goalProfile?: 'hypertrophy' | 'strength' | 'power' | 'endurance' | 'mixed';
}

export interface RestAdvice {
  seconds: number;
  reasoning: string;
}

const REST_SHAPE: JsonSchema<RestAdvice> = schema.object({
  seconds: schema.number({ min: 10, max: 900, integer: true }),
  reasoning: schema.string({ minLength: 1 }),
});

const SYSTEM_PROMPT = [
  'You are a rest-duration advisor for the Form Factor fitness app.',
  'Given the final rep tempo, optional HR, optional RPE, and goal profile, recommend rest seconds.',
  'Required shape: { seconds: number, reasoning: string }.',
  'Rules:',
  '- Output JSON ONLY.',
  '- seconds must be an integer between 10 and 900.',
  '- reasoning must be one short sentence grounded in the inputs.',
  '- High RPE (>= 8) + slow last rep + elevated HR → longer rest (120-240s).',
  '- Moderate RPE (6-7) → 60-90s for hypertrophy, 120s for strength.',
  '- Low RPE (<= 5) + fast tempo → 30-60s.',
].join('\n');

export interface RestAdvisorRuntime {
  coachContext?: CoachContext;
  dispatch?: (messages: CoachMessage[], ctx?: CoachContext) => Promise<CoachMessage>;
  /** Timeout for the Gemma call before falling back to the heuristic. Default 2000ms. */
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Bypass the EXPO_PUBLIC_GEMMA_SESSION_GEN gate and always call the real
   * dispatcher. Intended for integration tests.
   */
  skipFlagCheck?: boolean;
}

/**
 * Return the deterministic heuristic rest seconds. Exported for tests and used
 * as an on-failure fallback so callers can always get a value.
 */
export function heuristicRestSeconds(input: RestAdvisorInput): RestAdvice {
  const { lastRepTempoMs, hrBpm, setRpe, goalProfile } = input;
  const tempoPenalty = lastRepTempoMs > 2500 ? 60 : lastRepTempoMs > 1800 ? 30 : 0;
  const hrPenalty = hrBpm != null ? (hrBpm > 150 ? 60 : hrBpm > 130 ? 30 : 0) : 0;
  const rpePenalty = setRpe != null ? (setRpe >= 9 ? 90 : setRpe >= 8 ? 60 : setRpe >= 7 ? 30 : 0) : 0;

  let base = 60;
  switch (goalProfile) {
    case 'strength':
    case 'power':
      base = 150;
      break;
    case 'hypertrophy':
      base = 75;
      break;
    case 'endurance':
      base = 45;
      break;
    case 'mixed':
    default:
      base = 75;
  }

  const seconds = Math.max(10, Math.min(900, base + tempoPenalty + hrPenalty + rpePenalty));

  const reasoningBits: string[] = [];
  reasoningBits.push(`base ${base}s for ${goalProfile ?? 'default'}`);
  if (tempoPenalty > 0) reasoningBits.push(`+${tempoPenalty}s (slow last rep ${lastRepTempoMs}ms)`);
  if (hrPenalty > 0) reasoningBits.push(`+${hrPenalty}s (HR ${hrBpm}bpm)`);
  if (rpePenalty > 0) reasoningBits.push(`+${rpePenalty}s (RPE ${setRpe})`);

  return {
    seconds,
    reasoning: `Heuristic: ${reasoningBits.join(', ')}`,
  };
}

function buildMessages(input: RestAdvisorInput): CoachMessage[] {
  const fewShots = getFewShots({ domain: 'rest', limit: 3 });
  const messages: CoachMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const ex of fewShots) {
    messages.push({ role: 'user', content: ex.prompt });
    messages.push({ role: 'assistant', content: ex.response });
  }

  const parts: string[] = [];
  parts.push(`Last rep tempo: ${input.lastRepTempoMs}ms`);
  if (input.hrBpm != null) parts.push(`HR: ${input.hrBpm}bpm`);
  if (input.setRpe != null) parts.push(`RPE: ${input.setRpe}`);
  if (input.goalProfile) parts.push(`Goal: ${input.goalProfile}`);
  parts.push('Respond with JSON only.');

  messages.push({ role: 'user', content: parts.join('\n') });
  return messages;
}

/**
 * Suggest rest seconds. Falls back to a deterministic heuristic on timeout or
 * parse failure so the caller always gets a usable value.
 */
export async function suggestRestSeconds(
  input: RestAdvisorInput,
  runtime: RestAdvisorRuntime = {},
): Promise<RestAdvice> {
  // Flag gate: rest-advisor is called in-loop during an active set, so a
  // disabled flag should short-circuit to the deterministic heuristic rather
  // than throw. This keeps the workout UX smooth even when Gemma is off.
  // Custom dispatch overrides (tests) and `skipFlagCheck` bypass the gate.
  if (!runtime.dispatch && !runtime.skipFlagCheck && !isGemmaSessionGenEnabled()) {
    return heuristicRestSeconds(input);
  }

  const dispatch = runtime.dispatch ?? sendCoachPrompt;
  const timeoutMs = runtime.timeoutMs ?? 2000;

  const messages = buildMessages(input);

  let raceResult: { kind: 'ok'; content: string } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

  try {
    const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    });
    const callPromise = dispatch(messages, runtime.coachContext)
      .then((m) => ({ kind: 'ok' as const, content: m.content }))
      .catch((error) => ({ kind: 'error' as const, error }));

    raceResult = await Promise.race([callPromise, timeoutPromise]);
  } catch (error) {
    raceResult = { kind: 'error', error };
  }

  if (raceResult.kind !== 'ok') {
    return heuristicRestSeconds(input);
  }

  try {
    const retryInvoker = async (ctx: { lastRawText: string; issues?: unknown }): Promise<string> => {
      const retryMessages: CoachMessage[] = [
        ...messages,
        { role: 'assistant', content: ctx.lastRawText },
        {
          role: 'user',
          content: `The previous response did not match { seconds, reasoning }. Issues: ${JSON.stringify(ctx.issues ?? 'syntax error')}. Respond ONLY with corrected JSON.`,
        },
      ];
      const retry = await dispatch(retryMessages, runtime.coachContext);
      return retry.content;
    };

    return await parseGemmaJsonResponse(raceResult.content, REST_SHAPE, {
      maxRetries: runtime.maxRetries ?? 0,
      retry: retryInvoker,
    });
  } catch {
    return heuristicRestSeconds(input);
  }
}
