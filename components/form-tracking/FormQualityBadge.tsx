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
 *
 * When `onPress` is provided the badge becomes a tappable button so the
 * caller can open the FQI explainer modal. A subtle "ⓘ" affordance is
 * shown in that mode so users know the pill is interactive; accessibility
 * metadata switches from `image` to `button` automatically.
 */
import React, { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getFqiColor } from './FqiGauge';

export interface FormQualityBadgeProps {
  /** Session-average form quality score, 0-100, or null when unavailable. */
  score: number | null | undefined;
  /** Optional style override. */
  style?: StyleProp<ViewStyle>;
  /** Optional testID. */
  testID?: string;
  /**
   * Tap handler. When provided the badge wraps itself in a Pressable,
   * shows an info affordance, and exposes button-role a11y. When omitted,
   * the badge renders as a plain, non-interactive pill (its original
   * history-card behaviour).
   */
  onPress?: () => void;
  /** Override the default "Tap to learn what this score means" hint. */
  accessibilityHint?: string;
}

export function FormQualityBadge({
  score,
  style,
  testID,
  onPress,
  accessibilityHint,
}: FormQualityBadgeProps) {
  const rounded = useMemo(() => {
    if (score == null || !Number.isFinite(score)) return null;
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [score]);

  const colors = useMemo(() => getFqiColor(rounded), [rounded]);

  if (rounded == null) return null;

  const resolvedTestID = testID ?? 'form-quality-badge';
  const a11yLabel = `Form quality ${rounded} out of 100`;
  const interactive = typeof onPress === 'function';
  const hint = accessibilityHint ?? 'Tap to learn what this score means';

  const content = (
    <>
      <View style={[styles.dot, { backgroundColor: colors.fill }]} />
      <Text style={[styles.score, { color: colors.fill }]}>{rounded}</Text>
      <Text style={[styles.label, { color: colors.fill }]}>FORM</Text>
      {interactive ? (
        <Ionicons
          name="information-circle-outline"
          size={12}
          color={colors.fill}
          style={styles.infoIcon}
          testID={`${resolvedTestID}-info-icon`}
        />
      ) : null}
    </>
  );

  const containerStyle = [
    styles.container,
    { borderColor: colors.fill, backgroundColor: colors.track },
    style,
  ];

  if (interactive) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [...containerStyle, pressed && styles.pressed]}
        testID={resolvedTestID}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={hint}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={containerStyle}
      testID={resolvedTestID}
      accessibilityLabel={a11yLabel}
    >
      {content}
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
  infoIcon: {
    marginLeft: 2,
    opacity: 0.85,
  },
  pressed: {
    opacity: 0.7,
  },
});

export default FormQualityBadge;
