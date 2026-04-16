import { supabase } from '@/lib/supabase';
import { errorWithTs, warnWithTs } from '@/lib/logger';
import { createError, logError } from './ErrorHandler';

export type CoachRole = 'user' | 'assistant' | 'system';

export interface CoachMessage {
  role: CoachRole;
  content: string;
  id?: string;
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
}

const functionName = (process.env.EXPO_PUBLIC_COACH_FUNCTION || 'coach').trim();

export async function sendCoachPrompt(
  messages: CoachMessage[],
  context?: CoachContext,
  opts?: CoachSendOptions
): Promise<CoachMessage> {
  // Back-compat: when no opts are provided, the original code path runs
  // verbatim. New behavior is only enabled when callers opt in.
  if (opts?.stream) {
    return sendCoachPromptStreaming(messages, context, opts);
  }
  if (opts?.allowFailover) {
    // Lazy import keeps the dep graph 1-way and avoids load-order issues.
    const { sendCoachPromptWithFailover } = await import('./coach-failover');
    return sendCoachPromptWithFailover(messages, context, {
      primary: opts.provider ?? 'gemma',
      secondary: opts.provider === 'openai' ? 'gemma' : 'openai',
    });
  }

  return sendCoachPromptInner(messages, context);
}

async function sendCoachPromptStreaming(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  opts: CoachSendOptions
): Promise<CoachMessage> {
  const { streamCoachPrompt } = await import('./coach-streaming');
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
      const isNotFound = (hasStatus && (error as { status: unknown }).status === 404) || errorMessage.includes('404');
      
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
        metadata: { model: 'gpt-5.4-mini', timestamp: new Date().toISOString() },
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

    return {
      role: 'assistant',
      content: responseText,
    };
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
