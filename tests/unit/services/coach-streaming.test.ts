// Unit tests for lib/services/coach-streaming.ts (issue #465 Item 1).
//
// We override the global supabase mock from tests/setup.ts by mutating the
// shared `__mockSupabaseAuth` registry; that pattern lets us preserve the
// hoisted jest.mock factory that the rest of the codebase depends on.

import {
  streamCoachPrompt,
  readNdjsonFrames,
} from '@/lib/services/coach-streaming';

const mockGetSession = jest.fn();
beforeAll(() => {
  // Replace the auth.getSession that tests/setup.ts installed so we can
  // assert auth-token plumbing without depending on the global mock's quirks.
  (global as unknown as { __mockSupabaseAuth: { getSession: typeof mockGetSession } })
    .__mockSupabaseAuth.getSession = mockGetSession;
});

const ORIGINAL_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
});

afterAll(() => {
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
});

function ndjsonStream(frames: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = frames.map((f) => JSON.stringify(f) + '\n').join('');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
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

describe('readNdjsonFrames', () => {
  it('parses one frame per newline-terminated JSON line', async () => {
    const stream = ndjsonStream([{ delta: 'a' }, { delta: 'b' }, { done: true }]);
    const out: object[] = [];
    for await (const f of readNdjsonFrames(stream)) out.push(f);
    expect(out).toEqual([{ delta: 'a' }, { delta: 'b' }, { done: true }]);
  });

  it('handles JSON spanning multiple network reads', async () => {
    const stream = chunkedStream([
      '{"delta":"hel',
      'lo"}\n{"delt',
      'a":"!"}\n{"done":true}\n',
    ]);
    const out: object[] = [];
    for await (const f of readNdjsonFrames(stream)) out.push(f);
    expect(out).toEqual([{ delta: 'hello' }, { delta: '!' }, { done: true }]);
  });

  it('flushes a trailing line without newline', async () => {
    const stream = chunkedStream(['{"delta":"x"}\n{"done":true}']);
    const out: object[] = [];
    for await (const f of readNdjsonFrames(stream)) out.push(f);
    expect(out).toEqual([{ delta: 'x' }, { done: true }]);
  });

  it('skips invalid JSON lines without throwing', async () => {
    const stream = chunkedStream(['oops not json\n{"delta":"ok"}\n{"done":true}\n']);
    const out: object[] = [];
    for await (const f of readNdjsonFrames(stream)) out.push(f);
    expect(out).toEqual([{ delta: 'ok' }, { done: true }]);
  });
});

describe('streamCoachPrompt', () => {
  it('POSTs to coach-gemma?stream=1 with auth header and surfaces deltas in order', async () => {
    const fakeFetch: typeof fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      expect(u).toContain('/functions/v1/coach-gemma');
      expect(u).toContain('stream=1');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok');
      expect(headers.Accept).toBe('text/event-stream');
      const parsed = JSON.parse(init?.body as string);
      expect(parsed.messages[0].content).toBe('hi');
      return new Response(
        ndjsonStream([
          { delta: 'one ' },
          { delta: 'two' },
          { done: true, finishReason: 'STOP' },
        ]),
        { status: 200 }
      );
    });

    const chunks: string[] = [];
    const result = await streamCoachPrompt(
      [{ role: 'user', content: 'hi' }],
      undefined,
      (delta) => chunks.push(delta),
      { fetchImpl: fakeFetch }
    );

    expect(chunks).toEqual(['one ', 'two']);
    expect(result.text).toBe('one two');
    expect(result.chunkCount).toBe(2);
    expect(result.finishReason).toBe('STOP');
    expect(result.ttftMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(result.ttftMs);
  });

  it('appends provider hint when opts.provider is set', async () => {
    const fakeFetch: typeof fetch = jest.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      expect(u).toContain('provider=openai');
      return new Response(ndjsonStream([{ done: true }]), { status: 200 });
    });

    await streamCoachPrompt(
      [{ role: 'user', content: 'x' }],
      undefined,
      () => undefined,
      { fetchImpl: fakeFetch, provider: 'openai' }
    );
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('classifies a non-2xx response as COACH_STREAM_HTTP_ERROR with retryable on 5xx/429', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () => new Response('boom', { status: 503 })
    );

    await expect(
      streamCoachPrompt(
        [{ role: 'user', content: 'x' }],
        undefined,
        () => undefined,
        { fetchImpl: fakeFetch }
      )
    ).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_STREAM_HTTP_ERROR',
      retryable: true,
    });
  });

  it('classifies a 400 as COACH_STREAM_HTTP_ERROR with retryable=false', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () => new Response('bad', { status: 400 })
    );

    await expect(
      streamCoachPrompt(
        [{ role: 'user', content: 'x' }],
        undefined,
        () => undefined,
        { fetchImpl: fakeFetch }
      )
    ).rejects.toMatchObject({
      code: 'COACH_STREAM_HTTP_ERROR',
      retryable: false,
    });
  });

  it('surfaces an upstream {error} frame as COACH_STREAM_UPSTREAM_ERROR', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () =>
        new Response(ndjsonStream([{ delta: 'partial' }, { error: 'rate-limited' }]), {
          status: 200,
        })
    );

    await expect(
      streamCoachPrompt(
        [{ role: 'user', content: 'x' }],
        undefined,
        () => undefined,
        { fetchImpl: fakeFetch }
      )
    ).rejects.toMatchObject({ code: 'COACH_STREAM_UPSTREAM_ERROR' });
  });

  it('classifies AbortError as COACH_STREAM_ABORTED with retryable=false', async () => {
    const fakeFetch: typeof fetch = jest.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });

    await expect(
      streamCoachPrompt(
        [{ role: 'user', content: 'x' }],
        undefined,
        () => undefined,
        { fetchImpl: fakeFetch }
      )
    ).rejects.toMatchObject({
      code: 'COACH_STREAM_ABORTED',
      retryable: false,
    });
  });

  it('still works when there is no Supabase session (no Authorization header)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const fakeFetch: typeof fetch = jest.fn(async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      return new Response(ndjsonStream([{ done: true }]), { status: 200 });
    });

    await streamCoachPrompt(
      [{ role: 'user', content: 'x' }],
      undefined,
      () => undefined,
      { fetchImpl: fakeFetch }
    );
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces provider + model from upstream frames on the streaming path', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () =>
        new Response(
          ndjsonStream([
            { delta: 'hi', provider: 'gemma-cloud', model: 'gemma-3-4b-it' },
            { done: true, finishReason: 'STOP' },
          ]),
          { status: 200 }
        )
    );

    const result = await streamCoachPrompt(
      [{ role: 'user', content: 'x' }],
      undefined,
      () => undefined,
      { fetchImpl: fakeFetch }
    );

    expect(result.provider).toBe('gemma-cloud');
    expect(result.model).toBe('gemma-3-4b-it');
  });

  it('falls back to opts.provider when upstream frames omit provider metadata', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () =>
        new Response(
          ndjsonStream([{ delta: 'x' }, { done: true }]),
          { status: 200 }
        )
    );

    const result = await streamCoachPrompt(
      [{ role: 'user', content: 'x' }],
      undefined,
      () => undefined,
      { fetchImpl: fakeFetch, provider: 'openai' }
    );

    expect(result.provider).toBe('openai');
    expect(result.model).toBeUndefined();
  });

  it('surfaces provider + model from the non-streaming Gemma fallback reply', async () => {
    const reply = { role: 'assistant' as const, content: 'fallback text' };
    Object.defineProperty(reply, 'provider', { value: 'gemma-cloud', enumerable: false });
    Object.defineProperty(reply, 'model', { value: 'gemma-3-4b-it', enumerable: false });

    const result = await streamCoachPrompt(
      [{ role: 'user', content: 'x' }],
      undefined,
      () => undefined,
      {
        provider: 'gemma',
        // Cast: the fallback returns a CoachMessage with optional provider/model
        // annotations — constructing it inline is fine for the assertion path.
        gemmaFallbackImpl: async () => reply as unknown as import('@/lib/services/coach-service').CoachMessage,
      }
    );

    expect(result.text).toBe('fallback text');
    expect(result.provider).toBe('gemma-cloud');
    expect(result.model).toBe('gemma-3-4b-it');
  });
});
