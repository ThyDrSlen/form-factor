// Streaming adapter for Gemini Generative Language API.
//
// Reads the SSE-style chunks from `:streamGenerateContent` and translates them
// into newline-delimited JSON chunks (`{"delta":"..."}\n` followed by a final
// `{"done":true,"finishReason":"..."}\n`) which the Supabase edge function can
// stream straight back to the client over a `text/event-stream`-compatible
// response.
//
// Design notes:
// - Gemini's stream endpoint emits `data: { ... }\n\n` SSE frames; we re-shape
//   them into NDJSON because EventSource on web is finicky with provider-shaped
//   events and NDJSON is trivial to parse on React Native.
// - All edge-function changes for #465 are gated by `?stream=1`; the synchronous
//   path remains the default. See `index.ts` for the dispatch.
// - TODO(#454): wire the `?stream=1` dispatch in `coach-gemma/index.ts` once
//   PR #457 lands the canonical Gemma edge function. This file ships standalone
//   so the streaming code is reviewable and importable for tests today.

export interface GeminiStreamMessage {
  role: 'user' | 'model' | 'system';
  parts: { text: string }[];
}

export interface GeminiStreamOpts {
  apiKey: string;
  model?: string;
  /** Defaults to `https://generativelanguage.googleapis.com`. Override for tests. */
  baseUrl?: string;
  /** Inject a fetch impl for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Abort the upstream request. */
  signal?: AbortSignal;
  /** Generation config forwarded to Gemini. */
  generationConfig?: Record<string, unknown>;
  /** System instruction forwarded to Gemini. */
  systemInstruction?: { parts: { text: string }[] };
}

export interface GeminiStreamChunk {
  delta: string;
  done?: false;
}

export interface GeminiStreamFinal {
  delta?: string;
  done: true;
  finishReason?: string;
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-1.5-flash-latest';

/**
 * Open a streaming generate-content request and yield NDJSON-shaped chunks.
 * Call `JSON.stringify(chunk) + '\n'` to forward each chunk over an SSE-style
 * Response body.
 */
export async function* streamGeminiResponse(
  messages: GeminiStreamMessage[],
  opts: GeminiStreamOpts
): AsyncGenerator<GeminiStreamChunk | GeminiStreamFinal, void, void> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  // alt=sse asks Gemini for SSE-framed chunks (data: <json>\n\n) which we parse below.
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(opts.apiKey)}`;

  const requestBody: Record<string, unknown> = {
    contents: messages,
  };
  if (opts.generationConfig) requestBody.generationConfig = opts.generationConfig;
  if (opts.systemInstruction) requestBody.systemInstruction = opts.systemInstruction;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: opts.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    const err = new Error(
      `Gemini stream failed (${response.status}): ${text || response.statusText}`
    );
    (err as { status?: number }).status = response.status;
    throw err;
  }

  yield* parseGeminiSseStream(response.body);
}

/**
 * Parse the SSE byte stream from Gemini into delta chunks.
 * Exported for unit tests so we can feed in a synthetic ReadableStream.
 */
export async function* parseGeminiSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<GeminiStreamChunk | GeminiStreamFinal, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIdx: number;
      while ((separatorIdx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);
        const parsed = parseSseFrame(frame);
        if (!parsed) continue;
        if (parsed.finishReason) finishReason = parsed.finishReason;
        if (parsed.delta) yield { delta: parsed.delta };
      }
    }

    // Flush any trailing data (some servers omit the final \n\n).
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const parsed = parseSseFrame(buffer);
      if (parsed) {
        if (parsed.finishReason) finishReason = parsed.finishReason;
        if (parsed.delta) yield { delta: parsed.delta };
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { done: true, finishReason };
}

interface ParsedFrame {
  delta?: string;
  finishReason?: string;
}

/** Parse one SSE frame (one or more `data: ...` lines) into a delta + finishReason. */
export function parseSseFrame(frame: string): ParsedFrame | null {
  const lines = frame.split('\n');
  let payload = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    if (trimmed.startsWith('data:')) {
      payload += trimmed.slice(5).trim();
    }
  }
  if (!payload || payload === '[DONE]') return null;

  try {
    const obj = JSON.parse(payload) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
    };
    const candidate = obj.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const delta = parts.map((p) => p.text ?? '').join('');
    return { delta, finishReason: candidate?.finishReason };
  } catch {
    return null;
  }
}

/**
 * Build a Response that streams NDJSON chunks. Used by the edge function under
 * `?stream=1`; framed as `text/event-stream` so callers can use standard SSE
 * tooling on web (the body is still valid NDJSON).
 */
export function ndjsonStreamResponse(
  source: AsyncIterable<GeminiStreamChunk | GeminiStreamFinal>,
  init?: ResponseInit
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of source) {
          controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(JSON.stringify({ done: true, error: message }) + '\n')
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    ...init,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      ...(init?.headers ?? {}),
    },
  });
}
