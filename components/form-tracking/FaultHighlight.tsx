/**
 * FaultHighlight — red flash outline on joints tagged by the fault
 * detector. Uses react-native-reanimated for the flash animation so
 * we get 60fps on the UI thread even when the JS thread is busy.
 *
 * Props:
 *   joints:  the Joint2D list to consider
 *   faultJointNames: names of offending joints this rep
 *   width/height: overlay canvas size
 *   triggerKey: any value that changes when a new fault fires; acts
 *               as the animation re-trigger signal
 */
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type FaultHighlightProps = {
  joints: Joint2D[] | null | undefined;
  faultJointNames: string[] | null | undefined;
  width: number;
  height: number;
  /** Change this value to re-trigger the flash. Defaults to faultJointNames.join(). */
  triggerKey?: string | number;
  /** Flash duration per pulse (ms). Defaults to 280. */
  flashDurationMs?: number;
  /** Number of pulses per trigger. Defaults to 3. */
  pulseCount?: number;
  /** Radius of the highlight ring (px). Defaults to 14. */
  radius?: number;
  /** Stroke color for the ring. Defaults to #EF4444 (red-500). */
  color?: string;
};

export function resolveTriggerKey(
  provided: string | number | undefined,
  names: string[] | null | undefined,
): string {
  if (provided !== undefined) return String(provided);
  return (names ?? []).slice().sort().join('|');
}

/**
 * Build the list of joints we need to highlight. Pure for unit tests.
 */
export function selectFaultJoints(
  joints: Joint2D[] | null | undefined,
  faultJointNames: string[] | null | undefined,
): Joint2D[] {
  if (!joints || !faultJointNames || faultJointNames.length === 0) return [];
  const names = new Set(faultJointNames);
  return joints.filter((j) => j.isTracked && names.has(j.name));
}

export function FaultHighlight({
  joints,
  faultJointNames,
  width,
  height,
  triggerKey,
  flashDurationMs = 280,
  pulseCount = 3,
  radius = 14,
  color = '#EF4444',
}: FaultHighlightProps) {
  const opacity = useSharedValue(0);
  const active = useMemo(
    () => selectFaultJoints(joints, faultJointNames),
    [joints, faultJointNames],
  );
  const resolvedTrigger = resolveTriggerKey(triggerKey, faultJointNames);

  useEffect(() => {
    if (active.length === 0) {
      cancelAnimation(opacity);
      opacity.value = 0;
      return;
    }
    cancelAnimation(opacity);
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: flashDurationMs / 2,
          easing: Easing.out(Easing.quad),
        }),
        withTiming(0, {
          duration: flashDurationMs / 2,
          easing: Easing.in(Easing.quad),
        }),
      ),
      pulseCount,
      false,
    );
  }, [resolvedTrigger, active.length, flashDurationMs, pulseCount, opacity]);

  const animatedProps = useAnimatedProps(() => ({
    opacity: opacity.value,
  }));

  if (active.length === 0) return null;

  return (
    <View
      style={[styles.container, { width, height }]}
      pointerEvents="none"
      accessibilityRole="image"
      accessibilityLabel={`Fault highlight on ${active.length} joint${active.length === 1 ? '' : 's'}`}
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {active.map((joint) => (
          <AnimatedCircle
            key={joint.name}
            cx={joint.x * width}
            cy={joint.y * height}
            r={radius}
            stroke={color}
            strokeWidth={3}
            fill="none"
            animatedProps={animatedProps}
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
