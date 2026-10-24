import { readEnabledProviderIds, type OnDeviceRoutingPreference } from './config';
import { getProvider } from './registry';

/**
 * Applies the user's on-device routing preference to the enabled provider
 * list: `cloud_only` drops on-device providers, `prefer_local` moves them to
 * the front, `local_only` keeps only them. `null` leaves the order alone.
 */
export function applyOnDeviceRouting(
  preference: OnDeviceRoutingPreference | null,
  enabled: readonly string[] = readEnabledProviderIds(),
): string[] {
  const isLocal = (id: string) => getProvider(id)?.kind === 'on-device';
  const local = enabled.filter(isLocal);
  const cloud = enabled.filter((id) => !isLocal(id));
  switch (preference) {
    case 'cloud_only':
      return cloud;
    case 'prefer_local':
      return [...local, ...cloud];
    case 'local_only':
      return local;
    default:
      return [...enabled];
  }
}
