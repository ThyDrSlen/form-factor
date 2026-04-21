/**
 * FormQualityBadgeRow
 *
 * Per-exercise badge row rendered on the workouts-tab session cards.
 * Decides between two presentations based on whether the user has
 * any FQI history for the exercise:
 *
 *   - With history (score is a finite number): delegates to the
 *     existing `FormQualityBadge` unchanged so tracked exercises keep
 *     their current visual treatment.
 *   - Without history (score is null/undefined): renders a subtle
 *     muted "Track form to unlock" pill that routes into
 *     `/(tabs)/scan-arkit`. The pill keeps a 44x44 hit target and
 *     proper accessibility metadata so the empty state is discoverable
 *     without being visually loud.
 *
 * Wrapping the decision in a single component keeps `workouts.tsx`
 * render logic simple and lets us unit-test the empty-state branch
 * without rendering the whole tab.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { FormQualityBadge } from '@/components/form-tracking/FormQualityBadge';

export interface FormQualityBadgeRowProps {
  /** Canonical exercise name (e.g. "Pull-Up"). Used for a11y labels only. */
  exerciseName?: string;
  /**
   * Most-recent session-average FQI for this exercise.
   * `null` / `undefined` → render the empty-state "Track form to unlock" pill.
   */
  score: number | null | undefined;
  /** Optional wrapping style (e.g. margins on the card). */
  style?: StyleProp<ViewStyle>;
  /** Override for the empty-state tap handler (tests / storybook). */
  onEmptyStatePress?: () => void;
  /** Optional testID — defaults to `form-quality-badge-row`. */
  testID?: string;
}

function hasFqi(score: number | null | undefined): score is number {
  return typeof score === 'number' && Number.isFinite(score);
}

export function FormQualityBadgeRow({
  exerciseName,
  score,
  style,
  onEmptyStatePress,
  testID = 'form-quality-badge-row',
}: FormQualityBadgeRowProps) {
  const router = useRouter();

  const handleEmptyPress = useCallback(() => {
    if (onEmptyStatePress) {
      onEmptyStatePress();
      return;
    }
    router.push('/(tabs)/scan-arkit');
  }, [onEmptyStatePress, router]);

  if (hasFqi(score)) {
    return (
      <View style={[styles.wrap, style]} testID={testID}>
        <FormQualityBadge score={score} />
      </View>
    );
  }

  const a11y = exerciseName
    ? `Track form for ${exerciseName} to unlock form quality`
    : 'Track form to unlock form quality';

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <Pressable
        onPress={handleEmptyPress}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="Opens the form scan tab to begin a tracked session"
        style={({ pressed }) => [styles.emptyPill, pressed && styles.emptyPillPressed]}
        testID={`${testID}-empty`}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="barbell-outline" size={14} color="#7C8FB0" />
        <Text style={styles.emptyText}>Track form to unlock</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 6,
    marginBottom: 2,
  },
  emptyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.2)',
    backgroundColor: 'rgba(154, 172, 209, 0.06)',
    alignSelf: 'flex-start',
  },
  emptyPillPressed: {
    backgroundColor: 'rgba(154, 172, 209, 0.14)',
  },
  emptyText: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

export default FormQualityBadgeRow;
