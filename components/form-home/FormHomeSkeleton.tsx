/**
 * FormHomeSkeleton (wave-30 A6).
 *
 * Placeholder cards that match the final-state dimensions of the form-home
 * tab so the layout doesn't jump when real data resolves. Rendered while
 * `formHome.loading === true && formHome.data == null` (first-paint before
 * any cached data is available).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

interface ShimmerBlockProps {
  width?: number | string;
  height?: number;
  style?: object;
}

function ShimmerBlock({ width = '100%', height = 14, style }: ShimmerBlockProps) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.8,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.shimmer,
        { width: width as number, height, opacity },
        style,
      ]}
    />
  );
}

export function FormHomeSkeleton({ testID = 'form-home-skeleton' }: { testID?: string }) {
  return (
    <View testID={testID} accessibilityLabel="Loading form data" style={styles.root}>
      {/* Today card */}
      <View style={[styles.card, styles.todayCard]}>
        <ShimmerBlock width={120} height={16} />
        <View style={styles.valueRow}>
          <ShimmerBlock width={60} height={30} />
          <ShimmerBlock width={60} height={30} />
          <ShimmerBlock width={60} height={30} />
        </View>
        <ShimmerBlock width={80} height={12} />
      </View>

      {/* Weekly trend card */}
      <View style={[styles.card, styles.trendCard]}>
        <ShimmerBlock width={140} height={16} />
        <ShimmerBlock width="100%" height={120} style={{ marginTop: 12 }} />
      </View>

      {/* Heatmap card */}
      <View style={[styles.card, styles.heatmapCard]}>
        <ShimmerBlock width={100} height={16} />
        <ShimmerBlock width="100%" height={60} style={{ marginTop: 12 }} />
      </View>

      {/* Start-session CTA placeholder */}
      <View style={[styles.card, styles.ctaCard]}>
        <ShimmerBlock width="60%" height={20} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14,
  },
  card: {
    backgroundColor: '#0F2339',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    gap: 12,
  },
  todayCard: {
    // Match TodayFqiCard intrinsic height.
    minHeight: 132,
  },
  trendCard: {
    minHeight: 180,
  },
  heatmapCard: {
    minHeight: 110,
  },
  ctaCard: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  shimmer: {
    backgroundColor: '#1B2E4A',
    borderRadius: 6,
  },
});

export default FormHomeSkeleton;
