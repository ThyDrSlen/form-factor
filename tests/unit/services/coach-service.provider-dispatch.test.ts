// Verify that coach-service dispatches to the OpenAI path or the Gemma path
// based on the provider argument / resolver result.

const mockInvoke = jest.fn();
const mockSendCoachGemmaPrompt = jest.fn();
const mockResolveCloudProvider = jest.fn();
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
    functions: { invoke: mockInvoke },
    from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: null }) })),
  },
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: jest.fn(),
}));

jest.mock('../../../lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: jest.fn(),
}));

jest.mock('@/lib/services/coach-gemma-service', () => ({
  sendCoachGemmaPrompt: mockSendCoachGemmaPrompt,
}));

jest.mock('@/lib/services/coach-cloud-provider', () => ({
  resolveCloudProvider: mockResolveCloudProvider,
}));

let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];

describe('coach-service provider dispatch', () => {
  const baseMessages = [{ role: 'user' as const, content: 'Help me deadlift' }];
  // Dispatch-flag gate (#536): Gemma dispatch now requires
  // `EXPO_PUBLIC_COACH_DISPATCH=on`. These tests assert end-to-end routing
  // to the Gemma path, so the flag is set on in beforeEach and cleared in
  // afterEach. The off-by-default case (Gemma collapses to OpenAI) is
  // covered by coach-service.dispatch-flag.test.ts.
  const ORIGINAL_DISPATCH = process.env.EXPO_PUBLIC_COACH_DISPATCH;

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_COACH_DISPATCH = 'on';
    mockInvoke.mockResolvedValue({
      data: { message: 'Hinge at the hips.' },
      error: null,
    });
    mockSendCoachGemmaPrompt.mockResolvedValue({
      role: 'assistant',
      content: 'Drive through the floor.',
    });
    mockResolveCloudProvider.mockResolvedValue('openai');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_DISPATCH === undefined) {
      delete process.env.EXPO_PUBLIC_COACH_DISPATCH;
    } else {
      process.env.EXPO_PUBLIC_COACH_DISPATCH = ORIGINAL_DISPATCH;
    }
  });

  // ---------------------------------------------------------------------------
  // Explicit provider argument
  // ---------------------------------------------------------------------------

  it('routes to OpenAI when provider is explicitly openai', async () => {
    const result = await sendCoachPrompt(baseMessages, undefined, { provider: 'openai' });

    expect(result.content).toBe('Hinge at the hips.');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
    expect(mockResolveCloudProvider).not.toHaveBeenCalled();
  });

  it('routes to Gemma when provider is explicitly gemma', async () => {
    const result = await sendCoachPrompt(baseMessages, undefined, { provider: 'gemma' });

    expect(result.content).toBe('Drive through the floor.');
    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledTimes(1);
    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledWith(baseMessages, undefined);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockResolveCloudProvider).not.toHaveBeenCalled();
  });

  it('forwards messages and context to the Gemma path', async () => {
    const context = { profile: { id: 'u1', name: 'Pat' }, focus: 'squat' };
    await sendCoachPrompt(baseMessages, context, { provider: 'gemma' });

    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledWith(baseMessages, context);
  });

  // ---------------------------------------------------------------------------
  // Implicit (resolved) provider
  // ---------------------------------------------------------------------------

  it('calls resolveCloudProvider when provider is omitted', async () => {
    await sendCoachPrompt(baseMessages);
    expect(mockResolveCloudProvider).toHaveBeenCalledTimes(1);
  });

  it('dispatches to Gemma when the resolver returns gemma', async () => {
    mockResolveCloudProvider.mockResolvedValue('gemma');

    const result = await sendCoachPrompt(baseMessages);

    expect(result.content).toBe('Drive through the floor.');
    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('dispatches to OpenAI when the resolver returns openai', async () => {
    mockResolveCloudProvider.mockResolvedValue('openai');

    const result = await sendCoachPrompt(baseMessages);

    expect(result.content).toBe('Hinge at the hips.');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Error propagation
  // ---------------------------------------------------------------------------

  it('propagates domain errors from the Gemma path', async () => {
    const gemmaErr = {
      domain: 'validation',
      code: 'COACH_GEMMA_NOT_CONFIGURED',
      message: 'missing key',
      retryable: false,
    };
    mockSendCoachGemmaPrompt.mockRejectedValue(gemmaErr);

    await expect(
      sendCoachPrompt(baseMessages, undefined, { provider: 'gemma' }),
    ).rejects.toBe(gemmaErr);
  });

  it('propagates errors from the OpenAI path unchanged', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'OPENAI_API_KEY missing' },
    });

    await expect(
      sendCoachPrompt(baseMessages, undefined, { provider: 'openai' }),
    ).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_NOT_CONFIGURED',
    });
  });
});
