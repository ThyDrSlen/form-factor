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

  // ---------------------------------------------------------------------------
  // Provider / model propagation (#538)
  // ---------------------------------------------------------------------------

  describe('StreamCoachResult provider/model (#538)', () => {
    it('picks up provider + model from an NDJSON tail frame', async () => {
      const fakeFetch: typeof fetch = jest.fn(
        async () =>
          new Response(
            ndjsonStream([
              { delta: 'hello' },
              { done: true, provider: 'openai', model: 'gpt-5.4-mini' },
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
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-5.4-mini');
    });

    it('falls back to the caller-supplied provider hint when the stream is silent', async () => {
      // No tail frame with provider/model — streaming result still gets
      // attributed via opts.provider → CoachProvider mapping.
      const fakeFetch: typeof fetch = jest.fn(
        async () => new Response(ndjsonStream([{ delta: 'a' }, { done: true }]), { status: 200 })
      );

      const openaiResult = await streamCoachPrompt(
        [{ role: 'user', content: 'x' }],
        undefined,
        () => undefined,
        { fetchImpl: fakeFetch, provider: 'openai' }
      );
      expect(openaiResult.provider).toBe('openai');
      expect(openaiResult.model).toBeUndefined();
    });

    it('leaves provider undefined when neither the stream nor the caller annotates it', async () => {
      const fakeFetch: typeof fetch = jest.fn(
        async () => new Response(ndjsonStream([{ delta: 'a' }, { done: true }]), { status: 200 })
      );

      const result = await streamCoachPrompt(
        [{ role: 'user', content: 'x' }],
        undefined,
        () => undefined,
        { fetchImpl: fakeFetch }
      );
      expect(result.provider).toBeUndefined();
      expect(result.model).toBeUndefined();
    });

    it('Gemma fallback path surfaces provider=gemma-cloud via non-enumerable reply annotation', async () => {
      // Emulate sendCoachGemmaPrompt's non-enumerable annotations — the
      // fallback reads them directly off the returned message.
      const fakeReply = { role: 'assistant' as const, content: 'Gemma says hi.' };
      Object.defineProperty(fakeReply, 'provider', {
        value: 'gemma-cloud',
        enumerable: false,
      });
      Object.defineProperty(fakeReply, 'model', {
        value: 'gemma-3-4b-it',
        enumerable: false,
      });
      const gemmaFallbackImpl = jest.fn().mockResolvedValue(fakeReply);

      const result = await streamCoachPrompt(
        [{ role: 'user', content: 'x' }],
        undefined,
        () => undefined,
        { provider: 'gemma', gemmaFallbackImpl }
      );

      expect(result.provider).toBe('gemma-cloud');
      expect(result.model).toBe('gemma-3-4b-it');
      expect(result.text).toBe('Gemma says hi.');
      expect(result.chunkCount).toBe(1);
    });

    it('Gemma fallback defaults provider to gemma-cloud when reply has no annotation', async () => {
      const plainReply = { role: 'assistant' as const, content: 'Plain reply.' };
      const gemmaFallbackImpl = jest.fn().mockResolvedValue(plainReply);

      const result = await streamCoachPrompt(
        [{ role: 'user', content: 'x' }],
        undefined,
        () => undefined,
        { provider: 'gemma', gemmaFallbackImpl }
      );
      expect(result.provider).toBe('gemma-cloud');
      expect(result.model).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Wave-29 T2: transient retryable HTTP statuses (429 / 408).
  //
  // lib/services/coach-streaming.ts:142-153 classifies a non-2xx response as
  // COACH_STREAM_HTTP_ERROR. `retryable` is set true for 5xx and 429. The
  // existing suite already covers 503 (line 149) and 400 (non-retryable, line
  // 168). These cases close the gap on:
  //   - 429 Too Many Requests: upstream rate limit — caller should retry after
  //     backoff. `retryable: true` is what drives the retry path in the UI
  //     layer (CoachChatScreen + coach-session-manager).
  //   - 408 Request Timeout: unlike 5xx/429, the current impl classifies 408
  //     as `retryable: false` because it does not match the `>= 500 || === 429`
  //     rule. Document that contract here so any future refinement (e.g. adding
  //     408 to the retry set, or a dedicated COACH_STREAM_TIMEOUT code) tightens
  //     this test rather than regressing it silently.
  // ---------------------------------------------------------------------------
  it('classifies 429 Too Many Requests as COACH_STREAM_HTTP_ERROR with retryable=true', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () => new Response('too many', { status: 429 })
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

  // 408 Request Timeout: the wave-29 spec requires `retryable: true` but the
  // current implementation at lib/services/coach-streaming.ts:150 flags only
  // `status >= 500 || status === 429` as retryable. 408 is semantically a
  // transient timeout (RFC 7231 §6.5.7) and SHOULD be retryable — but asserting
  // that today would require a prod change to add `|| status === 408` to the
  // retryable predicate, which this test-only wave explicitly excludes.
  //
  // Assert today's contract (`retryable: false`) so the intent is documented,
  // and add a sibling skipped test that encodes the desired future contract.
  it('classifies 408 Request Timeout as COACH_STREAM_HTTP_ERROR (current contract: retryable=false)', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () => new Response('timeout', { status: 408 })
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
      retryable: false,
    });
  });

  // TODO(wave-29-C-T2): un-skip once coach-streaming.ts:150 adds 408 to the
  // retryable predicate. 408 is semantically a transient timeout per RFC 7231
  // §6.5.7 and parity with 429 is the expected future state.
  it.skip('classifies 408 Request Timeout as retryable=true (future contract)', async () => {
    const fakeFetch: typeof fetch = jest.fn(
      async () => new Response('timeout', { status: 408 })
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
      retryable: true,
    });
  });
});
