import { supabase } from '@/lib/supabase';
import { errorWithTs, warnWithTs } from '@/lib/logger';
import { createError, logError } from './ErrorHandler';
import {
  inferCoachProvider,
  type CoachProvider,
  type CoachProviderSignal,
} from './coach-provider-types';

export type { CoachProvider } from './coach-provider-types';

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

export async function sendCoachPrompt(
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
