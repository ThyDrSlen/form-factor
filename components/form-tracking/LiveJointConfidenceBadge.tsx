import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface LiveJointConfidenceBadgeProps {
  /** Joint key (e.g. "left_knee") with the worst current confidence. */
  joint: string | null;
  /** Confidence 0-1. */
  confidence: number | null;
  /**
   * Confidence threshold below which the badge switches to warning state.
   * Default: 0.4.
   */
  warningThreshold?: number;
  /**
   * Confidence threshold below which the badge switches to critical state.
   * Default: 0.2.
   */
  criticalThreshold?: number;
  testID?: string;
}

export type ConfidenceTier = 'good' | 'warning' | 'critical' | 'unknown';

export function tierForConfidence(
  confidence: number | null,
  thresholds = { warning: 0.4, critical: 0.2 }
): ConfidenceTier {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'unknown';
  if (confidence < thresholds.critical) return 'critical';
  if (confidence < thresholds.warning) return 'warning';
  return 'good';
}

const TIER_COLORS: Record<ConfidenceTier, { bg: string; fg: string }> = {
  good: { bg: 'rgba(60, 200, 169, 0.18)', fg: '#3CC8A9' },
  warning: { bg: 'rgba(255, 184, 0, 0.18)', fg: '#FFB800' },
  critical: { bg: 'rgba(255, 76, 76, 0.22)', fg: '#FF4C4C' },
  unknown: { bg: 'rgba(107, 114, 128, 0.18)', fg: '#9CA3AF' },
};

function humanizeJoint(joint: string): string {
  return joint
    .replace(/_/g, ' ')
    .replace(/\bleft\b/i, 'L')
    .replace(/\bright\b/i, 'R')
    .trim();
}

export default function LiveJointConfidenceBadge({
  joint,
  confidence,
  warningThreshold = 0.4,
  criticalThreshold = 0.2,
  testID,
}: LiveJointConfidenceBadgeProps) {
  const tier = tierForConfidence(confidence, {
    warning: warningThreshold,
    critical: criticalThreshold,
  });
  const colors = TIER_COLORS[tier];
  const pct =
    typeof confidence === 'number' && Number.isFinite(confidence)
      ? `${Math.round(confidence * 100)}%`
      : '—';
  const label = joint
    ? `${humanizeJoint(joint)} confidence ${pct}`
    : `Joint confidence ${pct}`;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.fg }]}
    >
      <View style={[styles.dot, { backgroundColor: colors.fg }]} />
      <Text style={[styles.text, { color: colors.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
