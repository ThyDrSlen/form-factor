import AsyncStorage from '@react-native-async-storage/async-storage';

export type CoachCloudProvider = 'openai' | 'gemma';

export const COACH_CLOUD_PROVIDER_STORAGE_KEY = 'coach_cloud_provider';

const VALID_PROVIDERS: CoachCloudProvider[] = ['openai', 'gemma'];
const DEFAULT_PROVIDER: CoachCloudProvider = 'openai';

function parseProvider(raw: unknown): CoachCloudProvider | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return (VALID_PROVIDERS as string[]).includes(normalized)
    ? (normalized as CoachCloudProvider)
    : null;
}

/**
 * Resolve which cloud coach provider to use for the current user.
 *
 * Precedence (highest wins):
 *   1. AsyncStorage preference at `coach_cloud_provider` (user-selected)
 *   2. `EXPO_PUBLIC_COACH_CLOUD_PROVIDER` env (build-time default)
 *   3. Hard-coded default: `openai`
 *
 * Invalid values at any layer are treated as absent and fall through.
 */
export async function resolveCloudProvider(): Promise<CoachCloudProvider> {
  try {
    const stored = await AsyncStorage.getItem(COACH_CLOUD_PROVIDER_STORAGE_KEY);
    const parsed = parseProvider(stored);
    if (parsed) return parsed;
  } catch {
    // AsyncStorage failures fall through to env/default.
  }

  const envValue = process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER;
  const fromEnv = parseProvider(envValue);
  if (fromEnv) return fromEnv;

  return DEFAULT_PROVIDER;
}

/** Persist a user-selected provider. Throws on invalid input. */
export async function setCloudProviderPreference(
  provider: CoachCloudProvider,
): Promise<void> {
  if (!parseProvider(provider)) {
    throw new Error(`Invalid coach cloud provider: ${String(provider)}`);
  }
  await AsyncStorage.setItem(COACH_CLOUD_PROVIDER_STORAGE_KEY, provider);
}

/** Remove any stored preference and fall back to env/default. */
export async function clearCloudProviderPreference(): Promise<void> {
  await AsyncStorage.removeItem(COACH_CLOUD_PROVIDER_STORAGE_KEY);
}

export const _internal = { parseProvider, DEFAULT_PROVIDER };
