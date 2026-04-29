/**
 * Wave 30 C6 — coach-gemma streaming adapter edge-case coverage.
 *
 * Complements `tests/unit/services/coach-streaming-adapter.test.ts`
 * (happy-path parsing + basic 429) with error-propagation and
 * cancellation coverage that hardens the Supabase edge function's
 * streaming layer.
 *
 * Covers:
 *   - streamGeminiResponse with upstream 429 (rate limit) → labeled error
 *   - streamGeminiResponse with upstream 500 (server error) → labeled error
 *   - parseGeminiSseStream skips a truncated SSE frame and continues
 *     emitting deltas from subsequent well-formed frames
 *   - parseGeminiSseStream tolerates a malformed JSON payload in the
 *     middle of a stream without aborting the generator
 *   - ndjsonStreamResponse emits a terminal error sentinel when the
 *     source generator throws after yielding one chunk
 *   - streamGeminiResponse propagates an AbortSignal into the
 *     underlying fetch call so cancellation actually reaches the wire.
 */

import {
  ndjsonStreamResponse,
  parseGeminiSseStream,
  streamGeminiResponse,
  type GeminiStreamChunk,
  type GeminiStreamFinal,
} from '@/supabase/functions/coach-gemma/streaming';

function streamFromString(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collect(
  iter: AsyncIterable<GeminiStreamChunk | GeminiStreamFinal>,
): Promise<(GeminiStreamChunk | GeminiStreamFinal)[]> {
  const out: (GeminiStreamChunk | GeminiStreamFinal)[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe('streamGeminiResponse — upstream error propagation (wave-30 C6)', () => {
  test('upstream HTTP 429 produces an error labeled with status 429', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () => new Response('quota', { status: 429, statusText: 'Too Many Requests' }),
    );

    await expect(
      collect(
        streamGeminiResponse(
          [{ role: 'user', parts: [{ text: 'plan' }] }],
          { apiKey: 'k', fetchImpl: fakeFetch },
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/429/),
      status: 429,
    });
  });

  test('upstream HTTP 500 produces an error labeled with status 500', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () =>
        new Response('internal', {
          status: 500,
          statusText: 'Internal Server Error',
        }),
    );

    await expect(
      collect(
        streamGeminiResponse(
          [{ role: 'user', parts: [{ text: 'plan' }] }],
          { apiKey: 'k', fetchImpl: fakeFetch },
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/500/),
      status: 500,
    });
  });
});

describe('parseGeminiSseStream — malformed frame tolerance (wave-30 C6)', () => {
  test('truncated SSE frame is skipped, downstream valid frames still emit', async () => {
    // Frame 1 is missing a `}` bracket on the JSON payload and should be
    // dropped by parseSseFrame's `try { JSON.parse } catch` path.
    // Frame 2 is well-formed and must still be emitted.
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"lost"\n\n', // truncated JSON
      'data: {"candidates":[{"content":{"parts":[{"text":"kept"}]},"finishReason":"STOP"}]}\n\n',
    ].join('');

    const result = await collect(parseGeminiSseStream(streamFromString(sse)));
    const deltas = result.filter((c): c is GeminiStreamChunk => 'delta' in c && !('done' in c));
    expect(deltas.map((d) => d.delta)).toEqual(['kept']);
    // A terminal `done` sentinel must still arrive so downstream
    // NDJSON consumers can close their iterators cleanly.
    expect(result[result.length - 1]).toEqual({
      done: true,
      finishReason: 'STOP',
    });
  });

  test('malformed JSON payload mid-stream is dropped without aborting the generator', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\n',
      'data: this is not json at all\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"b"}]},"finishReason":"STOP"}]}\n\n',
    ].join('');

    const result = await collect(parseGeminiSseStream(streamFromString(sse)));
    const deltas = result.filter(
      (c): c is GeminiStreamChunk => 'delta' in c && !('done' in c),
    );
    // Middle frame was malformed JSON — the generator must continue
    // past it rather than bubble the parse error.
    expect(deltas.map((d) => d.delta)).toEqual(['a', 'b']);
  });
});

describe('ndjsonStreamResponse — terminal error sentinel (wave-30 C6)', () => {
  test('generator throw after a partial chunk emits a final {done:true,error} line instead of swallowing', async () => {
    async function* iter(): AsyncGenerator<GeminiStreamChunk | GeminiStreamFinal> {
      yield { delta: 'first' };
      throw new Error('controller exploded');
    }

    const res = ndjsonStreamResponse(iter());
    const body = await readBody(res);
    const lines = body.split('\n').filter(Boolean);

    // Partial chunk arrived before the throw.
    expect(JSON.parse(lines[0])).toEqual({ delta: 'first' });
    // Terminal sentinel includes an error field — the adapter must NOT
    // swallow the thrown error silently; clients rely on it to tell
    // partial output apart from a clean stop.
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.done).toBe(true);
    expect(last.error).toMatch(/controller exploded/);
  });
});

describe('streamGeminiResponse — abort propagation (wave-30 C6)', () => {
  test('passes the caller AbortSignal straight through to the underlying fetch call', async () => {
    const controller = new AbortController();
    const seenSignals: (AbortSignal | undefined)[] = [];

    const fakeFetch: typeof fetch = jest.fn(async (_input, init?: RequestInit) => {
      seenSignals.push(init?.signal ?? undefined);
      const body =
        'data: {"candidates":[{"content":{"parts":[{"text":"go"}]},"finishReason":"STOP"}]}\n\n';
      return new Response(streamFromString(body), { status: 200 });
    });

    await collect(
      streamGeminiResponse(
        [{ role: 'user', parts: [{ text: 'plan' }] }],
        { apiKey: 'k', fetchImpl: fakeFetch, signal: controller.signal },
      ),
    );

    expect(seenSignals).toHaveLength(1);
    // Identity check — the exact signal instance must travel through
    // untouched so callers can abort() from the outside.
    expect(seenSignals[0]).toBe(controller.signal);
  });
});
