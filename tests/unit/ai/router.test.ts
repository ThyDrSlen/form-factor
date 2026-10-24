import { __resetRegistryForTests, registerProvider } from '@/lib/ai/registry';
import { candidateProviders, generate, shouldFallBack, stream } from '@/lib/ai/router';
import type { ModelProvider, ModelResult } from '@/lib/ai/types';

function fakeProvider(id: string, overrides: Partial<ModelProvider> = {}): ModelProvider & { generate: jest.Mock } {
  return {
    id,
    label: id,
    kind: 'cloud',
    capabilities: [],
    isAvailable: () => true,
    generate: jest.fn(async (): Promise<ModelResult> => ({ text: `from ${id}`, providerId: id })),
    ...overrides,
  } as ModelProvider & { generate: jest.Mock };
}

const request = { messages: [{ role: 'user' as const, content: 'hi' }] };
const retryable = { domain: 'network', code: 'X_RATE_LIMITED', message: 'slow down', retryable: true };
const fatal = { domain: 'validation', code: 'X_NOT_CONFIGURED', message: 'no key', retryable: false };

beforeEach(() => __resetRegistryForTests());

describe('candidateProviders', () => {
  it('orders preferred ids first, then the enabled order, without duplicates', () => {
    ['openai', 'gemma-cloud', 'on-device'].forEach((id) => registerProvider(fakeProvider(id)));
    const ids = candidateProviders({ enabled: ['openai', 'gemma-cloud', 'on-device'], prefer: ['on-device', 'openai'] })
      .map((p) => p.id);
    expect(ids).toEqual(['on-device', 'openai', 'gemma-cloud']);
  });

  it('never returns a provider that is not enabled, even when preferred', () => {
    ['openai', 'gemma-cloud'].forEach((id) => registerProvider(fakeProvider(id)));
    expect(candidateProviders({ enabled: ['openai'], prefer: ['gemma-cloud'] }).map((p) => p.id)).toEqual(['openai']);
  });

  it('filters by required capabilities but treats stream as adaptable', () => {
    registerProvider(fakeProvider('openai'));
    registerProvider(fakeProvider('gemma-cloud', { capabilities: ['vision'] }));
    const enabled = ['openai', 'gemma-cloud'];
    expect(candidateProviders({ enabled, require: ['vision'] }).map((p) => p.id)).toEqual(['gemma-cloud']);
    expect(candidateProviders({ enabled, require: ['stream'] }).map((p) => p.id)).toEqual(['openai', 'gemma-cloud']);
  });

  it('defaults to openai only when EXPO_PUBLIC_AI_PROVIDERS is unset', () => {
    const previous = process.env.EXPO_PUBLIC_AI_PROVIDERS;
    delete process.env.EXPO_PUBLIC_AI_PROVIDERS;
    ['openai', 'gemma-cloud'].forEach((id) => registerProvider(fakeProvider(id)));
    try {
      expect(candidateProviders({ prefer: ['gemma-cloud'] }).map((p) => p.id)).toEqual(['openai']);
    } finally {
      if (previous !== undefined) process.env.EXPO_PUBLIC_AI_PROVIDERS = previous;
    }
  });
});

describe('generate', () => {
  const enabled = ['gemma-cloud', 'openai'];

  it('falls back to the next provider on a retryable error and reports the hop', async () => {
    const gemma = fakeProvider('gemma-cloud', { generate: jest.fn().mockRejectedValue(retryable) });
    const openai = fakeProvider('openai');
    registerProvider(gemma);
    registerProvider(openai);
    const onFallback = jest.fn();
    await expect(generate(request, { enabled, onFallback })).resolves.toMatchObject({ providerId: 'openai' });
    expect(onFallback).toHaveBeenCalledWith('gemma-cloud', 'openai', retryable);
  });

  it('falls back on a cost-cap error even though it is not retryable', async () => {
    const cap = { domain: 'coach', code: 'COACH_COST_CAP_EXCEEDED', message: 'cap', retryable: false };
    registerProvider(fakeProvider('gemma-cloud', { generate: jest.fn().mockRejectedValue(cap) }));
    registerProvider(fakeProvider('openai'));
    await expect(generate(request, { enabled })).resolves.toMatchObject({ providerId: 'openai' });
  });

  it('surfaces a non-retryable error without trying the next provider', async () => {
    registerProvider(fakeProvider('gemma-cloud', { generate: jest.fn().mockRejectedValue(fatal) }));
    const openai = fakeProvider('openai');
    registerProvider(openai);
    await expect(generate(request, { enabled })).rejects.toBe(fatal);
    expect(openai.generate).not.toHaveBeenCalled();
  });

  it('does not fall back when fallback is disabled', async () => {
    registerProvider(fakeProvider('gemma-cloud', { generate: jest.fn().mockRejectedValue(retryable) }));
    const openai = fakeProvider('openai');
    registerProvider(openai);
    await expect(generate(request, { enabled, fallback: false })).rejects.toBe(retryable);
    expect(openai.generate).not.toHaveBeenCalled();
  });

  it('surfaces the last error when every candidate fails', async () => {
    const second = { ...retryable, code: 'SECOND' };
    registerProvider(fakeProvider('gemma-cloud', { generate: jest.fn().mockRejectedValue(retryable) }));
    registerProvider(fakeProvider('openai', { generate: jest.fn().mockRejectedValue(second) }));
    await expect(generate(request, { enabled })).rejects.toBe(second);
  });

  it('skips providers that report unavailable (e.g. on-device model not downloaded)', async () => {
    const local = fakeProvider('on-device', { kind: 'on-device', isAvailable: () => false });
    registerProvider(local);
    registerProvider(fakeProvider('openai'));
    await expect(generate(request, { enabled: ['on-device', 'openai'] })).resolves.toMatchObject({ providerId: 'openai' });
    expect(local.generate).not.toHaveBeenCalled();
  });

  it('throws AI_PROVIDER_UNAVAILABLE when nothing can serve the request', async () => {
    await expect(generate(request, { enabled: ['openai'] })).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
  });

  it('never lets a throwing telemetry hook change routing', async () => {
    registerProvider(fakeProvider('gemma-cloud', { generate: jest.fn().mockRejectedValue(retryable) }));
    registerProvider(fakeProvider('openai'));
    const onFallback = () => { throw new Error('telemetry down'); };
    await expect(generate(request, { enabled, onFallback })).resolves.toMatchObject({ providerId: 'openai' });
  });
});

describe('stream', () => {
  it('uses native streaming when the provider has it', async () => {
    const nativeStream = jest.fn(async (_req, onChunk: (d: string) => void) => {
      onChunk('a'); onChunk('b');
      return { text: 'ab', providerId: 'openai' };
    });
    registerProvider(fakeProvider('openai', { stream: nativeStream }));
    const chunks: string[] = [];
    await stream(request, (d) => chunks.push(d), { enabled: ['openai'] });
    expect(chunks).toEqual(['a', 'b']);
  });

  it('adapts a non-streaming provider to a single chunk', async () => {
    registerProvider(fakeProvider('gemma-cloud'));
    const chunks: string[] = [];
    const result = await stream(request, (d) => chunks.push(d), { enabled: ['gemma-cloud'] });
    expect(chunks).toEqual(['from gemma-cloud']);
    expect(result.text).toBe('from gemma-cloud');
  });
});

describe('shouldFallBack', () => {
  it.each([
    [retryable, true],
    [fatal, false],
    [{ code: 'AI_PROVIDER_UNAVAILABLE' }, true],
    [new Error('boom'), false],
    [null, false],
  ])('%p → %p', (error, expected) => {
    expect(shouldFallBack(error)).toBe(expected);
  });
});
