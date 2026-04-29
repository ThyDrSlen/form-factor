/**
 * WorkoutCardSkeleton
 *
 * Lightweight shimmer placeholder that mirrors the dimensions of a real
 * `Workout` card on the Workouts tab. Replaces the fullscreen
 * ActivityIndicator used during the cold-load path — on slow networks
 * users see the expected structure instead of a blank screen, which
 * makes the wait feel significantly shorter. Designed to stack 3-5
 * times inside `FlatList.ListEmptyComponent`.
 *
 * Keeps the visual tokens (rounded corners, border, dimensions, spacing)
 * consistent with `styles.card` / `styles.cardGradient` from
 * `styles/tabs/_workouts.styles.ts` so the transition when data arrives
 * is imperceptible.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { CARD_HEIGHT, CARD_MARGIN } from '@/styles/tabs/_workouts.styles';

export interface WorkoutCardSkeletonProps {
  /** Optional wrapping style — callers may tweak margins per context. */
  style?: StyleProp<ViewStyle>;
  /** Optional testID override — defaults to `workout-card-skeleton`. */
  testID?: string;
}

const SHIMMER_DURATION_MS = 1100;

/**
 * Single skeleton card. Consumers render 3-5 of these inside a FlatList
 * `ListEmptyComponent` while the initial fetch is in flight.
 */
export function WorkoutCardSkeleton({
  style,
  testID = 'workout-card-skeleton',
}: WorkoutCardSkeletonProps) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: SHIMMER_DURATION_MS,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: SHIMMER_DURATION_MS,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.75],
  });

  return (
    <View
      accessibilityLabel="Loading workout"
      testID={testID}
      style={[skeletonStyles.card, style]}
    >
      <View
        style={skeletonStyles.inner}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <View style={skeletonStyles.header}>
          <Animated.View style={[skeletonStyles.titleBar, { opacity }]} />
          <Animated.View style={[skeletonStyles.dateBar, { opacity }]} />
        </View>

        <View style={skeletonStyles.statsRow}>
          <Animated.View style={[skeletonStyles.statBlock, { opacity }]} />
          <Animated.View style={[skeletonStyles.statBlock, { opacity }]} />
          <Animated.View style={[skeletonStyles.statBlock, { opacity }]} />
          <Animated.View style={[skeletonStyles.statBlock, { opacity }]} />
        </View>

        <View style={skeletonStyles.footer}>
          <Animated.View style={[skeletonStyles.footerBar, { opacity }]} />
          <Animated.View style={[skeletonStyles.footerBar, { opacity }]} />
          <Animated.View style={[skeletonStyles.footerBar, { opacity }]} />
        </View>
      </View>
    </View>
  );
}

/**
 * Convenience helper: render N skeleton cards. Default of 3 matches the
 * first fold on most iOS devices.
 */
export function WorkoutCardSkeletonList({
  count = 3,
  testID = 'workout-card-skeleton-list',
}: { count?: number; testID?: string }) {
  return (
    <View testID={testID}>
      {Array.from({ length: Math.max(1, count) }).map((_, i) => (
        <WorkoutCardSkeleton key={i} testID={`workout-card-skeleton-${i}`} />
      ))}
    </View>
  );
}

const SKELETON_BG = '#12253E';
const SKELETON_FG = '#1E3659';

const skeletonStyles = StyleSheet.create({
  card: {
    marginBottom: CARD_MARGIN,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    backgroundColor: '#0F2339',
    minHeight: CARD_HEIGHT,
    overflow: 'hidden',
  },
  inner: {
    padding: 20,
    flex: 1,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleBar: {
    height: 20,
    width: '55%',
    borderRadius: 6,
    backgroundColor: SKELETON_FG,
  },
  dateBar: {
    height: 14,
    width: 60,
    borderRadius: 6,
    backgroundColor: SKELETON_BG,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  statBlock: {
    height: 36,
    width: 48,
    borderRadius: 8,
    backgroundColor: SKELETON_FG,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#1B2E4A',
    paddingTop: 12,
  },
  footerBar: {
    height: 14,
    width: 70,
    borderRadius: 6,
    backgroundColor: SKELETON_BG,
  },
});

export default WorkoutCardSkeleton;
