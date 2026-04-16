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

interface RawCoachResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
}

const functionName = (process.env.EXPO_PUBLIC_COACH_FUNCTION || 'coach').trim();

/**
 * Flag check is a function (not a module-level constant) so tests and runtime
 * overrides can toggle `process.env.EXPO_PUBLIC_COACH_LOCAL` between calls.
 */
function isLocalCoachEnabled(): boolean {
  return (process.env.EXPO_PUBLIC_COACH_LOCAL || '').trim() === '1';
}

/**
 * Recognise the sentinel error thrown by `coach-local.ts` so we can fall back
 * to the cloud path without swallowing other errors. Kept duck-typed so we
 * don't circularly import the local provider (it imports `CoachMessage` from
 * here).
 */
function isLocalUnavailableError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'COACH_LOCAL_NOT_AVAILABLE'
  );
}

export async function sendCoachPrompt(
  messages: CoachMessage[],
  context?: CoachContext
): Promise<CoachMessage> {
  // Feature-flagged on-device path. When the flag is off, this branch is
  // skipped entirely and behavior matches the pre-flag implementation.
  if (isLocalCoachEnabled()) {
    try {
      // Lazy require so the bundler does not pull the local provider (and its
      // future ExecuTorch native dep) into builds where the flag is off.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sendCoachPromptLocal } = require('./coach-local') as typeof import('./coach-local');
      return await sendCoachPromptLocal(messages, context);
    } catch (localErr) {
      if (!isLocalUnavailableError(localErr)) {
        // A real local-coach failure (e.g. OOM) should surface to the caller
        // rather than silently escape to cloud.
        throw localErr;
      }
      warnWithTs('[coach] Local coach unavailable, falling back to cloud');
      // fall through to cloud path below
    }
  }

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
