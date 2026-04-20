/**
 * Rep Countdown Preference
 *
 * Persists the user's opt-in/opt-out for the pre-announce 3-2-1 countdown
 * that plays before rep counting begins. The feature defaults to ON so new
 * users hear it the first time they enter a tracking session, but respects
 * an AsyncStorage override when the user toggles it in settings.
 *
 * The default can also be flipped via the `EXPO_PUBLIC_REP_COUNTDOWN` env
 * flag — if it is explicitly set to `'off'` the default becomes off. Any
 * other value (including unset) keeps the default on.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const REP_COUNTDOWN_STORAGE_KEY = 'form_rep_countdown_enabled_v1';

export function getRepCountdownDefault(): boolean {
  return (process.env.EXPO_PUBLIC_REP_COUNTDOWN ?? 'on').toLowerCase() !== 'off';
}

/**
 * Resolve the effective preference. Falls back to the default when nothing
 * has been stored yet or when the stored value is corrupt.
 */
export async function getRepCountdownEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(REP_COUNTDOWN_STORAGE_KEY);
    if (raw == null) return getRepCountdownDefault();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return getRepCountdownDefault();
  } catch {
    return getRepCountdownDefault();
  }
}

/**
 * Persist the user's choice. Idempotent — writing the same value twice is
 * a no-op beyond the AsyncStorage round-trip.
 */
export async function setRepCountdownEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(REP_COUNTDOWN_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // best-effort — the next call will fall back to the default
  }
}
