/**
 * CameraPermissionBanner (#542)
 *
 * Non-modal banner that surfaces a clear recovery path when the scan
 * surface is mounted without camera access. Sits at the top of the
 * scan screen (over the live tracking container) so the underlying UI
 * stays interactive while the permission state is flagged.
 *
 * Subscribes to `useCameraPermissionGuard({ detectRevoke: true })`:
 *   - Renders only when `status ∈ { 'denied', 'revoked' }`.
 *   - Auto-dismisses when the status returns to `'granted'` (no manual
 *     close button — the banner is its own signal).
 *   - Pressable invokes `Linking.openSettings()` and, on some platforms,
 *     a subsequent app-foreground triggers the hook's refresh() so the
 *     banner disappears without a rerender push from the parent.
 *
 * Accessibility:
 *   - The whole banner is an accessible button (role + label).
 *   - `accessibilityLiveRegion="polite"` so screen readers announce the
 *     banner when it appears without interrupting in-progress speech.
 */
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';

import {
  useCameraPermissionGuard,
  type UseCameraPermissionGuardOptions,
} from '@/hooks/use-camera-permission-guard';

export interface CameraPermissionBannerProps {
  /**
   * Pass-through to `useCameraPermissionGuard`. Defaults to
   * `{ detectRevoke: true }` per #542 acceptance criteria.
   */
  options?: UseCameraPermissionGuardOptions;
  /**
   * A17: called when the permission transitions from denied/revoked/
   * undetermined back to granted so the parent can restart tracking.
   */
  onResume?: () => void;
  /**
   * Optional testID override.
   */
  testID?: string;
}

export function CameraPermissionBanner({
  options,
  onResume,
  testID = 'camera-permission-banner',
}: CameraPermissionBannerProps) {
  const { status, openSettings } = useCameraPermissionGuard({
    detectRevoke: true,
    ...options,
  });
  const [permission, requestPermission] = useCameraPermissions();

  // A17: when permission flips to granted, fire onResume() exactly once
  // per transition so the host can restart whatever tracking needed the
  // camera. We track the previous status via a ref so we don't re-fire
  // on every re-render.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (
      (prev === 'denied' || prev === 'revoked' || prev === 'unknown') &&
      status === 'granted'
    ) {
      onResume?.();
    }
    prevStatusRef.current = status;
  }, [status, onResume]);

  // A17: when permission is 'undetermined' (never asked), the banner
  // offers an inline "Allow camera" button that invokes
  // requestCameraPermissionsAsync() directly. No need to bounce through
  // Settings for a first-time ask. We detect undetermined via the raw
  // expo-camera hook — the guard maps both never-asked and denied to
  // "denied" once it has a non-null value.
  const isUndetermined =
    permission?.status === 'undetermined' ||
    (permission?.canAskAgain === true && permission?.granted === false);
  if (isUndetermined) {
    return (
      <View
        style={[styles.banner, styles.bannerUndetermined]}
        accessibilityLiveRegion="polite"
        testID={`${testID}-undetermined`}
      >
        <View style={styles.iconBubble}>
          <Ionicons name="videocam-outline" size={18} color="#FFFFFF" />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>Allow camera for live tracking</Text>
          <Text style={styles.subtitle}>
            We only use frames on-device — no video leaves your phone.
          </Text>
        </View>
        <Pressable
          onPress={() => {
            void requestPermission();
          }}
          style={({ pressed }) => [styles.allowButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Allow camera access"
          testID={`${testID}-allow-button`}
        >
          <Text style={styles.allowButtonText}>Allow</Text>
        </Pressable>
      </View>
    );
  }

  if (status !== 'denied' && status !== 'revoked') {
    // granted (or other unknown) — banner auto-dismisses. onResume has
    // already fired via the effect above on the transition.
    return null;
  }

  const handlePress = () => {
    void openSettings();
  };

  return (
    <Pressable
      onPress={handlePress}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Camera access required. Tap to open Settings."
      accessibilityHint="Opens the iOS Settings app so you can grant camera access to Form Factor."
      accessibilityLiveRegion="polite"
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={styles.iconBubble}>
        <Ionicons name="videocam-off" size={18} color="#FFFFFF" />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Camera access required</Text>
        <Text style={styles.subtitle}>Tap to grant</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(180, 30, 30, 0.94)',
    borderWidth: 1,
    borderColor: '#FF6B6B',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bannerUndetermined: {
    backgroundColor: 'rgba(20, 45, 82, 0.94)',
    borderColor: '#4C8CFF',
  },
  pressed: {
    opacity: 0.85,
  },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  body: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: '#FFE0DC',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  allowButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#4C8CFF',
  },
  allowButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default CameraPermissionBanner;
