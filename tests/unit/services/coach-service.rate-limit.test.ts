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
  logError: jest.fn(),
  // Real mapToUserMessage — we want to verify the specific copy surfaces.
  mapToUserMessage: jest.requireActual('@/lib/services/ErrorHandler').mapToUserMessage,
}));

jest.mock('../../../lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: jest.fn(),
  mapToUserMessage: jest.requireActual('../../../lib/services/ErrorHandler').mapToUserMessage,
}));

let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];
let mapToUserMessage: typeof import('@/lib/services/ErrorHandler')['mapToUserMessage'];

describe('coach-service — rate-limit labelling', () => {
  const baseMessages = [{ role: 'user' as const, content: 'Plan my week.' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
    ({ mapToUserMessage } = require('@/lib/services/ErrorHandler'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it('classifies HTTP 429 as COACH_RATE_LIMITED (retryable network)', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Too Many Requests', status: 429 },
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_RATE_LIMITED',
      retryable: true,
    });
  });

  it('classifies a "rate limit" substring in the error message as COACH_RATE_LIMITED', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'OpenAI rate limit exceeded' },
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_RATE_LIMITED',
    });
  });

  it('classifies a data.error rate-limit payload as COACH_RATE_LIMITED', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: '429: rate limit — try later' },
      error: null,
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_RATE_LIMITED',
      retryable: true,
    });
  });

  it('does NOT classify a generic timeout as a rate-limit error', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Timeout exceeded' },
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_INVOKE_FAILED',
    });
  });

  it('surfaces the distinct user-facing message via mapToUserMessage', () => {
    const err = {
      domain: 'network' as const,
      code: 'COACH_RATE_LIMITED',
      message: 'rate-limited',
      retryable: true,
      severity: 'error' as const,
    };
    expect(mapToUserMessage(err)).toBe('Coach is rate-limited — try again in a moment.');
  });
});
