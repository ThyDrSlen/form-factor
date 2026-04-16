// Client-side streaming for the coach edge function (issue #465).
//
// The coach-gemma edge function under `?stream=1` returns NDJSON chunks
// shaped as `{"delta":"..."}\n` followed by a final `{"done":true,...}\n`.
// We POST + read the response body manually because EventSource is not
// available in React Native and Supabase's `functions.invoke()` buffers the
// whole response.

import { supabase } from '@/lib/supabase';
import { createError } from './ErrorHandler';
import type { CoachContext, CoachMessage } from './coach-service';

export interface StreamCoachOptions {
  /** Provider hint forwarded as `?provider=` (gemma|openai). */
  provider?: 'gemma' | 'openai';
  /** Override the function name; defaults to env / 'coach-gemma'. */
  functionName?: string;
  /** Cancel mid-stream. */
  signal?: AbortSignal;
  /** Inject fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override the Supabase functions base URL (defaults to `${SUPABASE_URL}/functions/v1`). */
  baseUrlOverride?: string;
}

export interface StreamCoachResult {
  /** Full assistant text after the stream completes. */
  text: string;
  /** Number of chunks observed (for telemetry). */
  chunkCount: number;
  /** Time-to-first-token in ms. */
  ttftMs: number;
  /** Total wall-clock duration in ms. */
  durationMs: number;
  /** finishReason from the upstream provider, when present. */
  finishReason?: string;
}

interface StreamFrame {
  delta?: string;
  done?: boolean;
  finishReason?: string;
  error?: string;
}

const DEFAULT_FUNCTION_NAME = (
  process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION || 'coach-gemma'
).trim();

/**
 * Stream the coach reply, invoking `onChunk(delta)` for every text fragment.
 * Resolves with summary stats once the stream closes; rejects on transport
 * errors or `?stream=1` HTTP non-2xx responses.
 */
export async function streamCoachPrompt(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  onChunk: (delta: string) => void,
  opts?: StreamCoachOptions
): Promise<StreamCoachResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const functionName = opts?.functionName ?? DEFAULT_FUNCTION_NAME;
  const baseUrl = opts?.baseUrlOverride ?? resolveFunctionsBaseUrl();
  const url = new URL(`${baseUrl}/${functionName}`);
  url.searchParams.set('stream', '1');
  if (opts?.provider) url.searchParams.set('provider', opts.provider);

  const session = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const token = session?.data?.session?.access_token;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, context }),
      signal: opts?.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw createError('network', 'COACH_STREAM_ABORTED', 'Coach stream aborted', {
        details: err,
        retryable: false,
      });
    }
    throw createError(
      'network',
      'COACH_STREAM_FAILED',
      'Failed to open coach stream',
      { details: err, retryable: true }
    );
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw createError(
      'network',
      'COACH_STREAM_HTTP_ERROR',
      `Coach stream returned ${response.status}`,
      {
        details: { status: response.status, body: text },
        retryable: response.status >= 500 || response.status === 429,
      }
    );
  }

  let chunkCount = 0;
  let ttftMs = 0;
  let text = '';
  let finishReason: string | undefined;

  for await (const frame of readNdjsonFrames(response.body)) {
    if (frame.error) {
      throw createError(
        'network',
        'COACH_STREAM_UPSTREAM_ERROR',
        frame.error,
        { retryable: true }
      );
    }
    if (typeof frame.delta === 'string' && frame.delta.length > 0) {
      if (chunkCount === 0) ttftMs = Date.now() - startedAt;
      chunkCount += 1;
      text += frame.delta;
      onChunk(frame.delta);
    }
    if (frame.done) {
      finishReason = frame.finishReason;
      break;
    }
  }

  return {
    text,
    chunkCount,
    ttftMs,
    durationMs: Date.now() - startedAt,
    finishReason,
  };
}

function resolveFunctionsBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  if (!url) {
    throw createError(
      'validation',
      'COACH_STREAM_NO_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_URL is not set'
    );
  }
  return `${url.replace(/\/$/, '')}/functions/v1`;
}

/** Read NDJSON frames from a byte stream. Exported for tests. */
export async function* readNdjsonFrames(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamFrame, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        const parsed = safeParseFrame(line);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      const parsed = safeParseFrame(tail);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function safeParseFrame(line: string): StreamFrame | null {
  try {
    return JSON.parse(line) as StreamFrame;
  } catch {
    return null;
  }
}
