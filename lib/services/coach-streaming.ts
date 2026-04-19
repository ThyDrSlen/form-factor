// Client-side streaming for the coach edge function (issue #465).
//
// The coach-gemma edge function under `?stream=1` returns NDJSON chunks
// shaped as `{"delta":"..."}\n` followed by a final `{"done":true,...}\n`.
// We POST + read the response body manually because EventSource is not
// available in React Native and Supabase's `functions.invoke()` buffers the
// whole response.

import { supabase } from '@/lib/supabase';
import { createError } from './ErrorHandler';
import { sendCoachGemmaPrompt } from './coach-gemma-service';
import type { CoachContext, CoachMessage } from './coach-service';
import type { CoachProvider } from './coach-provider-types';

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
  /**
   * Test-only injection: override the non-streaming Gemma fallback producer.
   * When the coach-gemma edge function doesn't yet support SSE we route
   * `provider: 'gemma'` through a synchronous sendCoachGemmaPrompt and emit
   * the full buffer as a single chunk (see `streamCoachPrompt`). Injecting
   * here lets tests exercise the fallback without hitting supabase.
   */
  gemmaFallbackImpl?: (
    messages: CoachMessage[],
    context?: CoachContext,
  ) => Promise<CoachMessage>;
  /**
   * Force the streaming-over-HTTP path even for `provider: 'gemma'`. Exposed
   * so tests can exercise the existing NDJSON reader with a fake fetch; real
   * callers never set this. Remove once the coach-gemma edge function lands
   * server-side SSE (tracked as wave-27 streaming path follow-up).
   */
  forceServerStream?: boolean;
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
  /**
   * Provider that generated the stream. Optional — set when the stream
   * source can be attributed (e.g. Gemma non-streaming fallback returns
   * `'gemma-cloud'`, SSE frames with a `provider` tail-frame). Absent for
   * older NDJSON sources that don't emit provider info (#538).
   */
  provider?: CoachProvider;
  /**
   * Model identifier from the upstream source, if available. Absent when
   * the upstream doesn't surface a model name (#538).
   */
  model?: string;
}

interface StreamFrame {
  delta?: string;
  done?: boolean;
  finishReason?: string;
  error?: string;
  /** Optional provider annotation emitted by the upstream server. */
  provider?: CoachProvider | string;
  /** Optional model annotation emitted by the upstream server. */
  model?: string;
}

const DEFAULT_FUNCTION_NAME = (
  process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION || 'coach-gemma'
).trim();

/**
 * Stream the coach reply, invoking `onChunk(delta)` for every text fragment.
 * Resolves with summary stats once the stream closes; rejects on transport
 * errors or `?stream=1` HTTP non-2xx responses.
 *
 * Provider routing:
 *   - `provider: 'gemma'` → route to the non-streaming Gemma service
 *     (sendCoachGemmaPrompt) and deliver the resolved text as one chunk to
 *     satisfy the streaming API contract. The coach-gemma edge function
 *     does not yet implement server-side SSE (see
 *     `supabase/functions/coach-gemma/streaming.ts` — infrastructure exists
 *     but is not wired into `index.ts`'s dispatch). Follow-up: wave-27
 *     streaming path.
 *   - otherwise → POST to the coach-gemma edge function with `?stream=1`
 *     and parse NDJSON frames (existing behavior).
 *
 * `forceServerStream` bypasses the fallback for tests.
 */
export async function streamCoachPrompt(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  onChunk: (delta: string) => void,
  opts?: StreamCoachOptions
): Promise<StreamCoachResult> {
  // Gemma fallback: coach-gemma/index.ts has no `?stream=1` dispatch today,
  // so invoking the streaming endpoint with provider=gemma would either 404
  // or fall through to the synchronous JSON response (not NDJSON), which the
  // NDJSON reader below cannot consume. Route through the canonical Gemma
  // service instead and fulfill the streaming contract by emitting one chunk.
  if (opts?.provider === 'gemma' && !opts?.forceServerStream) {
    return streamGemmaViaNonStreamingFallback(messages, context, onChunk, opts);
  }

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
  // Provider / model annotations are optional (#538). We collect them
  // from any frame that emits them (the HTTP path's SSE producer or
  // Gemma's NDJSON tail frame). Fall back to the hint passed by the
  // caller (opts.provider) if the server never tells us — better than
  // leaving it undefined in the common case.
  let streamProvider: CoachProvider | undefined;
  let streamModel: string | undefined;

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
    // Tail-frame annotations: a frame can carry provider/model either
    // inline with a delta or on the `{done:true}` frame. Merge either.
    if (typeof frame.provider === 'string' && frame.provider.trim()) {
      streamProvider = frame.provider as CoachProvider;
    }
    if (typeof frame.model === 'string' && frame.model.trim()) {
      streamModel = frame.model.trim();
    }
    if (frame.done) {
      finishReason = frame.finishReason;
      break;
    }
  }

  // If the server did not emit a provider tail-frame, fall back to the
  // caller's hint so the result is still attributable. When the hint is
  // 'gemma' we upgrade it to the fully-qualified 'gemma-cloud' provider
  // value so downstream UI / telemetry uses the same enum everywhere.
  if (!streamProvider && opts?.provider) {
    streamProvider = opts.provider === 'gemma' ? 'gemma-cloud' : 'openai';
  }

  return {
    text,
    chunkCount,
    ttftMs,
    durationMs: Date.now() - startedAt,
    finishReason,
    provider: streamProvider,
    model: streamModel,
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

/**
 * Route `provider: 'gemma'` streaming requests through the non-streaming
 * Gemma service and synthesize a single chunk from the full response buffer.
 *
 * WHY: the coach-gemma edge function has not yet wired its SSE streaming
 * adapter (`streaming.ts`) into `index.ts`'s dispatch. Streaming
 * infrastructure exists on the Deno side but there is no `?stream=1`
 * handler, so attempting to stream from it returns the synchronous JSON
 * response body which this module's NDJSON reader cannot parse. This
 * preserves the streaming API contract (single onChunk call + shaped
 * result object) until server-side SSE lands.
 *
 * Follow-up: wave-27 streaming path — once `coach-gemma/index.ts` accepts
 * `?stream=1` and returns NDJSON, drop this branch and let the normal HTTP
 * path handle `provider: 'gemma'`.
 */
async function streamGemmaViaNonStreamingFallback(
  messages: CoachMessage[],
  context: CoachContext | undefined,
  onChunk: (delta: string) => void,
  opts?: StreamCoachOptions
): Promise<StreamCoachResult> {
  const startedAt = Date.now();
  const fallback = opts?.gemmaFallbackImpl ?? sendCoachGemmaPrompt;

  // Cooperate with caller-provided AbortSignal: if already aborted, bail
  // without hitting the network.
  if (opts?.signal?.aborted) {
    throw createError('network', 'COACH_STREAM_ABORTED', 'Coach stream aborted', {
      retryable: false,
    });
  }

  let reply: CoachMessage;
  try {
    reply = await fallback(messages, context);
  } catch (err) {
    // Preserve domain-shaped errors from sendCoachGemmaPrompt untouched so
    // callers can switch on `COACH_GEMMA_*` codes just like the sync path.
    if (err && typeof err === 'object' && 'domain' in err) {
      throw err;
    }
    throw createError(
      'network',
      'COACH_STREAM_FAILED',
      'Failed to open coach stream',
      { details: err, retryable: true }
    );
  }

  const text = (reply.content ?? '').trim();
  const now = Date.now();
  const ttftMs = now - startedAt;

  if (text.length > 0) {
    onChunk(text);
  }

  // Provider/model propagation (#538). sendCoachGemmaPrompt annotates the
  // reply with `provider: 'gemma-cloud'` and optionally `model` as
  // non-enumerable properties — read them here so the streaming result
  // carries attribution consistent with the non-streaming path.
  const replyProvider = (reply as CoachMessage & { provider?: CoachProvider }).provider;
  const replyModel = (reply as CoachMessage & { model?: string }).model;

  return {
    text,
    chunkCount: text.length > 0 ? 1 : 0,
    ttftMs,
    durationMs: Date.now() - startedAt,
    provider: replyProvider ?? 'gemma-cloud',
    model: replyModel,
  };
}
