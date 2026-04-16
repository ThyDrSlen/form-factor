/**
 * Tests for the on-device coach stub and the dispatcher fallback in
 * `coach-service.ts`. See `docs/gemma-integration.md` for the full rollout
 * plan.
 */

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
}));

jest.mock('../../../lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: jest.fn(),
}));

describe('coach-local (stub provider)', () => {
  // Load the module fresh for each block so the dispatcher flag can flip
  // between tests without residual state.
  let sendCoachPromptLocal: typeof import('@/lib/services/coach-local')['sendCoachPromptLocal'];
  let isCoachLocalAvailable: typeof import('@/lib/services/coach-local')['isCoachLocalAvailable'];
  let COACH_LOCAL_NOT_AVAILABLE: typeof import('@/lib/services/coach-local')['COACH_LOCAL_NOT_AVAILABLE'];

  beforeAll(() => {
    ({
      sendCoachPromptLocal,
      isCoachLocalAvailable,
      COACH_LOCAL_NOT_AVAILABLE,
    } = require('@/lib/services/coach-local'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports the stable COACH_LOCAL_NOT_AVAILABLE sentinel the dispatcher matches on', () => {
    expect(COACH_LOCAL_NOT_AVAILABLE).toBe('COACH_LOCAL_NOT_AVAILABLE');
  });

  it('throws COACH_LOCAL_NOT_AVAILABLE with the expected shape', async () => {
    await expect(
      sendCoachPromptLocal([{ role: 'user', content: 'Help with my squat' }])
    ).rejects.toMatchObject({
      domain: 'ml',
      code: 'COACH_LOCAL_NOT_AVAILABLE',
      retryable: false,
      severity: 'info',
    });
  });

  it('throws even when a rich context is supplied (stub ignores inputs)', async () => {
    await expect(
      sendCoachPromptLocal(
        [
          { role: 'system', content: 'You are a coach.' },
          { role: 'user', content: 'How should I brace?' },
        ],
        { profile: { id: 'user-1' }, focus: 'squat', sessionId: 'sess-1' }
      )
    ).rejects.toMatchObject({
      code: 'COACH_LOCAL_NOT_AVAILABLE',
    });
  });

  it('reports the provider as not ready from isCoachLocalAvailable()', async () => {
    await expect(isCoachLocalAvailable()).resolves.toBe(false);
  });
});

describe('coach-service dispatcher with EXPO_PUBLIC_COACH_LOCAL', () => {
  const baseMessages = [{ role: 'user' as const, content: 'How should I squat?' }];
  const originalFlag = process.env.EXPO_PUBLIC_COACH_LOCAL;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockInvoke.mockResolvedValue({ data: { message: 'Cloud reply.' }, error: null });
    mockInsert.mockResolvedValue({ error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFlag === undefined) {
      delete process.env.EXPO_PUBLIC_COACH_LOCAL;
    } else {
      process.env.EXPO_PUBLIC_COACH_LOCAL = originalFlag;
    }
  });

  it('falls back to cloud when local throws COACH_LOCAL_NOT_AVAILABLE', async () => {
    process.env.EXPO_PUBLIC_COACH_LOCAL = '1';

    const { sendCoachPrompt } = require('@/lib/services/coach-service') as typeof import('@/lib/services/coach-service');

    const result = await sendCoachPrompt(baseMessages);

    expect(result).toEqual({ role: 'assistant', content: 'Cloud reply.' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('does NOT try local when the flag is unset — cloud is the only path', async () => {
    delete process.env.EXPO_PUBLIC_COACH_LOCAL;

    // Spy on the local provider to confirm it is never invoked when flag is off.
    const localModule = require('@/lib/services/coach-local') as typeof import('@/lib/services/coach-local');
    const localSpy = jest.spyOn(localModule, 'sendCoachPromptLocal');

    const { sendCoachPrompt } = require('@/lib/services/coach-service') as typeof import('@/lib/services/coach-service');

    const result = await sendCoachPrompt(baseMessages);

    expect(result).toEqual({ role: 'assistant', content: 'Cloud reply.' });
    expect(localSpy).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('does NOT try local when the flag is set to something other than "1"', async () => {
    process.env.EXPO_PUBLIC_COACH_LOCAL = 'true';

    const localModule = require('@/lib/services/coach-local') as typeof import('@/lib/services/coach-local');
    const localSpy = jest.spyOn(localModule, 'sendCoachPromptLocal');

    const { sendCoachPrompt } = require('@/lib/services/coach-service') as typeof import('@/lib/services/coach-service');

    await sendCoachPrompt(baseMessages);

    expect(localSpy).not.toHaveBeenCalled();
  });

  it('re-throws non-sentinel local errors without trying cloud', async () => {
    process.env.EXPO_PUBLIC_COACH_LOCAL = '1';

    // Mock the local provider to throw a different kind of error (e.g. OOM).
    // A real local failure should surface, not silently escape to cloud.
    jest.doMock('@/lib/services/coach-local', () => ({
      COACH_LOCAL_NOT_AVAILABLE: 'COACH_LOCAL_NOT_AVAILABLE',
      sendCoachPromptLocal: jest.fn().mockRejectedValue({
        domain: 'ml',
        code: 'COACH_LOCAL_OOM',
        message: 'Out of memory',
        retryable: true,
      }),
      isCoachLocalAvailable: jest.fn().mockResolvedValue(false),
    }));

    const { sendCoachPrompt } = require('@/lib/services/coach-service') as typeof import('@/lib/services/coach-service');

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_LOCAL_OOM',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns the local response directly when local succeeds (future path)', async () => {
    process.env.EXPO_PUBLIC_COACH_LOCAL = '1';

    jest.doMock('@/lib/services/coach-local', () => ({
      COACH_LOCAL_NOT_AVAILABLE: 'COACH_LOCAL_NOT_AVAILABLE',
      sendCoachPromptLocal: jest
        .fn()
        .mockResolvedValue({ role: 'assistant', content: 'On-device reply.' }),
      isCoachLocalAvailable: jest.fn().mockResolvedValue(true),
    }));

    const { sendCoachPrompt } = require('@/lib/services/coach-service') as typeof import('@/lib/services/coach-service');

    const result = await sendCoachPrompt(baseMessages);

    expect(result).toEqual({ role: 'assistant', content: 'On-device reply.' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
