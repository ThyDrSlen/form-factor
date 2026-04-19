const mockInvoke = jest.fn();
const mockRecordCoachUsage = jest.fn().mockResolvedValue(undefined);
const mockCreateError = jest.fn(
  (
    domain: string,
    code: string,
    message: string,
    opts?: { details?: unknown; retryable?: boolean; severity?: string },
  ) => ({
    domain,
    code,
    message,
    retryable: opts?.retryable ?? false,
    severity: opts?.severity ?? 'error',
    details: opts?.details,
  }),
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
  },
}));

const mockLogError = jest.fn();

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: mockLogError,
}));

jest.mock('../../../lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: mockLogError,
}));

// Cost-tracker wiring (#537): intercept recordCoachUsage so we can verify
// the Gemma service reports usage and doesn't block on tracker failures.
jest.mock('@/lib/services/coach-cost-tracker', () => ({
  recordCoachUsage: (...args: unknown[]) => mockRecordCoachUsage(...args),
}));

let sendCoachGemmaPrompt: typeof import('@/lib/services/coach-gemma-service')['sendCoachGemmaPrompt'];
type CoachMessage = import('@/lib/services/coach-service').CoachMessage;

describe('coach-gemma-service', () => {
  const baseMessages = [{ role: 'user' as const, content: 'How should I squat?' }];

  beforeAll(() => {
    ({ sendCoachGemmaPrompt } = require('@/lib/services/coach-gemma-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({
      data: { message: 'Brace your core.' },
      error: null,
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Invocation / request shape
  // ---------------------------------------------------------------------------

  it('invokes the coach-gemma function with messages and context', async () => {
    const context = { profile: { id: 'u1', name: 'Pat' }, focus: 'squat' };
    await sendCoachGemmaPrompt(baseMessages, context);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toBe('coach-gemma');
    expect(mockInvoke.mock.calls[0][1]).toEqual({
      body: { messages: baseMessages, context },
    });
  });

  it('omits the model field when no override is provided', async () => {
    await sendCoachGemmaPrompt(baseMessages);
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body).not.toHaveProperty('model');
  });

  it('forwards the model override when provided', async () => {
    await sendCoachGemmaPrompt(baseMessages, undefined, { model: 'gemma-3-27b-it' });
    expect(mockInvoke.mock.calls[0][1].body).toMatchObject({
      model: 'gemma-3-27b-it',
    });
  });

  it('uses EXPO_PUBLIC_COACH_GEMMA_FUNCTION when set', async () => {
    jest.resetModules();
    const prev = process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION;
    process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION = 'custom-coach-gemma';
    try {
      const mod = require('@/lib/services/coach-gemma-service');
      await mod.sendCoachGemmaPrompt(baseMessages);
      expect(mockInvoke.mock.calls[0][0]).toBe('custom-coach-gemma');
    } finally {
      if (prev === undefined) delete process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION;
      else process.env.EXPO_PUBLIC_COACH_GEMMA_FUNCTION = prev;
      jest.resetModules();
    }
  });

  // ---------------------------------------------------------------------------
  // Response extraction
  // ---------------------------------------------------------------------------

  it('extracts message from data.message', async () => {
    mockInvoke.mockResolvedValue({ data: { message: 'Drive through heels.' }, error: null });
    const result = await sendCoachGemmaPrompt(baseMessages);
    expect(result).toEqual({ role: 'assistant', content: 'Drive through heels.' });
  });

  it('falls back to data.content when data.message is absent', async () => {
    mockInvoke.mockResolvedValue({ data: { content: 'Set up square.' }, error: null });
    const result = await sendCoachGemmaPrompt(baseMessages);
    expect(result.content).toBe('Set up square.');
  });

  it('falls back to data.reply when message and content are absent', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'Neutral spine.' }, error: null });
    const result = await sendCoachGemmaPrompt(baseMessages);
    expect(result.content).toBe('Neutral spine.');
  });

  it('trims whitespace from the response', async () => {
    mockInvoke.mockResolvedValue({ data: { message: '  Brace hard.  ' }, error: null });
    const result = await sendCoachGemmaPrompt(baseMessages);
    expect(result.content).toBe('Brace hard.');
  });

  // ---------------------------------------------------------------------------
  // Error classification
  // ---------------------------------------------------------------------------

  it('classifies a 404 invoke failure as COACH_GEMMA_NOT_DEPLOYED', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: '404 Not Found', status: 404 },
    });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_GEMMA_NOT_DEPLOYED',
      retryable: false,
    });
  });

  it('classifies missing GEMINI_API_KEY as COACH_GEMMA_NOT_CONFIGURED', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'GEMINI_API_KEY is missing' },
    });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_GEMMA_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('classifies data.error with GEMINI_API_KEY as COACH_GEMMA_NOT_CONFIGURED', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'GEMINI_API_KEY is not set' },
      error: null,
    });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_GEMMA_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('classifies generic invoke errors as COACH_GEMMA_INVOKE_FAILED with retryable=true', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Timeout exceeded' },
    });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_GEMMA_INVOKE_FAILED',
      retryable: true,
    });
  });

  it('classifies response-body errors without config keywords as COACH_GEMMA_ERROR', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'Model capacity exceeded' },
      error: null,
    });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_GEMMA_ERROR',
      retryable: true,
    });
  });

  it('rejects empty coach responses as COACH_GEMMA_EMPTY_RESPONSE', async () => {
    mockInvoke.mockResolvedValue({ data: { message: '   ' }, error: null });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_GEMMA_EMPTY_RESPONSE',
    });
  });

  it('rejects responses missing message/content/reply as COACH_GEMMA_EMPTY_RESPONSE', async () => {
    mockInvoke.mockResolvedValue({ data: { other: 'field' }, error: null });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_GEMMA_EMPTY_RESPONSE',
    });
  });

  it('wraps non-domain errors as COACH_GEMMA_REQUEST_FAILED', async () => {
    mockInvoke.mockRejectedValue(new Error('Network unreachable'));

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_GEMMA_REQUEST_FAILED',
      retryable: true,
    });
  });

  it('re-throws errors that already have a domain property', async () => {
    const domainErr = { domain: 'validation', code: 'CUSTOM', message: 'custom' };
    mockInvoke.mockRejectedValue(domainErr);

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toBe(domainErr);
  });

  // ---------------------------------------------------------------------------
  // Timeout / rate-limit hardening (Gap #5)
  //
  // Supabase's invoke() surfaces network timeouts as thrown AbortError-shaped
  // rejections and upstream 429 responses via its { error } channel. The
  // service must surface a typed error in both cases rather than hang or
  // leak the underlying network exception.
  // ---------------------------------------------------------------------------

  it('surfaces timeout-shaped thrown errors as COACH_GEMMA_REQUEST_FAILED (no hang)', async () => {
    const timeoutErr = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    mockInvoke.mockRejectedValue(timeoutErr);

    const promise = sendCoachGemmaPrompt(baseMessages);
    await expect(promise).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_GEMMA_REQUEST_FAILED',
      retryable: true,
    });
  });

  it('surfaces upstream 429 rate-limit responses without hanging', async () => {
    // Supabase edge returns rate-limit as a { error } with status 429.
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: '429 Too Many Requests', status: 429 },
    });

    const promise = sendCoachGemmaPrompt(baseMessages);
    // The current invoke-error path classifies everything-non-404/-config as
    // INVOKE_FAILED with retryable=true; assert exactly that shape so future
    // refinements (e.g. a dedicated COACH_GEMMA_RATE_LIMITED code) can tighten
    // this test without regressing.
    await expect(promise).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_GEMMA_INVOKE_FAILED',
      retryable: true,
    });
  });

  it('surfaces 429 text inside data.error as COACH_GEMMA_ERROR with retryable=true', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'rate limit exceeded (429)' },
      error: null,
    });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_GEMMA_ERROR',
      retryable: true,
    });
  });

  // ---------------------------------------------------------------------------
  // Wave-27: Gemma edge cases (safety-filter rejection + schema drift).
  //
  // The Gemma edge function is a thin proxy over Google's Gemini
  // generateContent endpoint. Gemini can return:
  //   - A safety-filtered response: `finishReason: 'SAFETY'` with no
  //     content (the model refused to answer). The edge function
  //     normally strips this to `{ error: ... }` or a blank message,
  //     but if it ever leaks the raw shape, the client must still
  //     classify it as a non-crashing typed error.
  //   - A schema-drift response: a well-formed HTTP 200 with NONE of
  //     the expected `message` / `content` / `reply` fields populated
  //     (e.g. the edge function returns the raw Gemini `candidates`
  //     array instead of the coach-service contract).
  //
  // Both cases must surface COACH_GEMMA_EMPTY_RESPONSE (validation
  // domain) per the current impl at
  // lib/services/coach-gemma-service.ts:95-101 -- no content keys
  // present means empty response.
  // ---------------------------------------------------------------------------

  it('classifies safety-filtered responses (finishReason=SAFETY, no content) as COACH_GEMMA_EMPTY_RESPONSE', async () => {
    // Gemini returns a candidates array with no content when the model
    // refuses to answer on safety grounds. The edge function does not
    // currently distinguish SAFETY from other empty cases, so the
    // client collapses all no-content responses to EMPTY_RESPONSE --
    // assert exactly that shape so a future dedicated
    // COACH_GEMMA_SAFETY_REJECTED code tightens this test rather than
    // regressing it.
    mockInvoke.mockResolvedValue({
      data: {
        finishReason: 'SAFETY',
        candidates: [
          {
            finishReason: 'SAFETY',
            safetyRatings: [
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH' },
            ],
          },
        ],
      },
      error: null,
    });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_GEMMA_EMPTY_RESPONSE',
    });
  });

  it('classifies schema-drift responses (raw Gemini candidates shape, no message/content/reply) as COACH_GEMMA_EMPTY_RESPONSE', async () => {
    // If the edge function ever drifts to returning the raw Gemini
    // shape (`candidates: [{ content: { parts: [{ text }] } }]`)
    // instead of the coach-service contract (`{ message: string }`),
    // the client-side extraction at
    // lib/services/coach-gemma-service.ts:92-93 will miss it because
    // it only checks the top-level `message` / `content` (string) /
    // `reply` keys -- `data.content` here is an OBJECT, not a string,
    // so `data.content.trim()` would throw. The safe-fallthrough must
    // still reach the EMPTY_RESPONSE path.
    mockInvoke.mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: 'This field should have been flattened to data.message' }],
            },
            finishReason: 'STOP',
          },
        ],
        promptFeedback: { blockReason: null },
      },
      error: null,
    });

    await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_GEMMA_EMPTY_RESPONSE',
    });
  });

  // ---------------------------------------------------------------------------
  // Cost-tracker wiring (#537)
  // ---------------------------------------------------------------------------

  describe('cost-tracker wiring (#537)', () => {
    beforeEach(() => {
      mockRecordCoachUsage.mockClear();
      mockRecordCoachUsage.mockResolvedValue(undefined);
    });

    it('records a gemma_cloud usage event on the happy path with estimated tokens', async () => {
      // 100-char prompt + 50-char reply → ceil(100/4)=25 in, ceil(50/4)=13 out
      const longPrompt = 'a'.repeat(100);
      const longReply = 'b'.repeat(50);
      mockInvoke.mockResolvedValue({
        data: { message: longReply },
        error: null,
      });
      await sendCoachGemmaPrompt([{ role: 'user', content: longPrompt }]);

      expect(mockRecordCoachUsage).toHaveBeenCalledTimes(1);
      expect(mockRecordCoachUsage.mock.calls[0][0]).toMatchObject({
        provider: 'gemma_cloud',
        taskKind: 'chat',
        tokensIn: 25,
        tokensOut: 13,
      });
    });

    it('maps taskKind="debrief" into the debrief tracker bucket', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'debrief reply' },
        error: null,
      });
      await sendCoachGemmaPrompt(baseMessages, undefined, { taskKind: 'debrief' });
      expect(mockRecordCoachUsage.mock.calls[0][0]).toMatchObject({
        taskKind: 'debrief',
      });
    });

    it('maps taskKind="drill_explainer" into the drill_explainer tracker bucket', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'explainer' },
        error: null,
      });
      await sendCoachGemmaPrompt(baseMessages, undefined, { taskKind: 'drill_explainer' });
      expect(mockRecordCoachUsage.mock.calls[0][0]).toMatchObject({
        taskKind: 'drill_explainer',
      });
    });

    it('defaults to chat when taskKind is omitted', async () => {
      await sendCoachGemmaPrompt(baseMessages);
      expect(mockRecordCoachUsage.mock.calls[0][0]).toMatchObject({
        taskKind: 'chat',
      });
    });

    it('does not block the reply when recordCoachUsage throws', async () => {
      mockRecordCoachUsage.mockRejectedValueOnce(new Error('tracker-down'));
      mockInvoke.mockResolvedValue({
        data: { message: 'Reply is returned.' },
        error: null,
      });
      const result = await sendCoachGemmaPrompt(baseMessages);
      // Reply still lands. Fire-and-forget tracker failure is logged as a warn.
      expect(result.content).toBe('Reply is returned.');
    });

    it('does not record usage when the call errors out', async () => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: { message: '404 Not Found', status: 404 },
      });
      await expect(sendCoachGemmaPrompt(baseMessages)).rejects.toMatchObject({
        code: 'COACH_GEMMA_NOT_DEPLOYED',
      });
      expect(mockRecordCoachUsage).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Model field reliability (fold of Gemma-4)
  //
  // The reply must ALWAYS carry a `model` annotation. When the edge function
  // returns one we use it verbatim; when it doesn't we tag 'gemma-unknown'
  // and emit a once-per-process warn via logError. Downstream consumers
  // (provider badges, telemetry) can read `reply.model` without a null-check.
  // ---------------------------------------------------------------------------

  describe('model field reliability (fold of Gemma-4)', () => {
    const UNKNOWN_GEMMA_MODEL = 'gemma-unknown';
    // Use a module-local `send` to guarantee both sendCoachGemmaPrompt and
    // __resetMissingModelWarnForTests come from the SAME module instance.
    // A prior test in this file calls `jest.resetModules()`, which blows
    // away the cached module; the outer `sendCoachGemmaPrompt` captured in
    // the outer beforeAll then points at a different module than the one
    // freshly resolved inside this describe — state is split between them
    // and the warn flag can never be reset cleanly.
    let send: typeof sendCoachGemmaPrompt;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@/lib/services/coach-gemma-service');
      send = mod.sendCoachGemmaPrompt;
      mod.__resetMissingModelWarnForTests();
      mockLogError.mockClear();
    });

    it('uses the edge-function model when provided', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'ok', model: 'gemma-3-4b-it' },
        error: null,
      });
      const reply = await send(baseMessages);
      // Non-enumerable — read directly.
      expect((reply as CoachMessage & { model?: string }).model).toBe('gemma-3-4b-it');
    });

    it('trims whitespace from the edge-function model', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'ok', model: '   gemma-3-27b-it  ' },
        error: null,
      });
      const reply = await send(baseMessages);
      expect((reply as CoachMessage & { model?: string }).model).toBe('gemma-3-27b-it');
    });

    it('tags reply as UNKNOWN_GEMMA_MODEL when edge function omits model', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'ok' }, // no model field
        error: null,
      });
      const reply = await send(baseMessages);
      expect((reply as CoachMessage & { model?: string }).model).toBe(UNKNOWN_GEMMA_MODEL);
      expect((reply as CoachMessage & { model?: string }).model).toBe('gemma-unknown');
    });

    it('tags reply as UNKNOWN_GEMMA_MODEL when model is an empty string', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'ok', model: '' },
        error: null,
      });
      const reply = await send(baseMessages);
      expect((reply as CoachMessage & { model?: string }).model).toBe('gemma-unknown');
    });

    it('tags reply as UNKNOWN_GEMMA_MODEL when model is whitespace-only', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'ok', model: '   ' },
        error: null,
      });
      const reply = await send(baseMessages);
      expect((reply as CoachMessage & { model?: string }).model).toBe('gemma-unknown');
    });

    it('logs a warn-classified error exactly once when model is missing', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'ok' },
        error: null,
      });
      // First call → warn. Second call → no additional warn.
      await send(baseMessages);
      await send(baseMessages);

      expect(mockLogError).toHaveBeenCalledTimes(1);
      const [errArg] = mockLogError.mock.calls[0];
      expect(errArg).toMatchObject({
        domain: 'coach',
        code: 'COACH_GEMMA_MODEL_MISSING',
        severity: 'warning',
      });
    });

    it('does not log when model is present', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'ok', model: 'gemma-3-4b-it' },
        error: null,
      });
      await send(baseMessages);
      expect(mockLogError).not.toHaveBeenCalled();
    });
  });
});
