/**
 * CueShapeBadge
 *
 * Composition sibling to the PR #424 CueCard. Rendered adjacent to the
 * cue text, it adds a colour-blind-safe shape + icon prefix so users
 * who cannot parse the cue's red/yellow/green colour still understand
 * whether the cue is informational, cautionary, or critical.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { selectFqiColor } from '@/lib/a11y/color-blind-palette';
import { useColorBlindMode } from '@/lib/a11y/useColorBlindMode';
import { AccessibleText } from '@/lib/a11y/AccessibleText';

export type CueSeverity = 'info' | 'warn' | 'critical';

const SEVERITY_TO_SCORE: Record<CueSeverity, number> = {
  info: 80,
  warn: 60,
  critical: 30,
};

const SEVERITY_TO_ICON: Record<CueSeverity, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle',
  warn: 'warning',
  critical: 'alert-circle',
};

export interface CueShapeBadgeProps {
  severity: CueSeverity;
  label: string;
  testID?: string;
}

export function CueShapeBadge({ severity, label, testID }: CueShapeBadgeProps) {
  const { mode } = useColorBlindMode();
  const color = selectFqiColor(SEVERITY_TO_SCORE[severity], mode);
  const a11yLabel = `${severity === 'info' ? 'Info' : severity === 'warn' ? 'Caution' : 'Critical'}: ${label}`;

  return (
    <View
      style={[styles.wrap, { borderColor: color }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      testID={testID}
    >
      <Ionicons name={SEVERITY_TO_ICON[severity]} size={14} color={color} accessible={false} />
      <AccessibleText style={[styles.label, { color }]}>{label}</AccessibleText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});

export default CueShapeBadge;
