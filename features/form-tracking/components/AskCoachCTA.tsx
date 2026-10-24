/**
 * AskCoachCTA
 *
 * Pinned footer CTA for the post-session debrief. Builds a stable "prefill"
 * string from the session summary and navigates to the Coach tab with that
 * string as a route param. Pure navigation — it does NOT call the coach
 * service or mutate state.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNetwork } from '@/contexts/NetworkContext';

export interface AskCoachCTAProps {
  exerciseName: string;
  repCount: number;
  averageFqi: number | null;
  topFault?: string | null;
  testID?: string;
  /**
   * Optional tap handler override. When provided, the CTA calls this
   * instead of navigating to the coach tab with a prefill. Used by
   * the workouts-tab rows to route into the retrospective chat modal
   * under EXPO_PUBLIC_WORKOUT_COACH_RECALL. Defaults to the original
   * coach-tab navigation so existing consumers keep working.
   */
  onPress?: () => void;
  /**
   * Optional label override; defaults to
   * "Ask coach about this session". The workouts-tab row uses a
   * shorter label to fit inside the card footer.
   */
  label?: string;
}

export function buildCoachPrefill({
  exerciseName,
  repCount,
  averageFqi,
  topFault,
}: Pick<AskCoachCTAProps, 'exerciseName' | 'repCount' | 'averageFqi' | 'topFault'>): string {
  const exercise = exerciseName?.trim() ? exerciseName.trim() : 'that lift';
  const fqiPart = averageFqi != null && Number.isFinite(averageFqi)
    ? `avg FQI ${Math.round(averageFqi)}`
    : 'avg FQI n/a';
  const faultPart = topFault?.trim()
    ? `Top fault: ${topFault.trim()}.`
    : 'No standout fault.';
  return `Just finished ${exercise}, ${repCount} reps, ${fqiPart}. ${faultPart} What should I work on?`;
}

export function AskCoachCTA({
  exerciseName,
  repCount,
  averageFqi,
  topFault,
  testID = 'ask-coach-cta',
  onPress,
  label,
}: AskCoachCTAProps) {
  const router = useRouter();
  const { isOnline } = useNetwork();

  const handlePress = useCallback(() => {
    // Offline guard: the coach tab requires network access to produce a
    // useful reply. Swallow the tap with a visual disabled state + subtext
    // rather than navigating into a broken conversation.
    if (!isOnline) return;
    if (onPress) {
      onPress();
      return;
    }
    const prefill = buildCoachPrefill({ exerciseName, repCount, averageFqi, topFault });
    router.push({
      pathname: '/(tabs)/coach',
      params: { prefill },
    } as never);
  }, [isOnline, onPress, router, exerciseName, repCount, averageFqi, topFault]);

  const buttonLabel = label ?? 'Ask coach about this session';
  const accessibilityLabel = isOnline
    ? buttonLabel
    : `${buttonLabel}. Offline — check your connection.`;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !isOnline }}
        disabled={!isOnline}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.button,
          pressed && isOnline && styles.buttonPressed,
          !isOnline && styles.buttonDisabled,
        ]}
        testID={testID}
      >
        <Ionicons name="sparkles" size={18} color="#FFFFFF" />
        <Text style={styles.buttonText}>{buttonLabel}</Text>
        <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
      </Pressable>
      {!isOnline ? (
        <Text style={styles.offlineHint} testID={`${testID}-offline-hint`}>
          Check your connection
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#4C8CFF',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 18,
  },
  buttonPressed: {
    backgroundColor: '#3B76E0',
  },
  buttonDisabled: {
    backgroundColor: '#3B5172',
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  offlineHint: {
    textAlign: 'center',
    color: '#9AACD1',
    fontSize: 12,
    marginTop: 6,
  },
});
