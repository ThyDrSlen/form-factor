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
}

export interface CoachContext {
  profile?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  };
  focus?: string;
  sessionId?: string;
  /**
   * Optional in-session context passed to the coach edge function. When
   * present, the edge function appends a short "live session context" clause
   * to the system prompt. Purely additive — default call sites do not need to
   * set this.
   */
  liveSession?: LiveSessionSnapshot;
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
 * Send a coach prompt. Dispatch order:
 *   1. If `opts.stream` → streaming path (#466 Item 1)
 *   2. If `opts.allowFailover` → failover producer, optionally cached (#466 Items 2-3)
 *   3. If `opts.cacheMs > 0` → cached OpenAI path (#466 Item 3)
 *   4. Else → resolve cloud provider (from `opts.provider`, AsyncStorage, or env)
 *      - `gemma` → direct `sendCoachGemmaPrompt`
 *      - `openai` → `sendCoachPromptInner` (coach edge function)
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

  // No advanced opts: pick cloud provider (explicit hint, user pref, env, or openai default).
  const provider = opts?.provider ?? (await resolveCloudProvider());
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
  return { role: 'assistant', content: result.text };
}

async function sendCoachPromptInner(
  messages: CoachMessage[],
  context?: CoachContext
): Promise<CoachMessage> {
  try {
    const { data, error } = await supabase.functions.invoke<RawCoachResponse>(functionName, {
      body: { messages, context },
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
        throw createError(
          'network',
          'COACH_RATE_LIMITED',
          'Coach is rate-limited — try again in a moment.',
          { details: error, retryable: true }
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
        throw createError(
          'network',
          'COACH_RATE_LIMITED',
          'Coach is rate-limited — try again in a moment.',
          { details: data.error, retryable: true }
        );
      }

      throw createError(
        isConfigError ? 'validation' : 'network',
        isConfigError ? 'COACH_NOT_CONFIGURED' : 'COACH_ERROR',
        data.error,
        { retryable: !isConfigError }
      );
    }

    const responseText =
      data?.message?.trim() ||
      data?.content?.trim() ||
      data?.reply?.trim();

    if (!responseText) {
      throw createError(
        'validation',
        'COACH_EMPTY_RESPONSE',
        'Coach did not return a reply'
      );
    }

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
