/**
 * RepCounterOverlay
 *
 * Body-anchored rep counter rendered inside the existing scan-arkit SVG
 * overlay. The number sits near the hip joint in normalized 0-1 viewBox
 * coordinates, sized to be readable mid-rep without HUD scanning.
 *
 * Visual: 48-64px, white text, drop-shadow glow for legibility against any
 * background. Uses Animated.Value so opacity transitions are smooth across
 * phase changes (rest fade, occlusion hide).
 */

import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { Text as SvgText } from 'react-native-svg';

const AnimatedSvgText = Animated.createAnimatedComponent(SvgText);

export interface RepCounterOverlayProps {
  /** Rep number to display (typically `state.repCount` from controller). */
  currentRep: number;
  /** Whether to render the overlay at all. */
  visible: boolean;
  /** Normalized x in viewBox 0-1. */
  x: number;
  /** Normalized y in viewBox 0-1. */
  y: number;
  /** Target opacity 0-1 (animated to over 200 ms). */
  opacity: number;
  /** Optional fill override (defaults to white). */
  color?: string;
  /** Font size in viewBox units. Defaults to 0.07 (~48px on a 720p crop). */
  fontSize?: number;
  /** Optional testID override. */
  testID?: string;
}

export function RepCounterOverlay({
  currentRep,
  visible,
  x,
  y,
  opacity,
  color = '#FFFFFF',
  fontSize = 0.07,
  testID,
}: RepCounterOverlayProps) {
  const animatedOpacity = useRef(new Animated.Value(0)).current;
  const targetOpacity = visible ? Math.max(0, Math.min(1, opacity)) : 0;

  useEffect(() => {
    Animated.timing(animatedOpacity, {
      toValue: targetOpacity,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [targetOpacity, animatedOpacity]);

  if (!visible && targetOpacity === 0) {
    // Skip render entirely once faded; cheap optimization for occlusion.
    return null;
  }

  return (
    <AnimatedSvgText
      x={x}
      y={y}
      fill={color}
      fontSize={fontSize}
      fontWeight="700"
      textAnchor="middle"
      alignmentBaseline="middle"
      opacity={animatedOpacity}
      testID={testID ?? 'rep-counter-overlay'}
      // A11y: react-native-svg's Text passes `accessible` and
      // `accessibilityLabel` through to the underlying native view, so
      // VoiceOver announces the current rep when the element gains focus
      // (matching the visual pulse when the digit updates). `accessibilityRole`
      // is not part of the SVG Text prop surface; consumers that need a
      // `status`-role live announcement should render a companion RN `Text`
      // with role="status" alongside the Svg tree — keeping this node's
      // role undefined avoids double-announcements from VoiceOver.
      accessible
      accessibilityLabel={`Rep ${currentRep}`}
      // SVG does not support drop-shadow filters consistently across RN
      // platforms; we fake a glow with a thin outer stroke.
      stroke="rgba(0, 0, 0, 0.45)"
      strokeWidth={fontSize * 0.05}
    >
      {currentRep}
    </AnimatedSvgText>
  );
}

export default RepCounterOverlay;

/**
 * Visually-hidden live region that announces the current rep count to
 * assistive technology. Mount this alongside the scan-arkit overlay
 * (outside the Svg tree) so VoiceOver speaks "Rep N" each time the rep
 * count advances — the SVG text node itself can't carry
 * `accessibilityRole="status"` / `accessibilityLiveRegion` because
 * react-native-svg's Text prop surface does not expose those fields.
 */
export interface RepCounterAnnouncerProps {
  /** The latest rep number to announce. */
  currentRep: number;
  /** Optional testID for component tests. */
  testID?: string;
}

export function RepCounterAnnouncer({
  currentRep,
  testID,
}: RepCounterAnnouncerProps) {
  return (
    <View
      accessible
      // RN's legacy `accessibilityRole` type does not include "status"; use
      // the ARIA-aligned `role` prop (RN 0.73+) to declare the live-region
      // role. `accessibilityLiveRegion` takes care of the actual speech on
      // Android; iOS VoiceOver honors `role="status"` for auto-announce.
      role="status"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Rep ${currentRep}`}
      style={announcerStyles.hidden}
      testID={testID ?? 'rep-counter-announcer'}
      importantForAccessibility="yes"
      pointerEvents="none"
    >
      <Text style={announcerStyles.hiddenText}>{`Rep ${currentRep}`}</Text>
    </View>
  );
}

const announcerStyles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  hiddenText: {
    fontSize: 1,
    color: 'transparent',
  },
});
