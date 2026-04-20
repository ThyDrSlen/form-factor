import React from 'react';
import { View, StyleSheet, type AccessibilityProps } from 'react-native';

export interface RepQualityDotProps extends AccessibilityProps {
  /** FQI score 0-100. Null produces a neutral grey dot. */
  fqi: number | null;
  /** Dot diameter. Default: 12. */
  size?: number;
  /** Whether the rep had faults (adds a warning ring). */
  hasFaults?: boolean;
  /** Whether the rep was flagged occluded (adds a striped style). */
  occluded?: boolean;
  /** Optional test identifier. */
  testID?: string;
}

export const HIGH_FQI_THRESHOLD = 85;
export const MID_FQI_THRESHOLD = 65;

export function colorForFqi(fqi: number | null): string {
  if (typeof fqi !== 'number' || !Number.isFinite(fqi)) return '#6B7280'; // grey
  if (fqi >= HIGH_FQI_THRESHOLD) return '#3CC8A9'; // teal
  if (fqi >= MID_FQI_THRESHOLD) return '#FFB800'; // amber
  return '#FF4C4C'; // red
}

export default function RepQualityDot({
  fqi,
  size = 12,
  hasFaults = false,
  occluded = false,
  testID,
  ...a11yProps
}: RepQualityDotProps) {
  const color = colorForFqi(fqi);
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  const label =
    typeof fqi === 'number'
      ? `Rep FQI ${fqi}${hasFaults ? ', has faults' : ''}${occluded ? ', occluded' : ''}`
      : 'Rep FQI unavailable';

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[
        styles.dot,
        dimensions,
        { backgroundColor: color },
        hasFaults ? { borderWidth: 2, borderColor: '#FFB800' } : null,
        occluded ? { opacity: 0.5 } : null,
      ]}
      {...a11yProps}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    backgroundColor: '#6B7280',
  },
});
