import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export interface StartSessionCtaProps {
  /** Optional override — used mostly for tests. Defaults to pushing to scan-arkit. */
  onPress?: () => void;
}

export function StartSessionCta({ onPress }: StartSessionCtaProps) {
  const router = useRouter();
  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    router.push('/(tabs)/scan-arkit');
  };
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Start form session"
      onPress={handlePress}
      style={styles.button}
      activeOpacity={0.85}
      testID="start-session-cta"
    >
      <Ionicons name="scan-outline" size={18} color="#0B0F1C" />
      <Text style={styles.label}>Start form session</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#4C8CFF',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    color: '#0B0F1C',
    fontSize: 15,
    fontWeight: '700',
  },
});
