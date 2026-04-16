import { supabase } from '@/lib/supabase';
import { errorWithTs, warnWithTs } from '@/lib/logger';
import { createError, logError } from './ErrorHandler';
import { shapeCoachResponse } from './coach-output-shaper';
import { summarizeRollingWindow } from './coach-conversation-summarizer';
import { getCachedTip, getOfflineFallback } from './coach-cache';

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
  /**
   * Optional fault id. When set and EXPO_PUBLIC_COACH_CACHE=1, the cache
   * layer may short-circuit the network round-trip by returning a canned
   * tip. Populated by the context enricher (PR #431).
   */
  faultId?: string;
  /**
   * Optional exercise slug (e.g. "squat"). Fallback key for the cache
   * layer when no fault id is available.
   */
  exerciseSlug?: string;
  /**
   * Optional online flag. When false and EXPO_PUBLIC_COACH_CACHE=1 we
   * serve a cached tip without hitting the network. When omitted the
   * service assumes online.
   */
  isOnline?: boolean;
}

interface RawCoachResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
}

const functionName = (process.env.EXPO_PUBLIC_COACH_FUNCTION || 'coach').trim();

function isCacheFlagOn(): boolean {
  return (process.env.EXPO_PUBLIC_COACH_CACHE || '').trim() === '1';
}

function isCompressFlagOn(): boolean {
  return (process.env.EXPO_PUBLIC_COACH_MEMORY_COMPRESS || '').trim() === '1';
}

/**
 * When the cache flag is on and we have a fault id or exercise slug, check
 * the canned-tip cache before going to the network. This is skipped when
 * the flag is off so existing behaviour is preserved.
 */
function maybeServeFromCache(context?: CoachContext): CoachMessage | null {
  if (!isCacheFlagOn()) return null;

  // When offline, always attempt cache (fault id / exercise / generic).
  const offline = context?.isOnline === false;

  const key = context?.faultId || context?.exerciseSlug;
  if (key) {
    const tip = getCachedTip(key);
    if (tip) {
      return { role: 'assistant', content: tip.text };
    }
  }

  if (offline) {
    // No specific tip — return the generic offline fallback rather than
    // bubble up a network error.
    const fallback = getOfflineFallback();
    return { role: 'assistant', content: fallback.text };
  }

  return null;
}

export async function sendCoachPrompt(
  messages: CoachMessage[],
  context?: CoachContext
): Promise<CoachMessage> {
  // Cache short-circuit (flag-gated, no-op by default).
  const cached = maybeServeFromCache(context);
  if (cached) return cached;

  // Compress long histories when flag is on. Deterministic and zero-I/O.
  const dispatchMessages = isCompressFlagOn()
    ? summarizeRollingWindow(messages)
    : messages;

  try {
    const { data, error } = await supabase.functions.invoke<RawCoachResponse>(functionName, {
      body: { messages: dispatchMessages, context },
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

    // Light markdown / emoji post-processor. Pure and idempotent; safe to
    // run on every response.
    const shaped = shapeCoachResponse(responseText);

    return {
      role: 'assistant',
      content: shaped,
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
