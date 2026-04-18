/**
 * PR Celebration Badge
 *
 * Displayed as a transient banner in the scan/ARKit post-session modal when
 * `pr-detector.detectNewPR` returns a hit. Emits a success haptic on mount
 * and auto-dismisses after `durationMs` (default 4.5s).
 *
 * Surgical component — NOT wired into the render-tree region that PR #434
 * touched. Can be mounted anywhere in the scan post-session area.
 *
 * Issue #447 W3-C item #2.
 */

import React, { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, Text, View, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { PRResult } from '@/lib/services/pr-detector';
import { formatPRMessage } from '@/lib/services/pr-detector';

export interface PRCelebrationBadgeProps {
  pr: PRResult | null;
  unit?: 'lb' | 'kg';
  /** Auto-dismiss after this many ms. Use 0 to disable auto-dismiss. */
  durationMs?: number;
  /** Called when the badge finishes its dismiss animation (or is unmounted). */
  onDismiss?: () => void;
  /** Testing-friendly override to suppress the haptic side-effect. */
  disableHaptics?: boolean;
}

const DEFAULT_DURATION_MS = 4500;

export function PRCelebrationBadge({
  pr,
  unit = 'lb',
  durationMs = DEFAULT_DURATION_MS,
  onDismiss,
  disableHaptics = false,
}: PRCelebrationBadgeProps): React.ReactElement | null {
  const opacity = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!pr) return;

    // Celebration haptic — Success is the heaviest, most rewarding feedback.
    if (!disableHaptics && Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    if (durationMs <= 0) return;

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onDismiss?.();
      });
    }, durationMs);

    return () => {
      clearTimeout(timer);
    };
    // We intentionally key this effect only on `pr` identity — a consumer
    // that re-passes the same PR shouldn't retrigger the haptic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr]);

  if (!pr) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={styles.iconBubble} testID="pr-celebration-icon">
        <Text style={styles.icon}>🏆</Text>
      </View>
      <View style={styles.textColumn}>
        <Text style={styles.title}>Personal Record!</Text>
        <Text style={styles.body} numberOfLines={2}>
          {formatPRMessage(pr, unit)}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: '#102B1F',
    borderWidth: 1,
    borderColor: '#3DC884',
    gap: 12,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1C4433',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
  },
  textColumn: {
    flex: 1,
  },
  title: {
    color: '#B8F0CF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 14,
    marginBottom: 2,
  },
  body: {
    color: '#E6FAEE',
    fontFamily: 'Lexend_400Regular',
    fontSize: 12,
  },
});

export default PRCelebrationBadge;
