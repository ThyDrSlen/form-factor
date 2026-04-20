/**
 * FormQualityBadge
 *
 * Compact pill surfaced on workout history cards so users can scan their
 * sessions for form quality at a glance without tapping through. Reuses
 * the shared FQI color tiers from FqiGauge (`getFqiColor`) so the badge
 * and the live gauge stay visually consistent.
 *
 * Renders null when the score is missing — cards without form data show
 * no badge rather than a hollow "--" placeholder.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { getFqiColor } from './FqiGauge';

export interface FormQualityBadgeProps {
  /** Session-average form quality score, 0-100, or null when unavailable. */
  score: number | null | undefined;
  /** Optional style override. */
  style?: StyleProp<ViewStyle>;
  /** Optional testID. */
  testID?: string;
}

export function FormQualityBadge({ score, style, testID }: FormQualityBadgeProps) {
  const rounded = useMemo(() => {
    if (score == null || !Number.isFinite(score)) return null;
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [score]);

  const colors = useMemo(() => getFqiColor(rounded), [rounded]);

  if (rounded == null) return null;

  return (
    <View
      style={[styles.container, { borderColor: colors.fill, backgroundColor: colors.track }, style]}
      testID={testID ?? 'form-quality-badge'}
      accessibilityLabel={`Form quality ${rounded} out of 100`}
    >
      <View style={[styles.dot, { backgroundColor: colors.fill }]} />
      <Text style={[styles.score, { color: colors.fill }]}>{rounded}</Text>
      <Text style={[styles.label, { color: colors.fill }]}>FORM</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  score: {
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    opacity: 0.85,
  },
});

export default FormQualityBadge;
