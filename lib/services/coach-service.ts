import { supabase } from '@/lib/supabase';
import { errorWithTs, warnWithTs } from '@/lib/logger';
import { createError, logError } from './ErrorHandler';
import { synthesizeMemoryClause } from './coach-memory-context';

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
   * Optional pre-composed memory clause. When provided, skips the
   * AsyncStorage/Supabase lookup inside sendCoachPrompt() — useful for
   * callers (e.g. auto-debrief) that already built their own memory.
   */
  memoryClause?: string | null;
}

interface RawCoachResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
}

const functionName = (process.env.EXPO_PUBLIC_COACH_FUNCTION || 'coach').trim();

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

export async function sendCoachPrompt(
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

    const { data, error } = await supabase.functions.invoke<RawCoachResponse>(functionName, {
      body: { messages: outgoingMessages, context: outgoingContext },
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
