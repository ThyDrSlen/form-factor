// Unit tests for lib/services/coach-failover.ts (issue #465 Item 2).

import {
  sendCoachPromptWithFailover,
  shouldFailover,
  type RawProviderResponse,
  type ProviderError,
} from '@/lib/services/coach-failover';
import {
  getCoachTelemetrySnapshot,
  resetCoachTelemetry,
} from '@/lib/services/coach-telemetry';

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachTelemetry();
});

type InvokeImpl = (
  fn: string,
  body: unknown
) => Promise<{ data: RawProviderResponse | null; error: ProviderError | null }>;

const messages = [{ role: 'user' as const, content: 'plan a push day' }];

describe('shouldFailover', () => {
  it('retries on 429 (quota)', () => {
    expect(shouldFailover(429)).toBe(true);
  });
  it('retries on every 5xx', () => {
    expect(shouldFailover(500)).toBe(true);
    expect(shouldFailover(502)).toBe(true);
    expect(shouldFailover(503)).toBe(true);
    expect(shouldFailover(504)).toBe(true);
    expect(shouldFailover(599)).toBe(true);
  });
  it('does NOT retry on other 4xx', () => {
    expect(shouldFailover(400)).toBe(false);
    expect(shouldFailover(401)).toBe(false);
    expect(shouldFailover(403)).toBe(false);
    expect(shouldFailover(404)).toBe(false);
    expect(shouldFailover(422)).toBe(false);
  });
  it('does NOT retry on 2xx/3xx', () => {
    expect(shouldFailover(200)).toBe(false);
    expect(shouldFailover(301)).toBe(false);
  });
  it('retries on transport failure (status=0)', () => {
    expect(shouldFailover(0)).toBe(true);
  });
  it('does NOT retry when status is missing', () => {
    expect(shouldFailover(undefined)).toBe(false);
  });
});

describe('sendCoachPromptWithFailover', () => {
  it('returns the primary reply when the primary succeeds (no failover)', async () => {
    const invoke: InvokeImpl = jest.fn(async (fn) => {
      expect(fn).toBe('coach-gemma');
      return { data: { message: 'gemma reply' }, error: null };
    });

    const result = await sendCoachPromptWithFailover(messages, undefined, {
      invokeImpl: invoke,
    });

    expect(result).toEqual({ role: 'assistant', content: 'gemma reply' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(getCoachTelemetrySnapshot().failover_used).toBe(0);
  });

  it('falls over from primary 429 to secondary openai', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'rate limited', status: 429 },
      })
      .mockResolvedValueOnce({ data: { message: 'openai backup' }, error: null });

    const result = await sendCoachPromptWithFailover(messages, undefined, {
      invokeImpl: invoke,
    });

    expect(result.content).toBe('openai backup');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect((invoke as jest.Mock).mock.calls[0][0]).toBe('coach-gemma');
    expect((invoke as jest.Mock).mock.calls[1][0]).toBe('coach');

    const snap = getCoachTelemetrySnapshot();
    expect(snap.failover_used).toBe(1);
    expect(snap.failover_used_by_provider).toEqual({ openai: 1 });
  });

  it('falls over on each 5xx', async () => {
    for (const status of [500, 502, 503, 504]) {
      resetCoachTelemetry();
      const invoke: InvokeImpl = jest
        .fn()
        .mockResolvedValueOnce({ data: null, error: { message: 'oh no', status } })
        .mockResolvedValueOnce({ data: { message: 'fallback' }, error: null });

      const result = await sendCoachPromptWithFailover(messages, undefined, {
        invokeImpl: invoke,
      });
      expect(result.content).toBe('fallback');
      expect(getCoachTelemetrySnapshot().failover_used).toBe(1);
    }
  });

  it('does NOT fail over on 4xx (other than 429) - surfaces immediately', async () => {
    const invoke: InvokeImpl = jest.fn(async () => ({
      data: null,
      error: { message: 'unauthorized', status: 401 },
    }));

    await expect(
      sendCoachPromptWithFailover(messages, undefined, { invokeImpl: invoke })
    ).rejects.toMatchObject({
      code: 'COACH_FAILOVER_PROVIDER_ERROR',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(getCoachTelemetrySnapshot().failover_used).toBe(0);
  });

  it('surfaces the secondary error when both providers fail', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'gemma quota', status: 429 },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'openai 503', status: 503 },
      });

    await expect(
      sendCoachPromptWithFailover(messages, undefined, { invokeImpl: invoke })
    ).rejects.toMatchObject({
      code: 'COACH_FAILOVER_PROVIDER_ERROR',
      message: expect.stringContaining('openai 503'),
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(getCoachTelemetrySnapshot().failover_used).toBe(1);
  });

  it('treats a thrown invoke (transport failure) as failover-eligible', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { message: 'fallback' }, error: null });

    const result = await sendCoachPromptWithFailover(messages, undefined, {
      invokeImpl: invoke,
    });
    expect(result.content).toBe('fallback');
    expect(getCoachTelemetrySnapshot().failover_used).toBe(1);
  });

  it('extracts content/reply when message is absent (Gemma response shape variance)', async () => {
    const invoke: InvokeImpl = jest.fn(async () => ({
      data: { reply: 'gemma reply via reply field' },
      error: null,
    }));

    const result = await sendCoachPromptWithFailover(messages, undefined, {
      invokeImpl: invoke,
    });
    expect(result.content).toBe('gemma reply via reply field');
  });

  it('respects custom primary/secondary opts (openai primary, gemma secondary)', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'openai 503', status: 503 },
      })
      .mockResolvedValueOnce({ data: { message: 'gemma backup' }, error: null });

    const result = await sendCoachPromptWithFailover(messages, undefined, {
      primary: 'openai',
      secondary: 'gemma',
      invokeImpl: invoke,
    });
    expect(result.content).toBe('gemma backup');
    expect((invoke as jest.Mock).mock.calls[0][0]).toBe('coach');
    expect((invoke as jest.Mock).mock.calls[1][0]).toBe('coach-gemma');
    expect(getCoachTelemetrySnapshot().failover_used_by_provider).toEqual({ gemma: 1 });
  });

  it('handles a primary that returns an empty body without error', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({ data: { other: 'field' } as RawProviderResponse, error: null })
      .mockResolvedValueOnce({ data: { message: 'fallback' }, error: null });

    // Empty payload returns 502; that triggers failover.
    const result = await sendCoachPromptWithFailover(messages, undefined, {
      invokeImpl: invoke,
    });
    expect(result.content).toBe('fallback');
    expect(getCoachTelemetrySnapshot().failover_used).toBe(1);
  });
});

describe('coach-service back-compat with allowFailover opt', () => {
  it('routes sendCoachPrompt(opts.allowFailover=true) through coach-failover', async () => {
    // Spy on the failover module by re-mocking it through jest.doMock so the
    // import inside sendCoachPrompt resolves to our mock.
    jest.resetModules();
    const fakeFailover = jest.fn(async () => ({ role: 'assistant', content: 'via failover' }));
    jest.doMock('@/lib/services/coach-failover', () => ({
      sendCoachPromptWithFailover: fakeFailover,
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sendCoachPrompt } = require('@/lib/services/coach-service') as typeof import('@/lib/services/coach-service');
    const result = await sendCoachPrompt(
      [{ role: 'user', content: 'hi' }],
      undefined,
      { allowFailover: true }
    );
    expect(result.content).toBe('via failover');
    expect(fakeFailover).toHaveBeenCalledTimes(1);
  });
});
