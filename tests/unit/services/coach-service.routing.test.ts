// Provider routing for sendCoachPrompt over the model layer (lib/ai). Covers
// what the dispatch-flag, provider-dispatch, model-dispatch and failover suites
// asserted before routing moved into the router: Gemma only serves when it is
// enabled, an explicit hint beats the task policy and the user preference, a
// spend cap falls back to OpenAI, other errors surface, and allowFailover
// moves past retryable failures.

const mockInvoke = jest.fn();
const mockAssertUnderWeeklyCap = jest.fn();
const mockPreferredProvider = jest.fn();
const mockOnDeviceRouting = jest.fn();
const mockCreateError = jest.fn(
  (domain: string, code: string, message: string, opts?: { details?: unknown; retryable?: boolean; severity?: string }) => ({
    domain, code, message, retryable: opts?.retryable ?? false, severity: opts?.severity ?? 'error', details: opts?.details,
  }),
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: null }) })),
  },
}));
jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: (...args: Parameters<typeof mockCreateError>) => mockCreateError(...args),
  logError: jest.fn(),
}));
jest.mock('@/lib/services/coach-cost-guard', () => ({
  assertUnderWeeklyCap: (...args: unknown[]) => mockAssertUnderWeeklyCap(...args),
}));
jest.mock('@/lib/ai/config', () => ({
  ...jest.requireActual('@/lib/ai/config'),
  getPreferredProviderId: () => mockPreferredProvider(),
  getOnDeviceRoutingPreference: () => mockOnDeviceRouting(),
}));

import { sendCoachPrompt } from '@/lib/services/coach-service';
import { registerOnDeviceRuntime } from '@/lib/ai/providers/on-device-provider';

const ENV_KEYS = ['EXPO_PUBLIC_AI_PROVIDERS', 'EXPO_PUBLIC_COACH_PIPELINE_V2', 'EXPO_PUBLIC_COACH_MEMORY'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const messages = [{ role: 'user' as const, content: 'Help me deadlift' }];

const calledFunctions = () => mockInvoke.mock.calls.map(([fn]) => fn);
const respond = (byFunction: Record<string, unknown>) =>
  mockInvoke.mockImplementation(async (fn: string) =>
    byFunction[fn] ?? { data: null, error: { status: 404, message: 'not found' } });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_COACH_MEMORY = 'false';
  delete process.env.EXPO_PUBLIC_AI_PROVIDERS;
  delete process.env.EXPO_PUBLIC_COACH_PIPELINE_V2;
  mockAssertUnderWeeklyCap.mockResolvedValue(undefined);
  mockPreferredProvider.mockResolvedValue(null);
  mockOnDeviceRouting.mockResolvedValue(null);
  respond({
    coach: { data: { message: 'OpenAI reply.', model: 'gpt-5.4-mini' }, error: null },
    'coach-gemma': { data: { message: 'Gemma reply.', model: 'gemma-3-4b-it' }, error: null },
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe('Gemma only serves when enabled', () => {
  it('provider=gemma falls through to OpenAI when gemma-cloud is not enabled (default)', async () => {
    const result = await sendCoachPrompt(messages, undefined, { provider: 'gemma' });
    expect(result.content).toBe('OpenAI reply.');
    expect(calledFunctions()).toEqual(['coach']);
  });

  it('a gemma preference falls through to OpenAI when gemma-cloud is not enabled', async () => {
    mockPreferredProvider.mockResolvedValue('gemma-cloud');
    await expect(sendCoachPrompt(messages)).resolves.toMatchObject({ content: 'OpenAI reply.' });
    expect(calledFunctions()).toEqual(['coach']);
  });

  it('honours provider=gemma when enabled and tags the reply', async () => {
    process.env.EXPO_PUBLIC_AI_PROVIDERS = 'openai,gemma-cloud';
    const result = await sendCoachPrompt(messages, undefined, { provider: 'gemma' });
    expect(result.content).toBe('Gemma reply.');
    expect(result.provider).toBe('gemma-cloud');
    expect(result.model).toBe('gemma-3-4b-it');
    expect(calledFunctions()).toEqual(['coach-gemma']);
  });

  it('honours a gemma preference when enabled', async () => {
    process.env.EXPO_PUBLIC_AI_PROVIDERS = 'openai,gemma-cloud';
    mockPreferredProvider.mockResolvedValue('gemma-cloud');
    await expect(sendCoachPrompt(messages)).resolves.toMatchObject({ content: 'Gemma reply.' });
    expect(calledFunctions()).toEqual(['coach-gemma']);
  });

  it('serves the first enabled provider when there is no hint or preference', async () => {
    process.env.EXPO_PUBLIC_AI_PROVIDERS = 'gemma-cloud,openai';
    await expect(sendCoachPrompt(messages)).resolves.toMatchObject({ content: 'Gemma reply.' });
  });

  it('provider=openai is unaffected by what is enabled', async () => {
    for (const enabled of [undefined, 'openai,gemma-cloud', 'gemma-cloud,openai']) {
      if (enabled === undefined) delete process.env.EXPO_PUBLIC_AI_PROVIDERS;
      else process.env.EXPO_PUBLIC_AI_PROVIDERS = enabled;
      mockInvoke.mockClear();
      const result = await sendCoachPrompt(messages, undefined, { provider: 'openai' });
      expect(result.content).toBe('OpenAI reply.');
      expect(result.provider).toBe('openai');
      expect(calledFunctions()).toEqual(['coach']);
    }
  });

  it('forwards the messages and caller context to the Gemma function', async () => {
    process.env.EXPO_PUBLIC_AI_PROVIDERS = 'gemma-cloud';
    const context = { focus: 'fitness_coach', profile: { id: 'u1', name: 'A' } };
    await sendCoachPrompt(messages, context, { provider: 'gemma' });
    const [, { body }] = mockInvoke.mock.calls[0];
    expect(body.messages).toEqual(messages);
    expect(body.context).toEqual(expect.objectContaining(context));
  });
});

describe('spend cap and errors', () => {
  beforeEach(() => { process.env.EXPO_PUBLIC_AI_PROVIDERS = 'openai,gemma-cloud'; });

  it('falls back to OpenAI when the weekly Gemma cap is exceeded (#537)', async () => {
    mockAssertUnderWeeklyCap.mockRejectedValueOnce({ domain: 'validation', code: 'COACH_COST_CAP_EXCEEDED', message: 'cap blown' });
    const result = await sendCoachPrompt(messages, undefined, { provider: 'gemma' });
    expect(mockAssertUnderWeeklyCap).toHaveBeenCalledWith('gemma_cloud');
    expect(calledFunctions()).toEqual(['coach']);
    expect(result.content).toBe('OpenAI reply.');
  });

  it('propagates non-cap errors from the cost guard without falling back (#537)', async () => {
    const unrelated = { domain: 'storage', code: 'TRACKER_CORRUPT', message: 'corrupt state' };
    mockAssertUnderWeeklyCap.mockRejectedValueOnce(unrelated);
    await expect(sendCoachPrompt(messages, undefined, { provider: 'gemma' })).rejects.toBe(unrelated);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('propagates a Gemma failure unchanged without allowFailover', async () => {
    respond({ 'coach-gemma': { data: null, error: { status: 429, message: 'quota' } } });
    await expect(sendCoachPrompt(messages, undefined, { provider: 'gemma' })).rejects.toMatchObject({ code: 'COACH_GEMMA_RATE_LIMITED' });
    expect(calledFunctions()).toEqual(['coach-gemma']);
  });

  it('propagates an OpenAI failure unchanged', async () => {
    respond({ coach: { data: null, error: { message: 'OPENAI_API_KEY missing' } } });
    await expect(sendCoachPrompt(messages)).rejects.toMatchObject({ code: 'COACH_NOT_CONFIGURED' });
  });

  it('allowFailover moves past a retryable failure to the next enabled provider', async () => {
    respond({
      'coach-gemma': { data: null, error: { status: 503, message: 'unavailable' } },
      coach: { data: { message: 'OpenAI reply.' }, error: null },
    });
    const result = await sendCoachPrompt(messages, undefined, { provider: 'gemma', allowFailover: true });
    expect(result.content).toBe('OpenAI reply.');
    expect(calledFunctions()).toEqual(['coach-gemma', 'coach']);
  });

  it('allowFailover treats a thrown transport error as eligible', async () => {
    mockInvoke.mockImplementation(async (fn: string) => {
      if (fn === 'coach-gemma') throw new TypeError('Network request failed');
      return { data: { message: 'OpenAI reply.' }, error: null };
    });
    await expect(sendCoachPrompt(messages, undefined, { provider: 'gemma', allowFailover: true }))
      .resolves.toMatchObject({ content: 'OpenAI reply.' });
  });

  it('without allowFailover a thrown transport error becomes COACH_REQUEST_FAILED', async () => {
    mockInvoke.mockRejectedValue(new TypeError('Network request failed'));
    await expect(sendCoachPrompt(messages)).rejects.toMatchObject({ code: 'COACH_REQUEST_FAILED', retryable: true });
  });

  it('allowFailover still surfaces a non-retryable failure', async () => {
    respond({ 'coach-gemma': { data: null, error: { message: 'GEMINI_API_KEY not configured' } } });
    await expect(sendCoachPrompt(messages, undefined, { provider: 'gemma', allowFailover: true }))
      .rejects.toMatchObject({ code: 'COACH_GEMMA_NOT_CONFIGURED' });
    expect(calledFunctions()).toEqual(['coach-gemma']);
  });
});

describe('pipeline-v2 task-kind policy', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_COACH_PIPELINE_V2 = 'on';
    process.env.EXPO_PUBLIC_AI_PROVIDERS = 'openai,gemma-cloud';
  });

  it('a tactical task (rest_calc) prefers Gemma', async () => {
    const result = await sendCoachPrompt(messages, undefined, { taskKind: 'rest_calc', userTier: 'pro' });
    expect(result.content).toBe('Gemma reply.');
    expect(calledFunctions()).toEqual(['coach-gemma']);
  });

  it('a complex task (multi_turn_debrief) goes to GPT', async () => {
    await sendCoachPrompt(messages, undefined, { taskKind: 'multi_turn_debrief', userTier: 'free' });
    expect(calledFunctions()).toEqual(['coach']);
  });

  it('is ignored when the pipeline flag is off', async () => {
    delete process.env.EXPO_PUBLIC_COACH_PIPELINE_V2;
    await sendCoachPrompt(messages, undefined, { taskKind: 'rest_calc', userTier: 'pro' });
    expect(calledFunctions()).toEqual(['coach']);
  });

  it('an explicit provider hint beats the task policy', async () => {
    await sendCoachPrompt(messages, undefined, { taskKind: 'rest_calc', userTier: 'pro', provider: 'openai' });
    expect(calledFunctions()).toEqual(['coach']);
  });

  it('a Gemma preference from the policy is dropped when Gemma is not enabled', async () => {
    process.env.EXPO_PUBLIC_AI_PROVIDERS = 'openai';
    await sendCoachPrompt(messages, undefined, { taskKind: 'rest_calc', userTier: 'pro' });
    expect(calledFunctions()).toEqual(['coach']);
  });
});

describe('on-device routing preference', () => {
  const localGenerate = jest.fn();
  let unregister: () => void;
  beforeEach(() => {
    localGenerate.mockReset().mockResolvedValue('Local reply.');
    unregister = registerOnDeviceRuntime({
      id: 'on-device', label: 'Phone model', model: 'qwen3-1.7b-q4', isReady: () => true, generate: localGenerate,
    });
    process.env.EXPO_PUBLIC_AI_PROVIDERS = 'openai,on-device';
  });
  afterEach(() => unregister());

  it('follows the enabled order when the user never chose', async () => {
    await expect(sendCoachPrompt(messages)).resolves.toMatchObject({ content: 'OpenAI reply.' });
    expect(localGenerate).not.toHaveBeenCalled();
  });

  it('prefer_local answers on device and labels the reply', async () => {
    mockOnDeviceRouting.mockResolvedValue('prefer_local');
    const result = await sendCoachPrompt(messages, undefined, { provider: 'openai' });
    expect(result.content).toBe('Local reply.');
    expect(result.provider).toBe('on-device');
    expect(result.model).toBe('qwen3-1.7b-q4');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('prefer_local falls back to the cloud when the local model fails', async () => {
    mockOnDeviceRouting.mockResolvedValue('prefer_local');
    localGenerate.mockResolvedValue('   ');
    await expect(sendCoachPrompt(messages, undefined, { allowFailover: true })).resolves.toMatchObject({ content: 'OpenAI reply.' });
  });

  it('cloud_only never uses the on-device model, even when it leads the enabled order', async () => {
    process.env.EXPO_PUBLIC_AI_PROVIDERS = 'on-device,openai';
    mockOnDeviceRouting.mockResolvedValue('cloud_only');
    await expect(sendCoachPrompt(messages)).resolves.toMatchObject({ content: 'OpenAI reply.' });
    expect(localGenerate).not.toHaveBeenCalled();
  });

  it('local_only never calls the cloud', async () => {
    mockOnDeviceRouting.mockResolvedValue('local_only');
    await expect(sendCoachPrompt(messages, undefined, { provider: 'openai' })).resolves.toMatchObject({ content: 'Local reply.' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('local_only surfaces AI_PROVIDER_UNAVAILABLE when the local model is not ready', async () => {
    unregister();
    unregister = registerOnDeviceRuntime({ id: 'on-device', label: 'Phone model', model: 'm', isReady: () => false, generate: localGenerate });
    mockOnDeviceRouting.mockResolvedValue('local_only');
    await expect(sendCoachPrompt(messages)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
