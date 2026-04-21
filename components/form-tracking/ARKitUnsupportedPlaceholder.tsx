/**
 * ARKitUnsupportedPlaceholder
 *
 * Full-screen empty-state shown by `app/(tabs)/scan-arkit.tsx` when the
 * device does not support ARKit body tracking (pre-iPhone 13 or non-iOS).
 *
 * Previously the screen rendered a bare warning icon + "Device not
 * supported" string, which read as an error skeleton. This component
 * replaces that with a proper empty state: icon + title + helpful
 * subtitle + secondary CTA that routes users to the Workouts tab so
 * they can still log sessions manually.
 *
 * Pure presentational — no native calls, no side effects. The caller
 * decides when to render it via `supportStatus === 'unsupported'`.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export interface ARKitUnsupportedPlaceholderProps {
  /** Optional override for the CTA tap handler (tests / storybook). */
  onGoToWorkouts?: () => void;
  /** Optional diagnostic JSON shown only in __DEV__ builds. */
  debugInfo?: unknown;
  /** Optional testID — defaults to `arkit-unsupported-placeholder`. */
  testID?: string;
}

export function ARKitUnsupportedPlaceholder({
  onGoToWorkouts,
  debugInfo,
  testID = 'arkit-unsupported-placeholder',
}: ARKitUnsupportedPlaceholderProps) {
  const router = useRouter();

  const handlePress = useCallback(() => {
    if (onGoToWorkouts) {
      onGoToWorkouts();
      return;
    }
    router.replace('/(tabs)/workouts');
  }, [onGoToWorkouts, router]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']} testID={testID}>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <Ionicons name="body-outline" size={56} color="#9AACD1" />
        </View>
        <Text style={styles.title}>Body tracking unavailable</Text>
        <Text style={styles.subtitle}>
          This device doesn&apos;t support ARKit body tracking. Please upgrade
          to iPhone 13 or newer to use live form analysis.
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to Workouts instead"
          onPress={handlePress}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          testID={`${testID}-cta`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="barbell-outline" size={18} color="#FFFFFF" />
          <Text style={styles.ctaText}>Go to Workouts instead</Text>
        </Pressable>

        {__DEV__ && debugInfo ? (
          <Text style={styles.debugText} testID={`${testID}-debug`}>
            Debug: {JSON.stringify(debugInfo, null, 2)}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 14,
  },
  iconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(154, 172, 209, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.28)',
  },
  title: {
    color: '#F5F7FF',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#9AACD1',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 22,
    minHeight: 44,
    minWidth: 220,
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
  debugText: {
    marginTop: 24,
    color: '#5D6B83',
    fontSize: 10,
    textAlign: 'center',
    fontFamily: undefined,
  },
});

export default ARKitUnsupportedPlaceholder;
