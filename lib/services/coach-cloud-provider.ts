import { getPreferredProviderId, setPreferredProviderId } from '@/lib/ai/config';
import { isGemmaCloudPrimary } from './coach-provider-types';

export type CoachCloudProvider = 'openai' | 'gemma';

/** Legacy storage key; still read by lib/ai/config for existing installs. */
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
 *   1. The user's preferred provider (lib/ai/config; reads the legacy
 *      `coach_cloud_provider` key too)
 *   2. EXPO_PUBLIC_AI_PROVIDERS order: gemma when `gemma-cloud` leads
 *   3. Hard-coded default: `openai`
 *
 * Invalid values at any layer are treated as absent and fall through.
 */
export async function resolveCloudProvider(): Promise<CoachCloudProvider> {
  const preferred = await getPreferredProviderId();
  if (preferred === 'gemma-cloud') return 'gemma';
  if (preferred === 'openai') return 'openai';
  return isGemmaCloudPrimary() ? 'gemma' : DEFAULT_PROVIDER;
}

/** Persist a user-selected provider. Throws on invalid input. */
export async function setCloudProviderPreference(
  provider: CoachCloudProvider,
): Promise<void> {
  const parsed = parseProvider(provider);
  if (!parsed) {
    throw new Error(`Invalid coach cloud provider: ${String(provider)}`);
  }
  await setPreferredProviderId(parsed === 'gemma' ? 'gemma-cloud' : 'openai');
}

/** Remove any stored preference and fall back to the enabled order/default. */
export async function clearCloudProviderPreference(): Promise<void> {
  await setPreferredProviderId(null);
}

/**
 * Lightweight predicate used by UI surfaces (e.g. CoachAvailabilityBanner,
 * #557 B4) that need to know whether the current device could reach a
 * cloud coach *right now*. Today this is a simple network-online check —
 * all configured cloud providers (openai + gemma) need an internet link
 * to respond, and there's no per-provider health endpoint we can probe
 * without burning tokens. We accept `isOnline` from the caller so the
 * banner can pass through its NetworkContext value without forcing this
 * module to depend on React.
 *
 * The shape is a function rather than a bare boolean so future work can
 * layer in provider-specific circuit breakers (e.g. rate-limit cooldown
 * state from coach-failover.ts) without changing any call sites.
 */
export function isCloudCoachReachable(opts: { isOnline: boolean }): boolean {
  return opts.isOnline === true;
}

export const _internal = { parseProvider, DEFAULT_PROVIDER };
