import { supabase } from '@/lib/supabase';
import { createError } from './ErrorHandler';

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
      const isNotFound = (error as any)?.status === 404 || errorMessage.includes('404');
      
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

    return {
      role: 'assistant',
      content: responseText,
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'domain' in (err as any)) {
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
