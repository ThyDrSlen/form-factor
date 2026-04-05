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

  beforeAll(async () => {
    ({ sendCoachPrompt } = await import('@/lib/services/coach-service'));
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
});
