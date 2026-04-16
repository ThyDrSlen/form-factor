/**
 * FqiGaugeShapeOverlay
 *
 * Composition sibling to the PR #424 FqiGauge. Stacks a colour-blind-safe
 * shape (dot / bar / check) inside the gauge so users who cannot
 * distinguish red/yellow/green still see a meaningful visual delta.
 *
 * Parent is responsible for positioning this overlay on top of the gauge
 * (e.g. absolute positioned inside the ring). This file never imports or
 * mutates the FqiGauge component itself.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { selectFqiColor, selectFqiShape } from '@/lib/a11y/color-blind-palette';
import { useColorBlindMode } from '@/lib/a11y/useColorBlindMode';
import { AccessibleText } from '@/lib/a11y/AccessibleText';

export interface FqiGaugeShapeOverlayProps {
  /** Current FQI score 0-100. */
  score: number;
  /** Optional explicit size in pt. Defaults to 28. */
  size?: number;
  /** Optional testID for UI tests. */
  testID?: string;
}

export function FqiGaugeShapeOverlay({
  score,
  size = 28,
  testID,
}: FqiGaugeShapeOverlayProps) {
  const { mode, palette } = useColorBlindMode();
  const shape = selectFqiShape(score);
  const color = selectFqiColor(score, mode);
  const a11yLabel = `Form quality ${Math.round(score)} — ${shape === 'check' ? 'good' : shape === 'bar' ? 'caution' : 'critical'}`;

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      pointerEvents="none"
      testID={testID}
      accessible
      accessibilityLabel={a11yLabel}
      accessibilityRole="image"
    >
      {shape === 'check' ? (
        <Ionicons name="checkmark-circle" size={size} color={color} accessible={false} />
      ) : shape === 'bar' ? (
        <View style={[styles.bar, { backgroundColor: color, width: size * 0.7, height: size * 0.18 }]} />
      ) : (
        <View style={[styles.dot, { backgroundColor: color, width: size * 0.45, height: size * 0.45, borderRadius: size * 0.225 }]} />
      )}
      {/* High-contrast mode surfaces the numeric score for users who turn
           every colour off. */}
      {mode === 'high-contrast' ? (
        <AccessibleText style={[styles.label, { color: palette.good }]}>
          {Math.round(score)}
        </AccessibleText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    borderRadius: 3,
  },
  dot: {},
  label: {
    position: 'absolute',
    bottom: -14,
    fontSize: 11,
    fontWeight: '700',
  },
});

export default FqiGaugeShapeOverlay;
