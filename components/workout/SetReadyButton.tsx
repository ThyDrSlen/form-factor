/**
 * SetReadyButton Component
 *
 * Deliberate "I'm ready for the next set" affordance for the rest sheet.
 * Differs from Skip: Skip means "rush past rest", SetReady means "I've
 * reset and I'm bracing for the next set intentionally." Plays a
 * medium-impact haptic when tapped so the gesture feels committed.
 */

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/workout-session.styles';

interface SetReadyButtonProps {
  onReady: () => void;
  /**
   * Whether the rest timer has reached zero. Enables visual emphasis
   * (full success color + pulse) but does not gate activation — the
   * user can commit to being ready before the full rest window ends.
   */
  restComplete?: boolean;
  /**
   * Disable the button while a commit is in flight.
   */
  disabled?: boolean;
  /**
   * Optional label override. Defaults to "I'm ready".
   */
  label?: string;
}

function SetReadyButton({
  onReady,
  restComplete = false,
  disabled = false,
  label = "I'm ready",
}: SetReadyButtonProps) {
  const handlePress = useCallback(async () => {
    if (disabled) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // Haptics are best-effort; unavailable on some platforms.
    }
    onReady();
  }, [disabled, onReady]);

  const accent = restComplete ? colors.success : colors.restActive;

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled}
      style={[
        styles.container,
        { borderColor: accent, backgroundColor: restComplete ? accent : 'transparent' },
        disabled && styles.disabled,
      ]}
      testID="set-ready-button"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
    >
      <View style={styles.row}>
        <Ionicons
          name={restComplete ? 'checkmark-circle' : 'flash-outline'}
          size={18}
          color={restComplete ? colors.background : accent}
        />
        <Text style={[styles.label, { color: restComplete ? colors.background : accent }]}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontFamily: 'Lexend_700Bold',
    fontSize: 15,
    letterSpacing: 0.5,
  },
  disabled: {
    opacity: 0.4,
  },
});

export default React.memo(SetReadyButton);
