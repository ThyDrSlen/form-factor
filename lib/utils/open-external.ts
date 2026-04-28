import * as Linking from 'expo-linking';

import { createError, logError } from '@/lib/services/ErrorHandler';

export type OpenResult = 'opened' | 'unsupported' | 'error';

/**
 * Opens an external URL via expo-linking, with a consistent failure path.
 *
 * On unsupported schemes (e.g. `mailto:` when no Mail client is installed)
 * or runtime errors, `onFallback` is invoked so the caller can surface a
 * toast, copy-to-clipboard, or other UX without duplicating try/catch logic.
 */
export async function openExternalUrl(
  url: string,
  opts?: { onFallback?: (url: string) => void }
): Promise<OpenResult> {
  try {
    const can = await Linking.canOpenURL(url);
    if (!can) {
      opts?.onFallback?.(url);
      return 'unsupported';
    }
    await Linking.openURL(url);
    return 'opened';
  } catch (err) {
    logError(
      createError('unknown', 'OPEN_URL_FAILED', 'Failed to open external URL', {
        details: { url, err },
        retryable: false,
      })
    );
    opts?.onFallback?.(url);
    return 'error';
  }
}

/**
 * Opens the platform system settings screen. When the call fails, the
 * optional `onFallback` lets the caller show a toast or fallback message.
 */
export async function openSystemSettings(
  opts?: { onFallback?: () => void }
): Promise<OpenResult> {
  try {
    await Linking.openSettings();
    return 'opened';
  } catch (err) {
    logError(
      createError('unknown', 'OPEN_SETTINGS_FAILED', 'Failed to open system settings', {
        details: err,
        retryable: false,
      })
    );
    opts?.onFallback?.();
    return 'error';
  }
}
