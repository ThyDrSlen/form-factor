/**
 * EmptySessionState
 *
 * Friendly empty-state card shown when a user has never completed a
 * form-tracking session yet. Rendered by `app/(modals)/session-history.tsx`
 * when `sessions.length === 0 && !isLoading`.
 *
 * The CTA routes into `/(tabs)/scan-arkit` to begin their first session.
 * Pure presentational — does not fetch data or call services itself.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export interface EmptySessionStateProps {
  /** Optional override for the CTA tap handler (useful in tests / storybook). */
  onStartPress?: () => void;
  /** Optional testID — defaults to `empty-session-state`. */
  testID?: string;
}

export function EmptySessionState({ onStartPress, testID = 'empty-session-state' }: EmptySessionStateProps) {
  const router = useRouter();

  const handlePress = useCallback(() => {
    if (onStartPress) {
      onStartPress();
      return;
    }
    router.push('/(tabs)/scan-arkit');
  }, [onStartPress, router]);

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.iconCircle}>
        <Ionicons name="barbell-outline" size={40} color="#4C8CFF" />
      </View>
      <Text style={styles.title}>No sessions yet</Text>
      <Text style={styles.subtitle}>
        Start your first form-tracking session to see analytics here.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start your first form-tracking session"
        onPress={handlePress}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        testID={`${testID}-cta`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="sparkles" size={18} color="#FFFFFF" />
        <Text style={styles.ctaText}>Start tracking</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 12,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.3)',
  },
  title: {
    color: '#F5F7FF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: '#9AACD1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 22,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#4C8CFF',
  },
  ctaPressed: {
    backgroundColor: '#3B76E0',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

export default EmptySessionState;
