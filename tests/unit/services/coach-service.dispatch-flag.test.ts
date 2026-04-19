// Verifies the dispatch-flag gate on coach-service's Gemma provider branch
// (fix #536, site 1). When EXPO_PUBLIC_COACH_DISPATCH !== 'on', even an
// explicit `provider: 'gemma'` hint must fall through to the OpenAI edge
// function; when the flag is on, the Gemma path is honoured as before.

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

const DISPATCH_ENV = 'EXPO_PUBLIC_COACH_DISPATCH';
const ORIGINAL_DISPATCH = process.env[DISPATCH_ENV];

describe('coach-service dispatch-flag gate (#536)', () => {
  const baseMessages = [{ role: 'user' as const, content: 'Help me deadlift' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({
      data: { message: 'OpenAI reply.' },
      error: null,
    });
    mockSendCoachGemmaPrompt.mockResolvedValue({
      role: 'assistant',
      content: 'Gemma reply.',
    });
    mockResolveCloudProvider.mockResolvedValue('openai');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_DISPATCH === undefined) {
      delete process.env[DISPATCH_ENV];
    } else {
      process.env[DISPATCH_ENV] = ORIGINAL_DISPATCH;
    }
  });

  it('falls through to OpenAI when provider=gemma but dispatch flag is unset', async () => {
    delete process.env[DISPATCH_ENV];

    const result = await sendCoachPrompt(baseMessages, undefined, { provider: 'gemma' });

    expect(result.content).toBe('OpenAI reply.');
    expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('falls through to OpenAI when provider=gemma and dispatch flag is "off"', async () => {
    process.env[DISPATCH_ENV] = 'off';

    const result = await sendCoachPrompt(baseMessages, undefined, { provider: 'gemma' });

    expect(result.content).toBe('OpenAI reply.');
    expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('falls through to OpenAI when resolver returns gemma but dispatch flag is off', async () => {
    delete process.env[DISPATCH_ENV];
    mockResolveCloudProvider.mockResolvedValue('gemma');

    const result = await sendCoachPrompt(baseMessages);

    expect(result.content).toBe('OpenAI reply.');
    expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('honours provider=gemma when dispatch flag is "on"', async () => {
    process.env[DISPATCH_ENV] = 'on';

    const result = await sendCoachPrompt(baseMessages, undefined, { provider: 'gemma' });

    expect(result.content).toBe('Gemma reply.');
    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('honours resolver=gemma when dispatch flag is "on"', async () => {
    process.env[DISPATCH_ENV] = 'on';
    mockResolveCloudProvider.mockResolvedValue('gemma');

    const result = await sendCoachPrompt(baseMessages);

    expect(result.content).toBe('Gemma reply.');
    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('provider=openai is unaffected by the dispatch flag', async () => {
    // When the caller explicitly pins OpenAI the flag state is irrelevant —
    // we always take the OpenAI edge function path.
    for (const state of ['on', 'off', undefined] as const) {
      if (state === undefined) delete process.env[DISPATCH_ENV];
      else process.env[DISPATCH_ENV] = state;
      mockInvoke.mockClear();
      mockSendCoachGemmaPrompt.mockClear();

      const result = await sendCoachPrompt(baseMessages, undefined, { provider: 'openai' });
      expect(result.content).toBe('OpenAI reply.');
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockSendCoachGemmaPrompt).not.toHaveBeenCalled();
    }
  });
});
