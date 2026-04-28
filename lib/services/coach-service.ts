import { supabase } from '@/lib/supabase';
import { errorWithTs, warnWithTs } from '@/lib/logger';
import { createError, logError } from './ErrorHandler';
import { resolveCloudProvider } from './coach-cloud-provider';
import { sendCoachGemmaPrompt } from './coach-gemma-service';
import {
  inferCoachProvider,
  type CoachProvider,
  type CoachProviderSignal,
} from './coach-provider-types';
import { synthesizeMemoryClause } from './coach-memory-context';
import { shapeFinalResponse } from './coach-output-shaper';
import { isCoachPipelineV2Enabled } from './coach-pipeline-v2-flag';
import { evaluateSafety } from './coach-safety';
import {
  decideCoachModel,
  type CoachTaskKind,
  type CoachUserTier,
  type CoachSignals,
} from './coach-model-dispatch';
import { isDispatchEnabled } from './coach-model-dispatch-flag';
import { recordDispatchDecision } from './coach-model-dispatch-telemetry';

export type { CoachProvider } from './coach-provider-types';
import type { LiveSessionSnapshot } from './coach-live-snapshot';

export type CoachRole = 'user' | 'assistant' | 'system';

export interface CoachMessage {
  role: CoachRole;
  content: string;
  id?: string;
  /**
   * The AI backend that produced this message. Set only on assistant replies
   * returned by `sendCoachPrompt`. Absent on user / system turns.
   */
  provider?: CoachProvider;
  /**
   * Model identifier returned by the upstream function (e.g. `gemma-3-4b-it`,
   * `gpt-5.4-mini`). Additive — callers may inspect for telemetry or model
   * routing audits; older producers that don't surface `model` leave it
   * undefined.
   */
  model?: string;
}

export interface CoachContext {
  /**
   * Identifier and display name only. NEVER include email, phone, or other
   * PII — prompts flow to third-party LLMs (OpenAI, Google Gemma cloud) and
   * may be logged at the edge. Keep this field minimal. Downstream edge
   * functions still accept an optional `email` in their input schema for
   * backward compatibility, but the client MUST NOT populate it.
   */
  profile?: {
    id?: string;
    name?: string | null;
  };
  /**
   * User-context label for prompt composition ONLY (e.g. 'fitness_coach',
   * 'pre-set-stance-preview'). Does NOT influence cost-aware routing — use
   * `CoachSendOptions.taskKind` to control which provider/model serves the
   * request. Callers that rely on `focus` for routing will silently hit the
   * default dispatch path.
   */
  focus?: string;
  sessionId?: string;
  /**
   * Optional in-session context passed to the coach edge function. When
   * present, the edge function appends a short "live session context" clause
   * to the system prompt. Purely additive — default call sites do not need to
   * set this.
   */
  liveSession?: LiveSessionSnapshot;
  /**
   * Optional pre-composed memory clause. When provided, skips the
   * AsyncStorage/Supabase lookup inside sendCoachPrompt() — useful for
   * callers (e.g. auto-debrief) that already built their own memory.
   */
  memoryClause?: string | null;
}

/**
 * Optional behaviors for `sendCoachPrompt`. All fields are additive and the
 * existing two-arg call shape (`sendCoachPrompt(messages, ctx?)`) keeps the
 * exact behavior it had before #465 landed.
 */
export interface CoachSendOptions {
  /**
   * Streaming mode (#465 Item 1).
   * - `true`: stream and return the full text once complete (no per-chunk callback).
   * - function: stream and invoke the callback for every delta.
   * - omitted/false: synchronous (default).
   */
  stream?: boolean | ((chunk: string) => void);
  /**
   * If true and the primary call returns 429/5xx, automatically retry against
   * the secondary provider (#465 Item 2).
   */
  allowFailover?: boolean;
  /**
   * Provider hint for streaming and for failover routing (`gemma`|`openai`).
   */
  provider?: 'gemma' | 'openai';
  /**
   * Response cache TTL in ms (#465 Item 3). 0 disables caching; omitted means
   * cache lookups are not consulted. Defaults are picked at the call site
   * (e.g. auto-debrief uses 12h).
   */
  cacheMs?: number;
  /**
   * Used by the cache integration to flag that the cached payload is the
   * already-shaped response (#465 Item 5). Internal; callers shouldn't need it.
   */
  shaper?: boolean;
  /**
   * Pipeline-v2 task kind hint. When the master flag is on AND
   * `EXPO_PUBLIC_COACH_DISPATCH=on`, the task kind is fed to
   * `decideCoachModel()` to pick a provider (tactical → Gemma, complex → GPT)
   * before the legacy provider hint runs. Omitted means "general_chat".
   *
   * NOTE: `taskKind` is the ONLY routing signal. `CoachContext.focus` is a
   * cosmetic prompt label and does not affect model selection — always set
   * `taskKind` for new surfaces that should be cost-aware routed.
   */
  taskKind?: CoachTaskKind;
  /** Pipeline-v2 user tier for cost-aware model routing. Defaults to 'free'. */
  userTier?: CoachUserTier;
  /** Pipeline-v2 optional signals fed into the model dispatcher. */
  dispatchSignals?: CoachSignals;
}

interface RawCoachResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
  /** Provider discriminator — optional; may be absent from legacy responses. */
  provider?: CoachProvider | string;
  /** Model name (e.g. `gpt-5.4-mini`, `gemma-2b`). Used to infer provider. */
  model?: string;
  /** Coarse origin marker for cache / local-fallback paths. */
  source?: 'cache' | 'local' | 'remote';
}

const DEFAULT_MODEL_ID = 'gpt-5.4-mini';
const functionName = (process.env.EXPO_PUBLIC_COACH_FUNCTION || 'coach').trim();

/**
 * Parse a `Retry-After` header value per RFC 7231. The header carries either
 * an integer number of seconds OR an HTTP-date. Returns the delay in
 * milliseconds, or undefined if the value can't be parsed.
 *
 * Exported for reuse by `coach-gemma-service.ts` — the two services share the
 * same 429 handling contract.
 */
export function parseRetryAfterMs(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt >= 0 && /^\d+$/.test(raw.trim())) {
    return asInt * 1000;
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return undefined;
}

/**
 * Extract a `Retry-After` delay (ms) from a Supabase Edge Functions failure
 * tuple. Handles both shapes the SDK returns on 429:
 *   - `response.headers.get('Retry-After')` — the raw Response from a
 *     FunctionsHttpError.
 *   - `error.context.headers.get('Retry-After')` — the same Response, but
 *     surfaced via the error wrapper.
 * Returns undefined when neither path yields a header.
 */
function extractRetryAfterMs(
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
 * Feature-flag gate for prepending cross-session memory to coach prompts.
 * Defaults to ON (value 'true' or unset). Any other value disables the
 * memory clause so the coach behaves as before.
 */
function isMemoryEnabled(): boolean {
  const raw = (process.env.EXPO_PUBLIC_COACH_MEMORY ?? 'true').trim().toLowerCase();
  return raw === '' || raw === 'true' || raw === '1' || raw === 'on';
}

async function resolveMemoryClause(context?: CoachContext): Promise<string | null> {
  if (!isMemoryEnabled()) return null;
  if (context?.memoryClause !== undefined) return context.memoryClause ?? null;
  try {
    const clause = await synthesizeMemoryClause();
    return clause.text;
  } catch (err) {
    warnWithTs('[coach-service] memory clause synth failed; continuing without memory', err);
    return null;
  }
}

function applyMemoryClause(
  messages: CoachMessage[],
  memoryClause: string | null,
): CoachMessage[] {
  if (!memoryClause) return messages;
  const memoryMessage: CoachMessage = {
    role: 'system',
    content: `Athlete memory (recent sessions): ${memoryClause}`,
  };
  return [memoryMessage, ...messages];
}

/**
 * Send a coach prompt. Dispatch order:
 *   1. If `opts.stream` → streaming path (#466 Item 1)
 *   2. If `opts.allowFailover` → failover producer, optionally cached (#466 Items 2-3)
 *   3. If `opts.cacheMs > 0` → cached OpenAI path (#466 Item 3)
 *   4. Else → resolve cloud provider (from `opts.provider`, AsyncStorage, or env)
 *      - `gemma` → direct `sendCoachGemmaPrompt`
 *      - `openai` → `sendCoachPromptInner` (coach edge function)
 *
 * Memory clause (#461) is synthesized inside `sendCoachPromptInner` for the
 * OpenAI path; callers may opt out by setting `EXPO_PUBLIC_COACH_MEMORY=false`
 * or pre-composing `context.memoryClause`.
 *
 * Backward compatible: the two-arg call shape hits the cloud provider selector,
 * which defaults to `openai` absent any user/env preference.
 */
export async function sendCoachPrompt(
  messages: CoachMessage[],
  context?: CoachContext,
  opts?: CoachSendOptions
): Promise<CoachMessage> {
  if (opts?.stream) {
    return sendCoachPromptStreaming(messages, context, opts);
  }
  if (opts?.allowFailover) {
    // Lazy require keeps the dep graph 1-way and avoids load-order issues
    // (await import() does not work in jest's CJS env without
    // --experimental-vm-modules).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendCoachPromptWithFailover } = require('./coach-failover') as typeof import('./coach-failover');
    const failoverProducer = () =>
      sendCoachPromptWithFailover(messages, context, {
        primary: opts.provider ?? 'gemma',
        secondary: opts.provider === 'openai' ? 'gemma' : 'openai',
      });
    if (typeof opts.cacheMs === 'number' && opts.cacheMs > 0) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { withCoachCache } = require('./coach-cache') as typeof import('./coach-cache');
      return withCoachCache(messages, context, opts.cacheMs, failoverProducer, {
        shaper: opts.shaper,
      });
    }
    return failoverProducer();
  }
  if (typeof opts?.cacheMs === 'number' && opts.cacheMs > 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withCoachCache } = require('./coach-cache') as typeof import('./coach-cache');
    return withCoachCache(
      messages,
      context,
      opts.cacheMs,
      () => sendCoachPromptInner(messages, context),
      { shaper: opts.shaper }
    );
  }

  // Pipeline v2: consult the task-kind router BEFORE the legacy provider
  // hint is applied. When the model dispatcher picks a Gemma model and the
  // caller hasn't already pinned a provider, route to Gemma. Otherwise fall
  // through to the existing provider resolution. READ-ONLY on
  // coach-model-dispatch.ts itself. Fires a single-shot telemetry counter so
  // product can track dispatch decisions as rollout progresses.
  let routedProvider: 'gemma' | 'openai' | undefined;
  if (
    isCoachPipelineV2Enabled() &&
    isDispatchEnabled() &&
    opts?.taskKind &&
    opts.provider === undefined
  ) {
    const decision = decideCoachModel(
      opts.taskKind,
      opts.dispatchSignals ?? {},
      opts.userTier ?? 'free',
    );
    try {
      recordDispatchDecision(decision);
    } catch {
      // Telemetry is never load-bearing; swallow any recorder fault so the
      // coach turn still proceeds.
    }
    routedProvider = decision.model.startsWith('gemma-') ? 'gemma' : 'openai';
  }

  // No advanced opts: pick cloud provider (explicit hint, dispatcher, user pref, env, or openai default).
  const provider = opts?.provider ?? routedProvider ?? (await resolveCloudProvider());
  if (provider === 'gemma') {
    return sendCoachGemmaPrompt(messages, context);
  }
  return sendCoachPromptInner(messages, context);
}

async function sendCoachPromptStreaming(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  opts: CoachSendOptions
): Promise<CoachMessage> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { streamCoachPrompt } = require('./coach-streaming') as typeof import('./coach-streaming');
  const onChunk =
    typeof opts.stream === 'function' ? opts.stream : () => undefined;
  const result = await streamCoachPrompt(messages, context, onChunk, {
    provider: opts.provider,
  });

  // Pipeline v2: apply the post-generation safety filter to the resolved
  // full-buffer text. Mirrors the non-stream path in sendCoachPromptInner.
  // On violation we throw `COACH_CLOUD_UNSAFE`; the UI surfaces it and the
  // dispatcher can choose a fallback string. Flag-gated.
  if (isCoachPipelineV2Enabled()) {
    const safety = evaluateSafety(result.text);
    if (!safety.ok) {
      logError(
        createError(
          'ml',
          'COACH_CLOUD_UNSAFE',
          `Cloud coach stream rejected: ${safety.reason}`,
          {
            retryable: false,
            severity: 'warning',
            details: { metric: safety.metric, reason: safety.reason },
          }
        ),
        { feature: 'workouts', location: 'coach-service.sendCoachPromptStreaming' }
      );
      throw createError(
        'ml',
        'COACH_CLOUD_UNSAFE',
        'Coach reply failed safety check',
        {
          retryable: false,
          severity: 'warning',
          details: { metric: safety.metric, reason: safety.reason },
        }
      );
    }
    return { role: 'assistant', content: shapeFinalResponse(safety.output) };
  }
  return { role: 'assistant', content: result.text };
}

async function sendCoachPromptInner(
  messages: CoachMessage[],
  context?: CoachContext
): Promise<CoachMessage> {
  try {
    const memoryClause = await resolveMemoryClause(context);
    const outgoingMessages = applyMemoryClause(messages, memoryClause);
    const outgoingContext =
      memoryClause !== null
        ? { ...(context ?? {}), memoryClause }
        : context;

    const { data, error, response } = await supabase.functions.invoke<RawCoachResponse>(functionName, {
      body: { messages: outgoingMessages, context: outgoingContext },
    });

    if (error) {
      // Check for specific error types based on error message or context
      const errorMessage = error.message || '';
      const isConfigError = errorMessage.includes('not configured') ||
                           errorMessage.includes('OPENAI_API_KEY') ||
                           errorMessage.includes('missing');
      const hasStatus = typeof error === 'object' && error !== null && 'status' in error;
      const status = hasStatus ? (error as { status: unknown }).status : undefined;
      const isNotFound = (status === 404) || errorMessage.includes('404');
      const isRateLimited =
        status === 429 ||
        /\b429\b/.test(errorMessage) ||
        /rate.?limit/i.test(errorMessage) ||
        /too many requests/i.test(errorMessage);

      if (isNotFound) {
        throw createError(
          'validation',
          'COACH_NOT_DEPLOYED',
          'Coach service is not available. Please contact support.',
          { details: error, retryable: false }
        );
      }

      if (isConfigError) {
        throw createError(
          'validation',
          'COACH_NOT_CONFIGURED',
          'Coach is not configured. Please contact support.',
          { details: error, retryable: false }
        );
      }

      if (isRateLimited) {
        const retryAfterMs = extractRetryAfterMs(response, error);
        throw createError(
          'network',
          'COACH_RATE_LIMITED',
          'Coach is rate-limited — try again in a moment.',
          {
            details: retryAfterMs !== undefined ? { error, retryAfterMs } : error,
            retryable: true,
          }
        );
      }

      throw createError(
        'network',
        'COACH_INVOKE_FAILED',
        error.message || 'Coach request failed',
        {
          details: error,
          retryable: true,
        }
      );
    }

    // Check if the response itself contains an error field
    if (data?.error) {
      const isConfigError = data.error.includes('not configured') ||
                           data.error.includes('OPENAI_API_KEY');
      const isRateLimitedPayload =
        /\b429\b/.test(data.error) ||
        /rate.?limit/i.test(data.error) ||
        /too many requests/i.test(data.error);

      if (isRateLimitedPayload) {
        const retryAfterMs = extractRetryAfterMs(response, error);
        throw createError(
          'network',
          'COACH_RATE_LIMITED',
          'Coach is rate-limited — try again in a moment.',
          {
            details:
              retryAfterMs !== undefined
                ? { error: data.error, retryAfterMs }
                : data.error,
            retryable: true,
          }
        );
      }

      throw createError(
        isConfigError ? 'validation' : 'network',
        isConfigError ? 'COACH_NOT_CONFIGURED' : 'COACH_ERROR',
        data.error,
        { retryable: !isConfigError }
      );
    }

    const rawResponseText =
      data?.message?.trim() ||
      data?.content?.trim() ||
      data?.reply?.trim();

    if (!rawResponseText) {
      throw createError(
        'validation',
        'COACH_EMPTY_RESPONSE',
        'Coach did not return a reply'
      );
    }

    // Pipeline v2: apply the post-generation safety filter to cloud responses
    // before returning. Mirrors `coach-local.ts:finalizeOutput` so cloud and
    // on-device paths enforce the same safety rules. On violation we throw
    // `COACH_CLOUD_UNSAFE`; the dispatcher/UI surfaces it or falls back to
    // a fallback-response string.
    let safeResponseText = rawResponseText;
    if (isCoachPipelineV2Enabled()) {
      const safety = evaluateSafety(rawResponseText);
      if (!safety.ok) {
        const unsafeErr = createError(
          'ml',
          'COACH_CLOUD_UNSAFE',
          'Coach reply failed safety check',
          {
            retryable: false,
            severity: 'warning',
            details: { metric: safety.metric, reason: safety.reason },
          }
        );
        try {
          logError(unsafeErr, {
            feature: 'workouts',
            location: 'coach-service.sendCoachPromptInner',
          });
        } catch {
          // logError should never throw in prod; swallow in case test env
          // misconfigures expo-constants/Platform so the safety rejection
          // still reaches the caller with the right code.
        }
        throw unsafeErr;
      }
      // evaluateSafety returns the possibly-word-capped text on pass.
      safeResponseText = safety.output;
    }

    // Pipeline v2: shape the synchronous response (strips filler, normalizes
    // lists, caps budget — see coach-output-shaper.ts). Flag-gated so existing
    // callers keep the raw text until rollout.
    const responseText = isCoachPipelineV2Enabled()
      ? shapeFinalResponse(safeResponseText)
      : safeResponseText;

    // WHY: the edge function today only returns text (no provider field). We
    // infer the provider from whatever signal it does emit (model name +
    // optional `source`) so the UI can still show a badge. Once the edge
    // function starts returning `provider` explicitly, that wins.
    const signal: CoachProviderSignal = {
      provider: data?.provider,
      model: data?.model ?? DEFAULT_MODEL_ID,
      source: data?.source,
    };
    const provider = inferCoachProvider(signal);
    const modelId = signal.model ?? DEFAULT_MODEL_ID;

    if (context?.profile?.id && context.sessionId) {
      const userTurns = messages.filter(m => m.role === 'user');
      const insertPayload = {
        user_id: context.profile.id,
        session_id: context.sessionId,
        turn_index: Math.max(0, userTurns.length - 1),
        user_message: userTurns[userTurns.length - 1]?.content ?? '',
        assistant_message: responseText,
        input_messages: messages,
        context: { focus: context.focus },
        metadata: { model: modelId, provider, timestamp: new Date().toISOString() },
      };
      supabase.from('coach_conversations').insert(insertPayload).then(({ error: insertErr }) => {
        if (!insertErr) return;
        warnWithTs('[coach] Conversation persist failed, retrying once', insertErr.message);
        supabase.from('coach_conversations').insert(insertPayload).then(({ error: retryErr }) => {
          if (retryErr) {
            errorWithTs('[coach] Conversation persist failed after retry', retryErr.message);
            logError(
              createError('storage', 'COACH_PERSIST_FAILED', 'Coach conversation persist failed after retry', {
                details: retryErr,
                retryable: false,
                severity: 'error',
              }),
              { feature: 'workouts', location: 'coach-service.sendCoachPrompt' }
            );
          }
        });
      });
    } else {
      console.warn('[coach] Conversation persistence skipped: missing profile.id or sessionId', {
        hasProfileId: Boolean(context?.profile?.id),
        hasSessionId: Boolean(context?.sessionId),
      });
    }

    // WHY non-enumerable: `provider` is a supplementary annotation on the
    // assistant reply. Keeping it non-enumerable preserves backward-compatible
    // equality semantics for existing consumers that shallow-compare replies,
    // while still letting TypeScript + the UI read `msg.provider`.
    const reply: CoachMessage = { role: 'assistant', content: responseText };
    Object.defineProperty(reply, 'provider', {
      value: provider,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return reply;
  } catch (err) {
    if (err && typeof err === 'object' && 'domain' in err) {
      throw err;
    }

    throw createError(
      'network',
      'COACH_REQUEST_FAILED',
      'Unable to reach the coach service',
      { details: err, retryable: true }
    );
  }
}
