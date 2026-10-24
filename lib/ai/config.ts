import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which providers may serve requests, in fallback order. Comma-separated ids,
 * e.g. `EXPO_PUBLIC_AI_PROVIDERS=gemma-cloud,openai`. Unset means `openai`
 * only, which is the shipped behavior.
 */
export const DEFAULT_PROVIDER_ORDER: readonly string[] = ['openai'];

export function readEnabledProviderIds(raw = process.env.EXPO_PUBLIC_AI_PROVIDERS): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [...DEFAULT_PROVIDER_ORDER];
  const ids = raw.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)] : [...DEFAULT_PROVIDER_ORDER];
}

export function isProviderEnabled(id: string, raw = process.env.EXPO_PUBLIC_AI_PROVIDERS): boolean {
  return readEnabledProviderIds(raw).includes(id);
}

export const PREFERRED_PROVIDER_STORAGE_KEY = 'ai_preferred_provider';
/** Written by the pre-registry provider picker as `openai` | `gemma`. */
const LEGACY_PROVIDER_STORAGE_KEY = 'coach_cloud_provider';

/**
 * The user's preferred provider id, if they picked one. The router only
 * honours it when that provider is enabled and able to serve the request.
 */
export async function getPreferredProviderId(): Promise<string | null> {
  try {
    const current = (await AsyncStorage.getItem(PREFERRED_PROVIDER_STORAGE_KEY))?.trim().toLowerCase();
    if (current) return current;
    const legacy = (await AsyncStorage.getItem(LEGACY_PROVIDER_STORAGE_KEY))?.trim().toLowerCase();
    if (legacy === 'gemma') return 'gemma-cloud';
    if (legacy === 'openai') return 'openai';
  } catch {
    // Storage unavailable: behave as if no preference was set.
  }
  return null;
}

export async function setPreferredProviderId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(PREFERRED_PROVIDER_STORAGE_KEY, id);
  else await AsyncStorage.removeItem(PREFERRED_PROVIDER_STORAGE_KEY);
  await AsyncStorage.removeItem(LEGACY_PROVIDER_STORAGE_KEY);
}

/**
 * How on-device providers participate, chosen in Settings → Coaching.
 * `null` (never chosen) follows EXPO_PUBLIC_AI_PROVIDERS as-is.
 */
export type OnDeviceRoutingPreference = 'cloud_only' | 'prefer_local' | 'local_only';
export const ON_DEVICE_ROUTING_STORAGE_KEY = 'coach_routing_preference';
const ROUTING_VALUES: readonly OnDeviceRoutingPreference[] = ['cloud_only', 'prefer_local', 'local_only'];

export function isOnDeviceRoutingPreference(value: unknown): value is OnDeviceRoutingPreference {
  return typeof value === 'string' && (ROUTING_VALUES as readonly string[]).includes(value);
}

export async function getOnDeviceRoutingPreference(): Promise<OnDeviceRoutingPreference | null> {
  try {
    const stored = await AsyncStorage.getItem(ON_DEVICE_ROUTING_STORAGE_KEY);
    return isOnDeviceRoutingPreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function setOnDeviceRoutingPreference(value: OnDeviceRoutingPreference): Promise<void> {
  await AsyncStorage.setItem(ON_DEVICE_ROUTING_STORAGE_KEY, value);
}
