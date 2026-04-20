// Unit tests for the Gemini SSE -> NDJSON adapter shipped in
// supabase/functions/coach-gemma/streaming.ts.
//
// We only exercise the framework-agnostic helpers (parseGeminiSseStream,
// parseSseFrame, ndjsonStreamResponse, and a fetch-injected
// streamGeminiResponse). The actual Deno entrypoint lives in PR #457; see
// the TODO(#454) note in the adapter source.

import {
  parseGeminiSseStream,
  parseSseFrame,
  ndjsonStreamResponse,
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

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

async function collect(
  iter: AsyncIterable<GeminiStreamChunk | GeminiStreamFinal>
): Promise<(GeminiStreamChunk | GeminiStreamFinal)[]> {
  const out: (GeminiStreamChunk | GeminiStreamFinal)[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('parseSseFrame', () => {
  it('extracts the delta from a single data frame', () => {
    const frame =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}';
    expect(parseSseFrame(frame)).toEqual({ delta: 'Hello', finishReason: undefined });
  });

  it('joins multiple parts into one delta', () => {
    const frame =
      'data: {"candidates":[{"content":{"parts":[{"text":"a"},{"text":"b"}]}}]}';
    expect(parseSseFrame(frame)?.delta).toBe('ab');
  });

  it('captures finishReason on the final frame', () => {
    const frame =
      'data: {"candidates":[{"content":{"parts":[{"text":"."}]},"finishReason":"STOP"}]}';
    expect(parseSseFrame(frame)).toEqual({ delta: '.', finishReason: 'STOP' });
  });

  it('returns null for SSE comments and [DONE] sentinels', () => {
    expect(parseSseFrame(': keepalive')).toBeNull();
    expect(parseSseFrame('data: [DONE]')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseSseFrame('data: {not json')).toBeNull();
  });
});

describe('parseGeminiSseStream', () => {
  it('parses chunks delivered all at once and emits a final done sentinel', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"world"}]},"finishReason":"STOP"}]}\n\n',
    ].join('');
    const result = await collect(parseGeminiSseStream(streamFromString(sse)));

    expect(result).toEqual([
      { delta: 'Hel' },
      { delta: 'lo ' },
      { delta: 'world' },
      { done: true, finishReason: 'STOP' },
    ]);
  });

  it('handles SSE frames split across read boundaries', async () => {
    // The frame separator (\n\n) lands in the middle of a network read.
    const stream = streamFromChunks([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n',
      '\ndata: {"candidates":[{"content":{"parts":[{"text":"!"}]},"finishReason":"STOP"}]}\n\n',
    ]);
    const result = await collect(parseGeminiSseStream(stream));

    expect(result).toEqual([
      { delta: 'Hi' },
      { delta: '!' },
      { done: true, finishReason: 'STOP' },
    ]);
  });

  it('flushes a trailing frame that lacks the terminating \\n\\n', async () => {
    const stream = streamFromString(
      'data: {"candidates":[{"content":{"parts":[{"text":"trailing"}]},"finishReason":"STOP"}]}'
    );
    const result = await collect(parseGeminiSseStream(stream));

    expect(result).toEqual([{ delta: 'trailing' }, { done: true, finishReason: 'STOP' }]);
  });

  it('emits a final done sentinel even when no candidate frames arrive', async () => {
    const result = await collect(parseGeminiSseStream(streamFromString(': keepalive\n\n')));
    expect(result).toEqual([{ done: true, finishReason: undefined }]);
  });
});

describe('ndjsonStreamResponse', () => {
  async function readAll(res: Response): Promise<string> {
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

  it('wraps an async iterator into a text/event-stream response with NDJSON body', async () => {
    async function* iter(): AsyncGenerator<GeminiStreamChunk | GeminiStreamFinal> {
      yield { delta: 'a' };
      yield { delta: 'b' };
      yield { done: true, finishReason: 'STOP' };
    }

    const res = ndjsonStreamResponse(iter());
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.status).toBe(200);

    const body = await readAll(res);
    const lines = body.split('\n').filter(Boolean);
    expect(lines).toEqual([
      JSON.stringify({ delta: 'a' }),
      JSON.stringify({ delta: 'b' }),
      JSON.stringify({ done: true, finishReason: 'STOP' }),
    ]);
  });

  it('emits a {done:true,error} sentinel when the source iterator throws', async () => {
    async function* iter(): AsyncGenerator<GeminiStreamChunk | GeminiStreamFinal> {
      yield { delta: 'partial' };
      throw new Error('upstream blew up');
    }

    const res = ndjsonStreamResponse(iter());
    const body = await readAll(res);
    const lines = body.split('\n').filter(Boolean);
    expect(JSON.parse(lines[0])).toEqual({ delta: 'partial' });
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.done).toBe(true);
    expect(last.error).toMatch(/upstream/);
  });
});

describe('streamGeminiResponse (fetch injection)', () => {
  it('hits :streamGenerateContent with alt=sse and yields parsed deltas', async () => {
    const fakeFetch: typeof fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toContain('/v1beta/models/');
      expect(url).toContain(':streamGenerateContent');
      expect(url).toContain('alt=sse');
      expect(url).toContain('key=testkey');

      const body =
        'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]},"finishReason":"STOP"}]}\n\n';
      return new Response(streamFromString(body), { status: 200 });
    });

    const out = await collect(
      streamGeminiResponse(
        [{ role: 'user', parts: [{ text: 'plan' }] }],
        { apiKey: 'testkey', fetchImpl: fakeFetch }
      )
    );

    expect(out).toEqual([{ delta: 'hi' }, { done: true, finishReason: 'STOP' }]);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('throws an error with status when the upstream is non-2xx', async () => {
    const fakeFetch: typeof fetch = jest.fn(async () => new Response('quota', { status: 429 }));

    await expect(
      collect(
        streamGeminiResponse(
          [{ role: 'user', parts: [{ text: 'plan' }] }],
          { apiKey: 'k', fetchImpl: fakeFetch }
        )
      )
    ).rejects.toMatchObject({ message: expect.stringMatching(/429/), status: 429 });
  });
});
