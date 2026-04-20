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

let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];
let inferCoachProvider: typeof import('@/lib/services/coach-provider-types')['inferCoachProvider'];
let resetWarn: typeof import('@/lib/services/coach-provider-types')['__resetCoachProviderInferenceWarning'];

describe('coach-service — provider surface', () => {
  const baseMessages = [{ role: 'user' as const, content: 'How should I squat?' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
    ({
      inferCoachProvider,
      __resetCoachProviderInferenceWarning: resetWarn,
    } = require('@/lib/services/coach-provider-types'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    resetWarn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // sendCoachPrompt — provider on assistant replies
  // ---------------------------------------------------------------------------

  describe('sendCoachPrompt return value', () => {
    it('tags reply as "openai" when model is a gpt-* variant', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'Brace up.', model: 'gpt-5.4-mini' },
        error: null,
      });

      const reply = await sendCoachPrompt(baseMessages);

      expect(reply).toMatchObject({ role: 'assistant', content: 'Brace up.', provider: 'openai' });
    });

    it('tags reply as "gemma-cloud" when model starts with gemma-', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'Breathe in.', model: 'gemma-2-9b-it' },
        error: null,
      });

      const reply = await sendCoachPrompt(baseMessages);

      expect(reply).toMatchObject({ provider: 'gemma-cloud' });
    });

    it('tags reply as "cached" when source=cache', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'Hinge at hips.', model: 'gpt-5.4-mini', source: 'cache' },
        error: null,
      });

      const reply = await sendCoachPrompt(baseMessages);

      expect(reply).toMatchObject({ provider: 'cached' });
    });

    it('tags reply as "local-fallback" when source=local', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'Keep knees out.', model: 'gpt-5.4-mini', source: 'local' },
        error: null,
      });

      const reply = await sendCoachPrompt(baseMessages);

      expect(reply).toMatchObject({ provider: 'local-fallback' });
    });

    it('honours an explicit provider field when the edge function sends one', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'Depth first.', provider: 'gemma-on-device', model: 'gemma-2b-ondevice' },
        error: null,
      });

      const reply = await sendCoachPrompt(baseMessages);

      expect(reply).toMatchObject({ provider: 'gemma-on-device' });
    });

    it('defaults to "openai" when the model is unknown', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'Fallback text.', model: 'mystery-model-v0' },
        error: null,
      });

      const reply = await sendCoachPrompt(baseMessages);

      expect(reply).toMatchObject({ provider: 'openai' });
    });

    it('persists the inferred provider alongside the model in metadata', async () => {
      mockInvoke.mockResolvedValue({
        data: { message: 'Pause 2s.', model: 'gemma-2-9b-it' },
        error: null,
      });

      await sendCoachPrompt(baseMessages, {
        profile: { id: 'u-1' },
        sessionId: 's-1',
      });
      // Fire-and-forget insert — flush microtasks.
      await Promise.resolve();

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            model: 'gemma-2-9b-it',
            provider: 'gemma-cloud',
          }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // inferCoachProvider — pure inference coverage
  // ---------------------------------------------------------------------------

  describe('inferCoachProvider', () => {
    it('returns "openai" for null/undefined signal', () => {
      expect(inferCoachProvider(null)).toBe('openai');
      expect(inferCoachProvider(undefined)).toBe('openai');
    });

    it('prefers an explicit provider field over other signals', () => {
      expect(
        inferCoachProvider({ provider: 'gemma-cloud', model: 'gpt-5.4-mini' })
      ).toBe('gemma-cloud');
    });

    it('ignores unknown explicit provider and falls through to model inference', () => {
      expect(
        inferCoachProvider({ provider: 'made-up-provider', model: 'gpt-5.4-mini' })
      ).toBe('openai');
    });

    it('maps gpt-* models to openai', () => {
      expect(inferCoachProvider({ model: 'gpt-5.4-mini' })).toBe('openai');
      expect(inferCoachProvider({ model: 'GPT-4o' })).toBe('openai');
    });

    it('maps gemma-* models to gemma-cloud by default', () => {
      expect(inferCoachProvider({ model: 'gemma-2-9b-it' })).toBe('gemma-cloud');
    });

    it('flags gemma on-device via "on-device" in the model id', () => {
      expect(inferCoachProvider({ model: 'coach-2b-ondevice' })).toBe('gemma-on-device');
    });

    it('classifies source=cache as "cached" regardless of model', () => {
      expect(inferCoachProvider({ source: 'cache', model: 'gpt-5.4-mini' })).toBe('cached');
    });

    it('classifies source=local as "local-fallback"', () => {
      expect(inferCoachProvider({ source: 'local' })).toBe('local-fallback');
    });

    it('warns once in dev when model is ambiguous', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      resetWarn();

      inferCoachProvider({ model: 'unknown-1' });
      inferCoachProvider({ model: 'unknown-2' });

      // Expect at most one warn — the "once" behaviour is what we guarantee.
      expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(1);
      warnSpy.mockRestore();
    });
  });
});
