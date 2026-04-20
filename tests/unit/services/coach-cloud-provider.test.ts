import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  COACH_CLOUD_PROVIDER_STORAGE_KEY,
  clearCloudProviderPreference,
  resolveCloudProvider,
  setCloudProviderPreference,
  type CoachCloudProvider,
} from '@/lib/services/coach-cloud-provider';

describe('coach-cloud-provider', () => {
  const ENV_KEY = 'EXPO_PUBLIC_COACH_CLOUD_PROVIDER';
  const originalEnvValue = process.env[ENV_KEY];

  beforeEach(async () => {
    await AsyncStorage.clear();
    delete process.env[ENV_KEY];
  });

  afterAll(() => {
    if (originalEnvValue === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnvValue;
  });

  // ---------------------------------------------------------------------------
  // Precedence
  // ---------------------------------------------------------------------------

  it('defaults to openai when nothing is set', async () => {
    expect(await resolveCloudProvider()).toBe('openai');
  });

  it('uses the env value when AsyncStorage is empty', async () => {
    process.env[ENV_KEY] = 'gemma';
    expect(await resolveCloudProvider()).toBe('gemma');
  });

  it('uses the AsyncStorage value when set, even if env is different', async () => {
    process.env[ENV_KEY] = 'openai';
    await AsyncStorage.setItem(COACH_CLOUD_PROVIDER_STORAGE_KEY, 'gemma');
    expect(await resolveCloudProvider()).toBe('gemma');
  });

  it('prefers AsyncStorage over env for both providers', async () => {
    process.env[ENV_KEY] = 'gemma';
    await AsyncStorage.setItem(COACH_CLOUD_PROVIDER_STORAGE_KEY, 'openai');
    expect(await resolveCloudProvider()).toBe('openai');
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  it('ignores invalid AsyncStorage values and falls through to env', async () => {
    process.env[ENV_KEY] = 'gemma';
    await AsyncStorage.setItem(COACH_CLOUD_PROVIDER_STORAGE_KEY, 'claude');
    expect(await resolveCloudProvider()).toBe('gemma');
  });

  it('ignores invalid env values and falls through to default', async () => {
    process.env[ENV_KEY] = 'anthropic';
    expect(await resolveCloudProvider()).toBe('openai');
  });

  it('ignores empty-string env and falls through to default', async () => {
    process.env[ENV_KEY] = '';
    expect(await resolveCloudProvider()).toBe('openai');
  });

  it('normalizes case and whitespace in stored preference', async () => {
    await AsyncStorage.setItem(COACH_CLOUD_PROVIDER_STORAGE_KEY, '  GEMMA  ');
    expect(await resolveCloudProvider()).toBe('gemma');
  });

  it('normalizes case in env value', async () => {
    process.env[ENV_KEY] = 'OpenAI';
    expect(await resolveCloudProvider()).toBe('openai');
  });

  // ---------------------------------------------------------------------------
  // AsyncStorage fault tolerance
  // ---------------------------------------------------------------------------

  it('falls through to env when AsyncStorage.getItem throws', async () => {
    const original = AsyncStorage.getItem;
    (AsyncStorage as { getItem: unknown }).getItem = jest
      .fn()
      .mockRejectedValueOnce(new Error('storage error'));
    process.env[ENV_KEY] = 'gemma';
    try {
      expect(await resolveCloudProvider()).toBe('gemma');
    } finally {
      (AsyncStorage as { getItem: unknown }).getItem = original;
    }
  });

  it('falls through to default when AsyncStorage.getItem throws and env is unset', async () => {
    const original = AsyncStorage.getItem;
    (AsyncStorage as { getItem: unknown }).getItem = jest
      .fn()
      .mockRejectedValueOnce(new Error('storage error'));
    try {
      expect(await resolveCloudProvider()).toBe('openai');
    } finally {
      (AsyncStorage as { getItem: unknown }).getItem = original;
    }
  });

  // ---------------------------------------------------------------------------
  // Setters
  // ---------------------------------------------------------------------------

  it('setCloudProviderPreference writes to AsyncStorage', async () => {
    await setCloudProviderPreference('gemma');
    expect(await AsyncStorage.getItem(COACH_CLOUD_PROVIDER_STORAGE_KEY)).toBe('gemma');
    expect(await resolveCloudProvider()).toBe('gemma');
  });

  it('setCloudProviderPreference rejects invalid providers', async () => {
    await expect(
      setCloudProviderPreference('claude' as CoachCloudProvider),
    ).rejects.toThrow(/Invalid coach cloud provider/);
  });

  it('clearCloudProviderPreference removes the stored value', async () => {
    await setCloudProviderPreference('gemma');
    await clearCloudProviderPreference();
    const stored = await AsyncStorage.getItem(COACH_CLOUD_PROVIDER_STORAGE_KEY);
    expect(stored == null).toBe(true);
    expect(await resolveCloudProvider()).toBe('openai');
  });
});
