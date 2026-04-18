/**
 * SessionPausedOverlay
 *
 * Full-screen overlay shown while the active workout session is paused.
 * Displays a "Session paused" title, a live "paused for" duration that
 * ticks every second, a Resume primary CTA, and an optional End session
 * secondary CTA.
 *
 * Accessibility:
 *  - `accessibilityViewIsModal` traps VoiceOver focus inside the overlay.
 *  - The duration text uses `accessibilityLiveRegion="polite"` so screen
 *    readers announce updates without interrupting.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';

import { useSessionRunner } from '@/lib/stores/session-runner';
import { colors } from '@/styles/workout-session.styles';

interface SessionPausedOverlayProps {
  /**
   * Optional end-session hook. When provided, renders a secondary "End session"
   * button that invokes this callback instead of calling `finishSession`
   * directly, letting the caller present a confirm prompt first.
   */
  onEndSession?: () => void;
  testID?: string;
}

function formatPausedDuration(totalMs: number): string {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function SessionPausedOverlay({
  onEndSession,
  testID,
}: SessionPausedOverlayProps) {
  const isPaused = useSessionRunner((s) => s.isPaused);
  const pausedAt = useSessionRunner((s) => s.pausedAt);
  const totalPausedMs = useSessionRunner((s) => s.totalPausedMs);
  const resumeSession = useSessionRunner((s) => s.resumeSession);

  const [displayMs, setDisplayMs] = useState(0);

  useEffect(() => {
    if (!isPaused || pausedAt == null) {
      setDisplayMs(0);
      return;
    }

    const tick = () => {
      const pausedFor = Date.now() - pausedAt;
      setDisplayMs(totalPausedMs + Math.max(0, pausedFor));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isPaused, pausedAt, totalPausedMs]);

  const handleResume = useCallback(() => {
    resumeSession();
  }, [resumeSession]);

  if (!isPaused) {
    return null;
  }

  const durationLabel = formatPausedDuration(displayMs);

  return (
    <MotiView
      from={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'timing', duration: 250 }}
      style={styles.overlay}
      accessibilityViewIsModal
      testID={testID ?? 'session-paused-overlay'}
    >
      <View style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">
          Session paused
        </Text>
        <Text style={styles.subtitle}>
          Your workout timer and rest countdown are on hold.
        </Text>

        <Text
          style={styles.duration}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Paused for ${durationLabel}`}
          testID="session-paused-duration"
        >
          {durationLabel}
        </Text>
        <Text style={styles.durationLabel}>Paused for</Text>

        <Pressable
          onPress={handleResume}
          style={({ pressed }) => [styles.resumeBtn, pressed && styles.resumeBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Resume workout"
          accessibilityHint="Resumes the workout timer and rest countdown"
          testID="session-paused-resume"
        >
          <Text style={styles.resumeBtnText}>Resume workout</Text>
        </Pressable>

        {onEndSession ? (
          <Pressable
            onPress={onEndSession}
            style={({ pressed }) => [styles.endBtn, pressed && styles.endBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="End session"
            accessibilityHint="Ends the workout and saves progress"
            testID="session-paused-end"
          >
            <Text style={styles.endBtnText}>End session</Text>
          </Pressable>
        ) : null}
      </View>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6, 16, 28, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 100,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.cardSurface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontFamily: 'Lexend_700Bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Lexend_400Regular',
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  duration: {
    fontSize: 48,
    fontFamily: 'Lexend_700Bold',
    color: colors.accent,
    marginBottom: 4,
  },
  durationLabel: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 24,
  },
  resumeBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    marginBottom: 12,
  },
  resumeBtnPressed: {
    opacity: 0.8,
  },
  resumeBtnText: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: '#fff',
  },
  endBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  endBtnPressed: {
    opacity: 0.6,
  },
  endBtnText: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: colors.error,
  },
});
