const mockInvoke = jest.fn();
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

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
}));

jest.mock('../../../lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
}));

let sendCoachGemmaPrompt: typeof import('@/lib/services/coach-gemma-service')['sendCoachGemmaPrompt'];

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
});
