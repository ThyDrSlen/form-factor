/**
 * useFirstSessionCheck
 *
 * AsyncStorage-backed boolean flag that tracks whether the user has completed
 * the first-use form-tracking setup wizard. Returns `null` while the initial
 * read is in flight so callers can distinguish "unknown" from "not seen".
 *
 * Storage key is intentionally distinct from PR #424's in-session overlay key
 * (`formTrackingOnboardingDismissedV1`) so the two flows can be driven
 * independently without stepping on each other.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FIRST_SESSION_STORAGE_KEY = 'formTrackingSetupSeenV1';

export interface UseFirstSessionCheckResult {
  hasSeenSetup: boolean | null;
  markSeen: () => Promise<void>;
}

export function useFirstSessionCheck(): UseFirstSessionCheckResult {
  const [hasSeenSetup, setHasSeenSetup] = useState<boolean | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(FIRST_SESSION_STORAGE_KEY);
        if (cancelled || !isMountedRef.current) return;
        setHasSeenSetup(raw === 'true');
      } catch (err) {
        // Swallow read errors; surface as "not seen" so the wizard still shows
        // rather than getting stuck on the loading state.
        if (cancelled || !isMountedRef.current) return;
        console.warn('[useFirstSessionCheck] failed to read storage', err);
        setHasSeenSetup(false);
      }
    })();

    return () => {
      cancelled = true;
      isMountedRef.current = false;
    };
  }, []);

  const markSeen = useCallback(async () => {
    try {
      await AsyncStorage.setItem(FIRST_SESSION_STORAGE_KEY, 'true');
    } catch (err) {
      console.warn('[useFirstSessionCheck] failed to persist setup-seen flag', err);
    } finally {
      if (isMountedRef.current) {
        setHasSeenSetup(true);
      }
    }
  }, []);

  return { hasSeenSetup, markSeen };
}
