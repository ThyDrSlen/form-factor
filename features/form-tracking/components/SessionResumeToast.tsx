/**
 * SessionResumeToast
 *
 * Banner rendered near the top of the scan overlay when the session
 * was auto-paused (via useSessionAutopause) and the user returns to
 * the app. Tapping Resume acknowledges the pause and clears the
 * banner.
 *
 * Renders null when there's nothing to resume.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityRole } from 'react-native';

interface SessionResumeToastProps {
  visible: boolean;
  reason?: string | null;
  /** Optional label describing the last exercise to orient the user. */
  lastExerciseName?: string | null;
  onResume: () => void;
  onDismiss?: () => void;
  testID?: string;
}

export function SessionResumeToast({
  visible,
  reason,
  lastExerciseName,
  onResume,
  onDismiss,
  testID,
}: SessionResumeToastProps) {
  if (!visible) return null;

  const title = lastExerciseName
    ? `Resume ${lastExerciseName}?`
    : 'Resume previous set?';
  const subtitle = reason === 'background'
    ? 'Session paused while you were away.'
    : 'Your session is paused.';

  return (
    <View
      style={styles.container}
      testID={testID ?? 'session-resume-toast'}
      accessibilityRole={'alert' as AccessibilityRole}
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={onResume}
        style={({ pressed }) => [styles.resumeBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Resume session"
        testID={`${testID ?? 'session-resume-toast'}-resume`}
      >
        <Text style={styles.resumeText}>Resume</Text>
      </Pressable>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [styles.dismissBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Dismiss resume prompt"
          testID={`${testID ?? 'session-resume-toast'}-dismiss`}
        >
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(12, 18, 36, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(108, 255, 198, 0.45)',
  },
  body: {
    flex: 1,
    flexDirection: 'column',
  },
  title: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    color: 'rgba(220, 228, 245, 0.65)',
    fontSize: 12,
    marginTop: 1,
  },
  resumeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#6CFFC6',
  },
  resumeText: {
    color: '#0B1024',
    fontSize: 13,
    fontWeight: '700',
  },
  dismissBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  dismissText: {
    color: 'rgba(220, 228, 245, 0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
});

export default SessionResumeToast;
