import { supabase } from '@/lib/supabase';
import { createError } from './ErrorHandler';
import type { CoachContext, CoachMessage } from './coach-service';

interface RawCoachGemmaResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
  model?: string;
}

const DEFAULT_FUNCTION_NAME = 'coach-gemma';

function functionName(): string {
  return (process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION || DEFAULT_FUNCTION_NAME).trim();
}

/**
 * Send a coach prompt to the Gemma cloud provider (Supabase edge function
 * coach-gemma) which proxies to Google's Gemini `generateContent` API for the
 * Gemma 3 family.
 *
 * The wire format on the edge function is identical to the OpenAI-backed
 * coach function: `{ messages, context }`. The provider differs on the
 * server; the client returns the same `CoachMessage` shape.
 */
export async function sendCoachGemmaPrompt(
  messages: CoachMessage[],
  context?: CoachContext,
  opts?: { model?: string },
): Promise<CoachMessage> {
  try {
    const body: Record<string, unknown> = { messages, context };
    if (opts?.model) body.model = opts.model;

    const { data, error } = await supabase.functions.invoke<RawCoachGemmaResponse>(
      functionName(),
      { body },
    );

    if (error) {
      const errorMessage = error.message || '';
      const isConfigError =
        errorMessage.includes('not configured') ||
        errorMessage.includes('GEMINI_API_KEY') ||
        errorMessage.includes('missing');
      const hasStatus =
        typeof error === 'object' && error !== null && 'status' in error;
      const isNotFound =
        (hasStatus && (error as { status: unknown }).status === 404) ||
        errorMessage.includes('404');

      if (isNotFound) {
        throw createError(
          'validation',
          'COACH_GEMMA_NOT_DEPLOYED',
          'Gemma coach service is not available. Please contact support.',
          { details: error, retryable: false },
        );
      }

      if (isConfigError) {
        throw createError(
          'validation',
          'COACH_GEMMA_NOT_CONFIGURED',
          'Gemma coach is not configured. Please contact support.',
          { details: error, retryable: false },
        );
      }

      throw createError(
        'network',
        'COACH_GEMMA_INVOKE_FAILED',
        error.message || 'Gemma coach request failed',
        { details: error, retryable: true },
      );
    }

    if (data?.error) {
      const isConfigError =
        data.error.includes('not configured') ||
        data.error.includes('GEMINI_API_KEY');
      throw createError(
        isConfigError ? 'validation' : 'network',
        isConfigError ? 'COACH_GEMMA_NOT_CONFIGURED' : 'COACH_GEMMA_ERROR',
        data.error,
        { retryable: !isConfigError },
      );
    }

    const responseText =
      data?.message?.trim() || data?.content?.trim() || data?.reply?.trim();

    if (!responseText) {
      throw createError(
        'validation',
        'COACH_GEMMA_EMPTY_RESPONSE',
        'Gemma coach did not return a reply',
      );
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
      'COACH_GEMMA_REQUEST_FAILED',
      'Unable to reach the Gemma coach service',
      { details: err, retryable: true },
    );
  }
}
