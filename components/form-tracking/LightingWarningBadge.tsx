/**
 * LightingWarningBadge
 *
 * Tri-state badge surfaced in the scan-arkit badge row:
 *   - bucket = `good`  → hidden (returns null)
 *   - bucket = `dim`   → solid yellow chip "Low light"
 *   - bucket = `dark`  → red chip with pulsing opacity "Lighting too dark"
 *
 * Pulse animation only fires for `dark` to draw the user's eye to a real
 * blocker. `dim` is informational and does not pulse.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LightingBucket } from '@/lib/services/lighting-detector';

export interface LightingWarningBadgeProps {
  bucket: LightingBucket | null;
  /** Optional extra style (e.g., for absolute positioning in scan-arkit). */
  style?: ViewStyle;
  /** Optional override for the testID — used by accessibility tests. */
  testID?: string;
}

const COPY: Record<Exclude<LightingBucket, 'good'>, string> = {
  dim: 'Low light',
  dark: 'Lighting too dark',
};

const COLORS: Record<Exclude<LightingBucket, 'good'>, { bg: string; fg: string; icon: string }> = {
  dim: { bg: 'rgba(255, 196, 0, 0.92)', fg: '#1A1300', icon: '#1A1300' },
  dark: { bg: 'rgba(220, 38, 38, 0.92)', fg: '#FFFFFF', icon: '#FFFFFF' },
};

export function LightingWarningBadge({ bucket, style, testID }: LightingWarningBadgeProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (bucket !== 'dark') {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [bucket, pulse]);

  if (!bucket || bucket === 'good') return null;

  const palette = COLORS[bucket];
  const label = COPY[bucket];
  // RN's `accessibilityRole` does not include "status" — fall back to
  // "alert" for `dark` (true blocker) and "text" for `dim` (informational).
  const role = bucket === 'dark' ? 'alert' : 'text';

  return (
    <Animated.View
      accessible
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityLiveRegion={bucket === 'dark' ? 'assertive' : 'polite'}
      testID={testID ?? `lighting-warning-${bucket}`}
      style={[styles.container, { backgroundColor: palette.bg, opacity: pulse }, style]}
    >
      <Ionicons name="bulb-outline" size={14} color={palette.icon} />
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
      <View accessible={false} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

export default LightingWarningBadge;
