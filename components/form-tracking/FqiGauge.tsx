/**
 * FqiGauge
 *
 * Live Form Quality Index (FQI) gauge visible during a tracking set.
 *
 * Renders a circular progress ring with the numeric score (0-100) at the
 * center, color-coded for instant read:
 *   - red     < 40   (poor form)
 *   - yellow  40-69  (acceptable)
 *   - green   >= 70  (good form)
 *
 * Animates the ring + score value whenever `score` changes.
 *
 * Pure UI component — it does not compute FQI; the caller feeds the latest
 * score (typically the most recent rep). Until a first rep lands, pass
 * `score = null` to render the idle state ("--").
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { MotiView } from 'moti';

export type FqiGaugeSize = 'sm' | 'md' | 'lg';

export interface FqiGaugeProps {
  /** Latest FQI score (0-100) or null when no reps have completed yet. */
  score: number | null;
  /** Preset size. Defaults to 'md' (72px). */
  size?: FqiGaugeSize;
  /** Optional container style overrides. */
  style?: StyleProp<ViewStyle>;
  /** Optional accessible label override. Falls back to a sensible default. */
  accessibilityLabel?: string;
  /** Optional testID for component tests. */
  testID?: string;
}

const SIZE_MAP: Record<FqiGaugeSize, { diameter: number; strokeWidth: number; fontSize: number; labelSize: number }> = {
  sm: { diameter: 56, strokeWidth: 5, fontSize: 18, labelSize: 9 },
  md: { diameter: 72, strokeWidth: 6, fontSize: 22, labelSize: 10 },
  lg: { diameter: 96, strokeWidth: 8, fontSize: 30, labelSize: 12 },
};

type FqiBucket = 'poor' | 'acceptable' | 'good';

function toBucket(score: number | null): FqiBucket | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score < 40) return 'poor';
  if (score < 70) return 'acceptable';
  return 'good';
}

function bucketLabel(bucket: FqiBucket): string {
  return bucket === 'poor'
    ? 'poor'
    : bucket === 'acceptable'
      ? 'acceptable'
      : 'good';
}

/** Map an FQI score 0-100 into a semantic color bucket. */
export function getFqiColor(score: number | null): { fill: string; track: string; text: string } {
  if (score == null || Number.isNaN(score)) {
    return { fill: '#4C8CFF', track: 'rgba(76, 140, 255, 0.18)', text: '#F5F7FF' };
  }
  if (score < 40) {
    return { fill: '#FF3B30', track: 'rgba(255, 59, 48, 0.18)', text: '#FFFFFF' };
  }
  if (score < 70) {
    return { fill: '#FFC244', track: 'rgba(255, 194, 68, 0.18)', text: '#0B0F1A' };
  }
  return { fill: '#3CC8A9', track: 'rgba(60, 200, 169, 0.18)', text: '#FFFFFF' };
}

function clampScore(raw: number | null): number {
  if (raw == null || Number.isNaN(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

export default function FqiGauge({
  score,
  size = 'md',
  style,
  accessibilityLabel,
  testID,
}: FqiGaugeProps) {
  const dims = SIZE_MAP[size];
  const clamped = clampScore(score);
  const colors = useMemo(() => getFqiColor(score), [score]);

  const radius = (dims.diameter - dims.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  // Trigger a subtle pulse animation when the score changes.
  const [pulseKey, setPulseKey] = React.useState(0);
  useEffect(() => {
    if (score != null) setPulseKey((k) => k + 1);
  }, [score]);

  // Screen-reader announcement on FQI bucket changes (poor → ok → good).
  // accessibilityValue updates alone aren't reliably re-announced by
  // VoiceOver during live sessions; firing an explicit announcement when
  // the semantic bucket crosses a threshold gives a vision-impaired user
  // audible confirmation that form quality shifted. We debounce on bucket
  // rather than raw score so announcements don't stack every frame.
  const lastBucketRef = useRef<FqiBucket | null>(null);
  useEffect(() => {
    const bucket = toBucket(score);
    if (bucket === null) {
      lastBucketRef.current = null;
      return;
    }
    if (lastBucketRef.current === bucket) return;
    const prev = lastBucketRef.current;
    lastBucketRef.current = bucket;
    // Skip the first transition when there was no prior reading — the
    // accessibilityValue on mount already communicates the initial state.
    if (prev === null) return;
    AccessibilityInfo.announceForAccessibility(
      `Form quality ${bucketLabel(bucket)} — ${Math.round(clamped)} of 100`,
    );
  }, [score, clamped]);

  const displayScore = score == null ? '--' : Math.round(clamped).toString();
  const label =
    accessibilityLabel ??
    (score == null
      ? 'Form quality index, not yet measured'
      : `Form quality index ${Math.round(clamped)} out of 100`);

  return (
    <View
      style={[styles.container, { width: dims.diameter, height: dims.diameter }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        score == null
          ? { min: 0, max: 100, now: 0, text: 'Not yet measured' }
          : { min: 0, max: 100, now: Math.round(clamped) }
      }
      testID={testID ?? 'fqi-gauge'}
    >
      <Svg
        width={dims.diameter}
        height={dims.diameter}
        viewBox={`0 0 ${dims.diameter} ${dims.diameter}`}
      >
        {/* Track */}
        <Circle
          cx={dims.diameter / 2}
          cy={dims.diameter / 2}
          r={radius}
          stroke={colors.track}
          strokeWidth={dims.strokeWidth}
          fill="transparent"
        />
        {/* Progress */}
        <Circle
          cx={dims.diameter / 2}
          cy={dims.diameter / 2}
          r={radius}
          stroke={colors.fill}
          strokeWidth={dims.strokeWidth}
          strokeLinecap="round"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          // Rotate so progress starts at 12 o'clock
          transform={`rotate(-90 ${dims.diameter / 2} ${dims.diameter / 2})`}
        />
      </Svg>

      <MotiView
        key={pulseKey}
        style={StyleSheet.absoluteFill}
        from={{ opacity: 0.5, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'timing', duration: 260 }}
      >
        <View style={styles.labelStack} pointerEvents="none">
          <Text
            style={[
              styles.score,
              { fontSize: dims.fontSize, color: colors.fill },
            ]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {displayScore}
          </Text>
          <Text
            style={[styles.caption, { fontSize: dims.labelSize }]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            FQI
          </Text>
        </View>
      </MotiView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelStack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  caption: {
    marginTop: 1,
    color: '#9AACD1',
    fontWeight: '600',
    letterSpacing: 1,
  },
});
