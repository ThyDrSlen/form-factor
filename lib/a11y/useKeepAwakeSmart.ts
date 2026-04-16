/**
 * useKeepAwakeSmart
 *
 * Tag-scoped wrapper over `expo-keep-awake` that activates screen
 * wake-lock while the supplied `active` flag is true and auto-releases
 * after a hard 20-minute safety ceiling even if the caller forgets to
 * deactivate — this protects users from accidental all-night drain
 * during a background-stuck tracking session.
 *
 * Multiple callers can hold the same tag safely; expo-keep-awake
 * reference-counts per tag.
 */

import { useEffect } from 'react';
import * as KeepAwake from 'expo-keep-awake';

export type KeepAwakeTag = 'tracking-active' | 'rest-long' | (string & {});

export interface UseKeepAwakeSmartOptions {
  /** Override the auto-deactivate ceiling. Default: 20 minutes. */
  maxDurationMs?: number;
}

const DEFAULT_MAX_DURATION_MS = 20 * 60 * 1000; // 20 minutes

export function useKeepAwakeSmart(
  tag: KeepAwakeTag,
  active: boolean,
  options?: UseKeepAwakeSmartOptions,
): void {
  useEffect(() => {
    if (!active) return;

    let released = false;
    const release = (reason: 'unmount' | 'timeout' | 'manual') => {
      if (released) return;
      released = true;
      try {
        void KeepAwake.deactivateKeepAwake(tag);
      } catch {
        /* ignore — keep-awake is best-effort */
      }
      if (reason === 'timeout' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn(`[useKeepAwakeSmart] Auto-released tag "${tag}" after safety ceiling`);
      }
    };

    try {
      void KeepAwake.activateKeepAwakeAsync(tag);
    } catch {
      /* ignore — no-op on web when Wake Lock API is unavailable */
    }

    const ceiling = options?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    const timer = setTimeout(() => release('timeout'), ceiling);

    return () => {
      clearTimeout(timer);
      release('unmount');
    };
  }, [active, tag, options?.maxDurationMs]);
}

export default useKeepAwakeSmart;
