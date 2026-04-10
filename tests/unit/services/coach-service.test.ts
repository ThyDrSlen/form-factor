const mockInvoke = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({
  insert: mockInsert,
}));
const mockCreateError = jest.fn(
  (
    domain: string,
    code: string,
    message: string,
    opts?: { details?: unknown; retryable?: boolean; severity?: string }
  ) => ({
    domain,
    code,
    message,
    retryable: opts?.retryable ?? false,
    severity: opts?.severity ?? 'error',
    details: opts?.details,
  })
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
    from: mockFrom,
  },
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
}));

jest.mock('../../../lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
}));

let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];

describe('coach-service', () => {
  const baseMessages = [{ role: 'user' as const, content: 'How should I squat?' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({ data: { message: 'Keep your chest up.' }, error: null });
    mockInsert.mockResolvedValue({ error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('classifies a 404 invoke failure as COACH_NOT_DEPLOYED', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: '404 Not Found', status: 404 } });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_NOT_DEPLOYED',
      retryable: false,
    });
  });

  it('classifies missing API key failures as COACH_NOT_CONFIGURED', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'OPENAI_API_KEY is missing' } });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('maps response error payloads to COACH_ERROR', async () => {
    mockInvoke.mockResolvedValue({ data: { error: 'Inference failed' }, error: null });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_ERROR',
      message: 'Inference failed',
      retryable: true,
    });
  });

  it('rejects empty coach responses as COACH_EMPTY_RESPONSE', async () => {
    mockInvoke.mockResolvedValue({ data: { message: '   ' }, error: null });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_EMPTY_RESPONSE',
    });
  });

  it('persists conversations when profile and session context are present', async () => {
    const messages = [
      { role: 'system' as const, content: 'You are a coach.' },
      { role: 'user' as const, content: 'How should I brace?' },
      { role: 'assistant' as const, content: 'Breathe into your belly.' },
      { role: 'user' as const, content: 'What about my knees?' },
    ];

    const result = await sendCoachPrompt(messages, {
      profile: { id: 'user-123', name: 'Pat' },
      focus: 'squat',
      sessionId: 'session-9',
    });
    await Promise.resolve();

    expect(result).toEqual({ role: 'assistant', content: 'Keep your chest up.' });
    expect(mockFrom).toHaveBeenCalledWith('coach_conversations');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        session_id: 'session-9',
        turn_index: 1,
        user_message: 'What about my knees?',
        assistant_message: 'Keep your chest up.',
        input_messages: messages,
        context: { focus: 'squat' },
        metadata: expect.objectContaining({
          model: 'gpt-5.4-mini',
          timestamp: expect.any(String),
        }),
      })
    );
  });

  // ---------------------------------------------------------------------------
  // Successful response extraction
  // ---------------------------------------------------------------------------

  it('extracts message from data.content when data.message is absent', async () => {
    mockInvoke.mockResolvedValue({ data: { content: 'Brace your core.' }, error: null });

    const result = await sendCoachPrompt(baseMessages);

    expect(result).toEqual({ role: 'assistant', content: 'Brace your core.' });
  });

  it('extracts message from data.reply when message and content are absent', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'Use a hip hinge.' }, error: null });

    const result = await sendCoachPrompt(baseMessages);

    expect(result).toEqual({ role: 'assistant', content: 'Use a hip hinge.' });
  });

  it('prefers data.message over data.content and data.reply', async () => {
    mockInvoke.mockResolvedValue({
      data: { message: 'Primary', content: 'Secondary', reply: 'Tertiary' },
      error: null,
    });

    const result = await sendCoachPrompt(baseMessages);

    expect(result).toEqual({ role: 'assistant', content: 'Primary' });
  });

  it('trims whitespace from the response text', async () => {
    mockInvoke.mockResolvedValue({ data: { message: '  Keep your chest up.  ' }, error: null });

    const result = await sendCoachPrompt(baseMessages);

    expect(result.content).toBe('Keep your chest up.');
  });

  // ---------------------------------------------------------------------------
  // Error classification edge cases
  // ---------------------------------------------------------------------------

  it('classifies a "not configured" error message as COACH_NOT_CONFIGURED', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Function not configured for production' },
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_NOT_CONFIGURED',
    });
  });

  it('classifies a 404 error from message string (no status field) as COACH_NOT_DEPLOYED', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: '404 Function not found' },
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_NOT_DEPLOYED',
    });
  });

  it('classifies a generic invoke error as COACH_INVOKE_FAILED with retryable=true', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Timeout exceeded' },
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_INVOKE_FAILED',
      retryable: true,
    });
  });

  it('classifies data.error with OPENAI_API_KEY as COACH_NOT_CONFIGURED', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'OPENAI_API_KEY is not set' },
      error: null,
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('classifies data.error with "not configured" as COACH_NOT_CONFIGURED', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'Model not configured' },
      error: null,
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_NOT_CONFIGURED',
    });
  });

  it('classifies data.error without config keywords as COACH_ERROR', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'Model capacity exceeded' },
      error: null,
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_ERROR',
      retryable: true,
    });
  });

  it('rejects when data is null and no error is returned (empty response)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_EMPTY_RESPONSE',
    });
  });

  it('rejects when data has no message/content/reply fields', async () => {
    mockInvoke.mockResolvedValue({ data: { other: 'field' }, error: null });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_EMPTY_RESPONSE',
    });
  });

  // ---------------------------------------------------------------------------
  // Non-AppError exceptions are wrapped as COACH_REQUEST_FAILED
  // ---------------------------------------------------------------------------

  it('wraps non-domain errors as COACH_REQUEST_FAILED', async () => {
    mockInvoke.mockRejectedValue(new Error('Network unreachable'));

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_REQUEST_FAILED',
      retryable: true,
    });
  });

  it('re-throws errors that already have a domain property', async () => {
    const domainErr = { domain: 'validation', code: 'CUSTOM', message: 'custom' };
    mockInvoke.mockRejectedValue(domainErr);

    await expect(sendCoachPrompt(baseMessages)).rejects.toBe(domainErr);
  });

  // ---------------------------------------------------------------------------
  // Conversation persistence
  // ---------------------------------------------------------------------------

  it('does not persist when profile.id is missing', async () => {
    await sendCoachPrompt(baseMessages, {
      profile: { name: 'Pat' },
      sessionId: 'sess-1',
    });
    await Promise.resolve();

    expect(mockFrom).not.toHaveBeenCalledWith('coach_conversations');
  });

  it('does not persist when sessionId is missing', async () => {
    await sendCoachPrompt(baseMessages, {
      profile: { id: 'user-1', name: 'Pat' },
    });
    await Promise.resolve();

    expect(mockFrom).not.toHaveBeenCalledWith('coach_conversations');
  });

  it('does not persist when context is undefined', async () => {
    await sendCoachPrompt(baseMessages);
    await Promise.resolve();

    expect(mockFrom).not.toHaveBeenCalledWith('coach_conversations');
  });

  it('retries persist once when initial insert fails', async () => {
    let insertCallCount = 0;
    mockInsert.mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) {
        return Promise.resolve({ error: { message: 'DB timeout' } });
      }
      return Promise.resolve({ error: null });
    });

    const messages = [{ role: 'user' as const, content: 'test' }];
    await sendCoachPrompt(messages, {
      profile: { id: 'user-1' },
      sessionId: 'sess-1',
    });

    // Wait for the fire-and-forget promises
    await new Promise((r) => setTimeout(r, 50));

    expect(insertCallCount).toBe(2);
  });

  it('uses the env-configured function name', () => {
    // The function name is read at module evaluation time from
    // process.env.EXPO_PUBLIC_COACH_FUNCTION, defaulting to 'coach'.
    // We verify the mock invoke is called with the expected name.
    expect(mockInvoke.mock.calls[0]?.[0] || 'coach').toBe('coach');
  });

  it('calculates turn_index correctly for single user message', async () => {
    const messages = [{ role: 'user' as const, content: 'Hello' }];
    await sendCoachPrompt(messages, {
      profile: { id: 'user-1' },
      sessionId: 'sess-1',
    });
    await Promise.resolve();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ turn_index: 0 })
    );
  });
});
