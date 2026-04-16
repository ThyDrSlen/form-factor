/**
 * useCameraPermissionGuard — detects mid-session camera permission revocation.
 *
 * expo-camera's useCameraPermissions hook returns the current permission but
 * only refreshes when its requestPermission/getPermissions helpers are called,
 * or when the app state changes. This hook wraps those signals and polls on
 * AppState foreground transitions so that if the user revokes camera access
 * in Settings while the scan session is paused in the background, we detect
 * it as soon as they return.
 *
 * The caller decides what to do with the `revoked` flag — typically pause
 * tracking and surface a banner with a "Open Settings" deep link.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { useCameraPermissions } from 'expo-camera';

export type CameraPermissionStatus = 'unknown' | 'granted' | 'denied' | 'revoked';

export type UseCameraPermissionGuardOptions = {
  /**
   * If true, treat `denied + canAskAgain: false` as `revoked`. This is the
   * situation where the user has explicitly turned off camera access and
   * must go to Settings to re-enable.
   */
  detectRevoke?: boolean;
};

export type UseCameraPermissionGuardResult = {
  status: CameraPermissionStatus;
  /** True when permission was granted earlier and is now denied (revoked in Settings). */
  revoked: boolean;
  /** True if the user can still be prompted in-app. */
  canAskAgain: boolean;
  /** Imperatively re-fetch permission state (e.g. after returning from Settings). */
  refresh: () => Promise<void>;
  /** Open the OS Settings app so the user can re-grant access. */
  openSettings: () => Promise<void>;
  /** Request permission in-app (only useful when canAskAgain === true). */
  request: () => Promise<CameraPermissionStatus>;
};

function mapStatus(
  granted: boolean | null | undefined,
  canAskAgain: boolean | null | undefined,
  wasGranted: boolean,
  detectRevoke: boolean,
): CameraPermissionStatus {
  if (granted === true) return 'granted';
  if (granted === false || granted === null) {
    // Treat transition from granted -> not-granted as "revoked"
    if (wasGranted && detectRevoke) return 'revoked';
    if (granted === false && canAskAgain === false && detectRevoke) return 'revoked';
    return 'denied';
  }
  return 'unknown';
}

export function useCameraPermissionGuard(
  options?: UseCameraPermissionGuardOptions,
): UseCameraPermissionGuardResult {
  const detectRevoke = options?.detectRevoke ?? true;
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const wasGrantedRef = useRef(false);
  const [status, setStatus] = useState<CameraPermissionStatus>('unknown');

  const evaluate = useCallback(
    (
      granted: boolean | null | undefined,
      canAskAgain: boolean | null | undefined,
    ): CameraPermissionStatus => {
      const next = mapStatus(granted, canAskAgain, wasGrantedRef.current, detectRevoke);
      if (granted === true) {
        wasGrantedRef.current = true;
      }
      return next;
    },
    [detectRevoke],
  );

  // Reflect current hook state.
  useEffect(() => {
    const next = evaluate(permission?.granted, permission?.canAskAgain);
    setStatus((prev) => (prev === next ? prev : next));
  }, [permission?.granted, permission?.canAskAgain, evaluate]);

  const refresh = useCallback(async () => {
    try {
      const result = await getPermission();
      const next = evaluate(result?.granted, result?.canAskAgain);
      setStatus((prev) => (prev === next ? prev : next));
    } catch {
      // No-op; leave status unchanged
    }
  }, [getPermission, evaluate]);

  // Re-check on every foreground transition so we catch Settings revocations.
  useEffect(() => {
    let active = true;
    const handleChange = (next: AppStateStatus) => {
      if (!active) return;
      if (next === 'active') {
        void refresh();
      }
    };
    const sub = AppState.addEventListener('change', handleChange);
    return () => {
      active = false;
      sub.remove();
    };
  }, [refresh]);

  const openSettings = useCallback(async () => {
    try {
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        await Linking.openSettings();
      }
    } catch {
      // Linking may throw on web or if Settings is unavailable; swallow.
    }
  }, []);

  const request = useCallback(async (): Promise<CameraPermissionStatus> => {
    const result = await requestPermission();
    const next = evaluate(result?.granted, result?.canAskAgain);
    setStatus((prev) => (prev === next ? prev : next));
    return next;
  }, [requestPermission, evaluate]);

  return {
    status,
    revoked: status === 'revoked',
    canAskAgain: permission?.canAskAgain ?? false,
    refresh,
    openSettings,
    request,
  };
}
