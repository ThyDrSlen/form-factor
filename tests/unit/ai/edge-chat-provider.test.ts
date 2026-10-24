const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } }));

import { invokeEdgeChat, parseRetryAfterMs } from '@/lib/ai/providers/edge-chat-provider';
import { GEMMA_CLOUD_EDGE, OPENAI_EDGE } from '@/lib/ai/providers';

const request = { messages: [{ role: 'user' as const, content: 'hi' }], context: { focus: 'x' } };

beforeEach(() => mockInvoke.mockReset());

describe('invokeEdgeChat', () => {
  it('posts the shared wire format to the configured function', async () => {
    mockInvoke.mockResolvedValue({ data: { message: '  hello  ', model: 'gpt-5.4-mini' }, error: null });
    const result = await invokeEdgeChat(OPENAI_EDGE, request);
    expect(mockInvoke).toHaveBeenCalledWith('coach', { body: { messages: request.messages, context: request.context } });
    expect(result).toMatchObject({ text: 'hello', providerId: 'openai', model: 'gpt-5.4-mini' });
  });

  it('passes a model override only when given', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'ok' }, error: null });
    await invokeEdgeChat(GEMMA_CLOUD_EDGE, { ...request, model: 'gemma-3-4b-it' });
    expect(mockInvoke).toHaveBeenCalledWith('coach-gemma', {
      body: { messages: request.messages, context: request.context, model: 'gemma-3-4b-it' },
    });
  });

  it.each([
    [OPENAI_EDGE, { status: 404, message: 'not found' }, 'COACH_NOT_DEPLOYED', false],
    [OPENAI_EDGE, { message: 'OPENAI_API_KEY missing' }, 'COACH_NOT_CONFIGURED', false],
    [OPENAI_EDGE, { status: 429, message: 'slow' }, 'COACH_RATE_LIMITED', true],
    [OPENAI_EDGE, { status: 500, message: 'boom' }, 'COACH_INVOKE_FAILED', true],
    [GEMMA_CLOUD_EDGE, { message: 'GEMINI_API_KEY not set' }, 'COACH_GEMMA_NOT_CONFIGURED', false],
    [GEMMA_CLOUD_EDGE, { status: 429, message: 'quota' }, 'COACH_GEMMA_RATE_LIMITED', true],
  ])('maps %s transport error %p to %s', async (config, error, code, retryableFlag) => {
    mockInvoke.mockResolvedValue({ data: null, error });
    await expect(invokeEdgeChat(config, request)).rejects.toMatchObject({ code, retryable: retryableFlag });
  });

  it('reads Retry-After from the raw response on 429', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { status: 429, message: 'slow' },
      response: { headers: { get: (k: string) => (k === 'Retry-After' ? '7' : null) } },
    });
    await expect(invokeEdgeChat(OPENAI_EDGE, request)).rejects.toMatchObject({
      code: 'COACH_RATE_LIMITED',
      details: { retryAfterMs: 7000 },
    });
  });

  it('maps a rate-limit payload only for providers that opt in', async () => {
    mockInvoke.mockResolvedValue({ data: { error: 'Too many requests' }, error: null });
    await expect(invokeEdgeChat(OPENAI_EDGE, request)).rejects.toMatchObject({ code: 'COACH_RATE_LIMITED' });
    await expect(invokeEdgeChat(GEMMA_CLOUD_EDGE, request)).rejects.toMatchObject({ code: 'COACH_GEMMA_ERROR' });
  });

  it('rejects an empty reply', async () => {
    mockInvoke.mockResolvedValue({ data: { message: '   ' }, error: null });
    await expect(invokeEdgeChat(GEMMA_CLOUD_EDGE, request)).rejects.toMatchObject({ code: 'COACH_GEMMA_EMPTY_RESPONSE' });
  });
});

describe('parseRetryAfterMs', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs(new Date(Date.now() + 60_000).toUTCString())).toBeGreaterThan(50_000);
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});
