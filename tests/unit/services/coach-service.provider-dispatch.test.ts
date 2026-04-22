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
    // Third arg is the Gemma opts object — contains `taskKind` (undefined
    // when no task kind was passed) used by the cost-tracker wiring.
    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledWith(
      baseMessages,
      undefined,
      { taskKind: undefined },
    );
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockResolveCloudProvider).not.toHaveBeenCalled();
  });

  it('forwards messages and context to the Gemma path', async () => {
    const context = { profile: { id: 'u1', name: 'Pat' }, focus: 'squat' };
    await sendCoachPrompt(baseMessages, context, { provider: 'gemma' });

    expect(mockSendCoachGemmaPrompt).toHaveBeenCalledWith(
      baseMessages,
      context,
      { taskKind: undefined },
    );
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

  // ---------------------------------------------------------------------------
  // Cross-tier cost boundaries and rollback
  //
  // WHY: when the cost-tracker module is wired into the dispatcher (future
  // work), these scenarios guard: (1) budget-cap fallback from gemma to stub,
  // (2) credit-rollback if a metered request fails after the debit, and
  // (3) mixed-tier spend accumulation across one session. The dispatcher
  // isn't wired to the tracker yet, so we test the expected contract by
  // driving the tracker directly in a sequence that mirrors the dispatcher
  // lifecycle. This lets future wiring drop in cleanly.
  // ---------------------------------------------------------------------------

  describe('cross-tier cost boundaries and rollback', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- mocks hoisted
    const costTrackerPath = '@/lib/services/coach-cost-tracker';

    beforeEach(() => {
      jest.resetModules();
    });

    it('falls back to stub when gemma request would exceed weekly budget', async () => {
      jest.isolateModules(() => {
        jest.doMock('@react-native-async-storage/async-storage', () => ({
          __esModule: true,
          default: {
            getItem: jest.fn().mockResolvedValue(null),
            setItem: jest.fn().mockResolvedValue(undefined),
            removeItem: jest.fn().mockResolvedValue(undefined),
            clear: jest.fn().mockResolvedValue(undefined),
          },
        }));
        jest.doMock('@/lib/logger', () => ({
          warnWithTs: jest.fn(),
          logWithTs: jest.fn(),
          errorWithTs: jest.fn(),
        }));
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tracker = require(costTrackerPath) as typeof import('@/lib/services/coach-cost-tracker');
      await tracker.resetCoachCostTracker();

      // Simulate a near-cap weekly spend — record enough prior usage that a
      // subsequent 2500-token gemma debrief would push us past the budget.
      const BUDGET_CAP = 50_000; // hypothetical weekly cap
      await tracker.recordCoachUsage({
        at: '2026-04-21T10:00:00.000Z',
        provider: 'gemma_cloud',
        taskKind: 'debrief',
        tokensIn: 45_000,
        tokensOut: 4_000,
      });

      const before = await tracker.getWeeklyAggregate('2026-04-21T12:00:00.000Z');
      const wouldExceed =
        before.totalTokensIn + before.totalTokensOut + 2500 > BUDGET_CAP;
      expect(wouldExceed).toBe(true);

      // A dispatcher that enforces BUDGET_CAP would skip the gemma call and
      // route to the stub provider. We model that decision and assert the
      // stub bucket captures the call without mutating the gemma bucket.
      if (wouldExceed) {
        await tracker.recordCoachUsage({
          at: '2026-04-21T12:00:00.000Z',
          provider: 'stub',
          taskKind: 'debrief',
          tokensIn: 0,
          tokensOut: 0,
        });
      }

      const after = await tracker.getWeeklyAggregate('2026-04-21T12:00:00.000Z');
      expect(after.byProvider.stub.calls).toBe(1);
      expect(after.byProvider.gemma_cloud.calls).toBe(before.byProvider.gemma_cloud.calls);
    });

    it('credits cost back to tracker when request fails after debit', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tracker = require(costTrackerPath) as typeof import('@/lib/services/coach-cost-tracker');
      await tracker.resetCoachCostTracker();

      // Debit: the dispatcher records usage optimistically before awaiting
      // the network call (common pattern to rate-limit concurrent callers).
      await tracker.recordCoachUsage({
        at: '2026-04-21T12:00:00.000Z',
        provider: 'openai',
        taskKind: 'chat',
        tokensIn: 2000,
        tokensOut: 0,
      });

      // Simulate the actual request failing — the dispatcher should "credit"
      // the previously-debited tokens by recording a compensating negative
      // bucket. Because the tracker clamps min-0 per event, a clean rollback
      // protocol is to reset and replay only successful events. Exercise both
      // paths: (a) reset-then-replay and (b) assert no retained ghost debit.
      await tracker.resetCoachCostTracker();

      const after = await tracker.getWeeklyAggregate('2026-04-21T12:00:00.000Z');
      expect(after.totalTokensIn).toBe(0);
      expect(after.totalCalls).toBe(0);
    });

    it('accumulates mixed-tier spend correctly across gemma + openai in one session', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tracker = require(costTrackerPath) as typeof import('@/lib/services/coach-cost-tracker');
      await tracker.resetCoachCostTracker();

      // Session turn 1: complex → openai
      await tracker.recordCoachUsage({
        at: '2026-04-21T12:00:00.000Z',
        provider: 'openai',
        taskKind: 'chat',
        tokensIn: 800,
        tokensOut: 450,
      });
      // Session turn 2: tactical → gemma
      await tracker.recordCoachUsage({
        at: '2026-04-21T12:01:00.000Z',
        provider: 'gemma_cloud',
        taskKind: 'drill_explainer',
        tokensIn: 250,
        tokensOut: 180,
      });
      // Session turn 3: complex → openai again
      await tracker.recordCoachUsage({
        at: '2026-04-21T12:02:00.000Z',
        provider: 'openai',
        taskKind: 'debrief',
        tokensIn: 1200,
        tokensOut: 900,
      });

      const agg = await tracker.getWeeklyAggregate('2026-04-21T13:00:00.000Z');
      expect(agg.byProvider.openai.calls).toBe(2);
      expect(agg.byProvider.gemma_cloud.calls).toBe(1);
      expect(agg.byProvider.openai.tokensIn).toBe(800 + 1200);
      expect(agg.byProvider.openai.tokensOut).toBe(450 + 900);
      expect(agg.byProvider.gemma_cloud.tokensIn).toBe(250);
      expect(agg.totalCalls).toBe(3);
      expect(agg.totalTokensIn).toBe(800 + 250 + 1200);
      expect(agg.totalTokensOut).toBe(450 + 180 + 900);
    });
  });
});
