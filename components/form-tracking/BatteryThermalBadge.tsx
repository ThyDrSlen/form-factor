/**
 * BatteryThermalBadge
 *
 * Color-coded chip surfaced alongside the lighting badge in scan-arkit.
 *   - badgeLevel `normal`  → hidden
 *   - badgeLevel `warn`    → yellow chip with battery percent + thermal hint
 *   - badgeLevel `critical`→ red pulsing chip + auto-pause copy
 *
 * The badge is purely presentational; auto-pause is owned by
 * `use-workout-controller`.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  DeviceBadgeLevel,
} from '@/hooks/use-device-thermal-battery';
import type { ThermalState } from '@/lib/services/thermal-monitor';

export interface BatteryThermalBadgeProps {
  badgeLevel: DeviceBadgeLevel;
  batteryLevel: number | null;
  thermalState: ThermalState;
  /** Optional extra style for absolute positioning. */
  style?: ViewStyle;
  testID?: string;
}

const PALETTE: Record<Exclude<DeviceBadgeLevel, 'normal'>, { bg: string; fg: string; icon: string }> = {
  warn: { bg: 'rgba(255, 196, 0, 0.92)', fg: '#1A1300', icon: '#1A1300' },
  critical: { bg: 'rgba(220, 38, 38, 0.92)', fg: '#FFFFFF', icon: '#FFFFFF' },
};

function formatBattery(level: number | null): string {
  if (level === null) return '--%';
  return `${Math.round(level * 100)}%`;
}

function thermalLabel(state: ThermalState): string | null {
  switch (state) {
    case 'critical':
      return 'Device too hot';
    case 'serious':
      return 'Device hot';
    case 'fair':
      return 'Device warm';
    default:
      return null;
  }
}

export function BatteryThermalBadge({
  badgeLevel,
  batteryLevel,
  thermalState,
  style,
  testID,
}: BatteryThermalBadgeProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (badgeLevel !== 'critical') {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.6, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [badgeLevel, pulse]);

  if (badgeLevel === 'normal') return null;

  const palette = PALETTE[badgeLevel];
  const thermalCopy = thermalLabel(thermalState);
  const label =
    badgeLevel === 'critical'
      ? thermalCopy ?? `Battery ${formatBattery(batteryLevel)} — pausing`
      : thermalCopy ?? `Battery ${formatBattery(batteryLevel)}`;
  const role = badgeLevel === 'critical' ? 'alert' : 'text';

  return (
    <Animated.View
      accessible
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityLiveRegion={badgeLevel === 'critical' ? 'assertive' : 'polite'}
      testID={testID ?? `battery-thermal-${badgeLevel}`}
      style={[styles.container, { backgroundColor: palette.bg, opacity: pulse }, style]}
    >
      <Ionicons
        name={badgeLevel === 'critical' ? 'flame-outline' : 'battery-half-outline'}
        size={14}
        color={palette.icon}
      />
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

export default BatteryThermalBadge;
