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

export interface AskCoachCTAProps {
  exerciseName: string;
  repCount: number;
  averageFqi: number | null;
  topFault?: string | null;
  testID?: string;
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
}: AskCoachCTAProps) {
  const router = useRouter();

  const handlePress = useCallback(() => {
    const prefill = buildCoachPrefill({ exerciseName, repCount, averageFqi, topFault });
    router.push({
      pathname: '/(tabs)/coach',
      params: { prefill },
    } as never);
  }, [router, exerciseName, repCount, averageFqi, topFault]);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ask coach about this session"
        onPress={handlePress}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        testID={testID}
      >
        <Ionicons name="sparkles" size={18} color="#FFFFFF" />
        <Text style={styles.buttonText}>Ask coach about this session</Text>
        <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
      </Pressable>
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
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
