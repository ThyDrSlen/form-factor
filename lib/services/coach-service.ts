import { supabase } from '@/lib/supabase';
import { errorWithTs, warnWithTs } from '@/lib/logger';
import { createError, logError } from './ErrorHandler';
import { bucketFor, isInCohort } from './coach-rollout';
import { COACH_LOCAL_NOT_AVAILABLE, sendCoachPromptLocal } from './coach-local';
import { recordFallback, recordRolloutBucket } from './coach-telemetry';

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
 * Dispatcher — decides between the on-device Gemma path and the cloud
 * Edge Function. Local path requires BOTH `EXPO_PUBLIC_COACH_LOCAL === '1'`
 * AND the user being in the hashed cohort. Falls back to cloud on the
 * `COACH_LOCAL_NOT_AVAILABLE` sentinel; rethrows every other local error
 * so real OOM / thermal / safety-reject issues surface instead of being
 * silently absorbed.
 */
function shouldAttemptLocal(context?: CoachContext): boolean {
  if (process.env.EXPO_PUBLIC_COACH_LOCAL !== '1') return false;
  return isInCohort(context?.profile?.id);
}

export async function sendCoachPrompt(
  messages: CoachMessage[],
  context?: CoachContext
): Promise<CoachMessage> {
  if (shouldAttemptLocal(context)) {
    const uid = context?.profile?.id;
    if (uid) recordRolloutBucket(bucketFor(uid));
    try {
      return await sendCoachPromptLocal(messages, context);
    } catch (localErr) {
      const code =
        localErr && typeof localErr === 'object' && 'code' in localErr
          ? (localErr as { code?: string }).code
          : undefined;
      if (code === COACH_LOCAL_NOT_AVAILABLE) {
        // Expected during scaffold phase — fall through to cloud.
        recordFallback('local_not_available');
      } else {
        // Real failure (OOM / thermal / safety-reject); bubble up instead
        // of masking.
        throw localErr;
      }
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
