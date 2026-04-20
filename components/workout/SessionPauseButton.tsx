/**
 * SessionPauseButton
 *
 * Header-affordance icon button that toggles the active workout session
 * between paused and running. Designed to drop into the existing
 * workout-session header next to the other circular icon buttons
 * (timer, ellipsis) and reuse the `headerButton` circular style.
 *
 * Accessibility:
 *  - `accessibilityRole="button"` + `accessibilityState={{ busy: isPaused }}`
 *  - Label flips between "Pause workout" / "Resume workout"
 *  - Hint tells the user what tapping does
 */

import React, { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import { useSessionRunner } from '@/lib/stores/session-runner';

interface SessionPauseButtonProps {
  /**
   * Optional override if a caller wants the button disabled (e.g. while the
   * session is loading). Defaults to enabled whenever a session exists.
   */
  disabled?: boolean;
  /**
   * Optional test-id so screen-level tests can locate the button reliably
   * across theme refactors.
   */
  testID?: string;
}

export default function SessionPauseButton({ disabled, testID }: SessionPauseButtonProps) {
  const isPaused = useSessionRunner((s) => s.isPaused);
  const hasSession = useSessionRunner((s) => s.activeSession != null);
  const pauseSession = useSessionRunner((s) => s.pauseSession);
  const resumeSession = useSessionRunner((s) => s.resumeSession);

  const isDisabled = disabled || !hasSession;

  const handlePress = useCallback(() => {
    if (isDisabled) return;
    if (isPaused) {
      resumeSession();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      pauseSession('user');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, [isDisabled, isPaused, pauseSession, resumeSession]);

  const label = isPaused ? 'Resume workout' : 'Pause workout';
  const hint = isPaused
    ? 'Resumes the workout timer and rest countdown'
    : 'Pauses the workout timer and rest countdown';

  return (
    <TouchableOpacity
      style={styles.headerButton}
      onPress={handlePress}
      disabled={isDisabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: isDisabled, busy: isPaused }}
      testID={testID ?? 'session-pause-button'}
    >
      <Ionicons
        name={isPaused ? 'play' : 'pause'}
        size={20}
        color={colors.accent}
      />
    </TouchableOpacity>
  );
}
