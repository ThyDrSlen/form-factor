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
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
   * Optional testID override.
   */
  testID?: string;
}

export function CameraPermissionBanner({
  options,
  testID = 'camera-permission-banner',
}: CameraPermissionBannerProps) {
  const { status, openSettings } = useCameraPermissionGuard({
    detectRevoke: true,
    ...options,
  });

  if (status !== 'denied' && status !== 'revoked') {
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
});

export default CameraPermissionBanner;
