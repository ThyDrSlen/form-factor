import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPreferredProviderId, readEnabledProviderIds, setPreferredProviderId } from '@/lib/ai/config';
import { createOnDeviceProvider, registerOnDeviceRuntime, type OnDeviceRuntime } from '@/lib/ai/providers/on-device-provider';
import { __resetRegistryForTests, getProvider } from '@/lib/ai/registry';
import { generate } from '@/lib/ai/router';

function runtime(overrides: Partial<OnDeviceRuntime> = {}): OnDeviceRuntime {
  return {
    id: 'on-device',
    label: 'Phone model',
    model: 'gemma-3n-e2b-q4',
    isReady: () => true,
    generate: jest.fn().mockResolvedValue('  keep your elbows in  '),
    ...overrides,
  };
}

beforeEach(() => __resetRegistryForTests());

describe('on-device provider slot', () => {
  it('wraps a runtime as a local provider with its model id', async () => {
    const provider = createOnDeviceProvider(runtime());
    expect(provider.kind).toBe('on-device');
    await expect(provider.generate({ messages: [{ role: 'user', content: 'cue?' }] })).resolves.toEqual({
      text: 'keep your elbows in', providerId: 'on-device', model: 'gemma-3n-e2b-q4', source: 'local',
    });
  });

  it('treats an empty reply as a retryable failure so the router can fall back', async () => {
    const provider = createOnDeviceProvider(runtime({ generate: jest.fn().mockResolvedValue('  ') }));
    await expect(provider.generate({ messages: [] })).rejects.toMatchObject({ code: 'AI_ON_DEVICE_EMPTY', retryable: true });
  });

  it('is routed to once registered and enabled, and skipped while not ready', async () => {
    let ready = false;
    const unregister = registerOnDeviceRuntime(runtime({ isReady: () => ready }));
    expect(getProvider('on-device')).toBeDefined();
    await expect(generate({ messages: [] }, { enabled: ['on-device'] })).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    ready = true;
    await expect(generate({ messages: [] }, { enabled: ['on-device'] })).resolves.toMatchObject({ providerId: 'on-device' });
    unregister();
    expect(getProvider('on-device')).toBeUndefined();
  });
});

describe('provider config', () => {
  it('parses the enabled list, defaulting to openai', () => {
    expect(readEnabledProviderIds(undefined)).toEqual(['openai']);
    expect(readEnabledProviderIds('  ')).toEqual(['openai']);
    expect(readEnabledProviderIds('on-device, Gemma-Cloud ,openai,openai')).toEqual(['on-device', 'gemma-cloud', 'openai']);
  });

  it('reads the legacy picker key and migrates on write', async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem('coach_cloud_provider', 'gemma');
    await expect(getPreferredProviderId()).resolves.toBe('gemma-cloud');
    await setPreferredProviderId('openai');
    await expect(getPreferredProviderId()).resolves.toBe('openai');
    await expect(AsyncStorage.getItem('coach_cloud_provider')).resolves.toBeNull();
    await setPreferredProviderId(null);
    await expect(getPreferredProviderId()).resolves.toBeNull();
  });
});
