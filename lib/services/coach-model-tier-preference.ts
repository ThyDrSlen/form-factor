/**
 * Coach model tier preference — user's "speed vs quality" hint for
 * dispatcher decisions. Persisted via AsyncStorage. For wave-31 this is a
 * visibility + intent signal surfaced in settings; actual wiring into
 * `decideCoachModel` happens in wave-32.
 *
 * Values:
 *   - `fast`      — prefer the snappiest model (Gemma 1.5 Flash-equivalent).
 *   - `balanced`  — let the dispatcher auto-pick (default).
 *   - `smart`     — prefer higher-quality models at the cost of latency.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { warnWithTs } from '@/lib/logger';

export type CoachModelTier = 'fast' | 'balanced' | 'smart';

export const COACH_MODEL_TIER_KEY = '@coach_model_tier';

export const DEFAULT_COACH_MODEL_TIER: CoachModelTier = 'balanced';

const TIER_VALUES: readonly CoachModelTier[] = ['fast', 'balanced', 'smart'] as const;

export function isCoachModelTier(value: unknown): value is CoachModelTier {
  return typeof value === 'string' && (TIER_VALUES as readonly string[]).includes(value);
}

/**
 * Load the stored tier preference. Returns `DEFAULT_COACH_MODEL_TIER` when
 * nothing is stored or AsyncStorage errors — this function never throws.
 */
export async function getModelTier(): Promise<CoachModelTier> {
  try {
    const stored = await AsyncStorage.getItem(COACH_MODEL_TIER_KEY);
    if (isCoachModelTier(stored)) return stored;
    return DEFAULT_COACH_MODEL_TIER;
  } catch (error) {
    warnWithTs('[coach-model-tier-preference] getModelTier failed', error);
    return DEFAULT_COACH_MODEL_TIER;
  }
}

/**
 * Persist the tier preference. Best-effort — swallows storage errors so the
 * caller's UI state stays ahead of persistence if the device is offline or
 * the storage backend is unavailable.
 */
export async function setModelTier(tier: CoachModelTier): Promise<void> {
  if (!isCoachModelTier(tier)) {
    throw new Error(`Invalid coach model tier: ${String(tier)}`);
  }
  try {
    await AsyncStorage.setItem(COACH_MODEL_TIER_KEY, tier);
  } catch (error) {
    warnWithTs('[coach-model-tier-preference] setModelTier failed', error);
  }
}

/** Clear the preference — mostly for sign-out / tests. */
export async function resetModelTier(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COACH_MODEL_TIER_KEY);
  } catch (error) {
    warnWithTs('[coach-model-tier-preference] resetModelTier failed', error);
  }
}
