/**
 * PracticeSessionBadge
 *
 * A persistent "PRACTICE" pill rendered on the top-right of the practice
 * modal (and optionally on the scan surface) so users can never mistake
 * practice mode for live tracking.
 *
 * Visual language:
 *   - Amber/orange accent (distinct from the emerald "recording" accent)
 *   - Dot prefix matches the platform "recording" chip convention
 *   - Stays visible during `running` and `ended` phases; hidden in `idle`
 *
 * Part of issue #479. Pure presentational component — callers drive the
 * `phase` prop or pass a raw `visible` override.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { PracticeSessionState } from '@/lib/stores/practice-session-store';

export interface PracticeSessionBadgeProps {
  /** Current practice phase. When omitted, `visible` controls rendering. */
  phase?: PracticeSessionState['phase'];
  /** Explicit visibility override — takes precedence over `phase`. */
  visible?: boolean;
  /** Optional style override (e.g. to position absolutely within a parent). */
  style?: StyleProp<ViewStyle>;
  /** Optional short text label; defaults to `PRACTICE`. */
  label?: string;
  /** Optional accessibility label. */
  accessibilityLabel?: string;
}

export default function PracticeSessionBadge({
  phase,
  visible,
  style,
  label = 'PRACTICE',
  accessibilityLabel,
}: PracticeSessionBadgeProps): React.ReactElement | null {
  const isVisible =
    visible !== undefined
      ? visible
      : phase === 'running' || phase === 'ended';

  if (!isVisible) return null;

  return (
    <View
      style={[styles.container, style]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? `${label} mode`}
      testID="practice-session-badge"
    >
      <View style={styles.dot} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(250, 140, 22, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(250, 176, 92, 0.55)',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FAB05C',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FAB05C',
    letterSpacing: 0.8,
    fontFamily: 'Lexend_700Bold',
  },
});
