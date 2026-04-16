/**
 * ActiveSetBadge
 *
 * Pill rendered in the scan overlay top bar showing the active set +
 * exercise name, e.g. "Set 2 of 4 · Pull-Ups".
 *
 * Renders nothing when not bound to a session.
 */
import React from 'react';
import { StyleSheet, Text, View, type AccessibilityRole } from 'react-native';

interface ActiveSetBadgeProps {
  setLabel: string;
  exerciseName: string;
  testID?: string;
}

export function ActiveSetBadge({ setLabel, exerciseName, testID }: ActiveSetBadgeProps) {
  if (!setLabel || !exerciseName) return null;
  return (
    <View
      style={styles.container}
      testID={testID ?? 'active-set-badge'}
      accessibilityRole={'text' as AccessibilityRole}
      accessibilityLabel={`${setLabel}. ${exerciseName}`}
    >
      <View style={styles.dot} />
      <Text style={styles.primary} numberOfLines={1}>
        {setLabel}
      </Text>
      <Text style={styles.separator}>·</Text>
      <Text style={styles.secondary} numberOfLines={1}>
        {exerciseName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 22, 44, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(108, 255, 198, 0.4)',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6CFFC6',
  },
  primary: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '700',
  },
  separator: {
    color: 'rgba(220, 228, 245, 0.6)',
    fontSize: 12,
  },
  secondary: {
    color: 'rgba(220, 228, 245, 0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
});

export default ActiveSetBadge;
