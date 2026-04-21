/**
 * SessionCompareToLastCard
 *
 * Post-session "compare to last session" summary — three headline deltas
 * (reps, form quality, avg rest time) color-coded for a one-glance sense
 * of progress vs. the user's most recent prior session on the same lift.
 *
 * Not a full-featured comparison (the existing
 * {@link SessionComparisonCard} handles ROM / symmetry / fault diffs);
 * this tile is tuned for the debrief flow where density and low cognitive
 * load matter more than completeness. When the user taps it we jump to
 * the dedicated `form-comparison` modal for the richer view.
 *
 * Renders null when there is no prior session — callers should gate on
 * `comparison?.priorSessionId` and skip mounting.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SessionComparison } from '@/lib/services/session-comparison-aggregator';

export interface SessionCompareToLastCardProps {
  comparison: SessionComparison;
  /**
   * Optional tap handler. When provided, the whole card becomes pressable
   * and should route to the full comparison modal. When omitted the card
   * renders as a plain non-interactive summary.
   */
  onPress?: () => void;
  testID?: string;
}

interface DeltaSpec {
  label: string;
  value: number | null;
  /**
   * True when a positive delta is an improvement (reps). False when a
   * negative delta is the improvement (avg rest time reduction). Ignored
   * for FQI which uses a dedicated formatter with explicit sign/color.
   */
  positiveIsBetter: boolean;
  /** Unit suffix appended to the delta text, e.g. " reps", "s". */
  suffix: string;
  /** Optional leading icon. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Explicit tone override (used by FQI which isn't a simple count). */
  tone?: 'neutral' | 'positive' | 'negative';
  /** Custom formatted value, overrides numeric rendering. */
  valueText?: string;
  /** testID suffix — defaults to `delta-<slug>`. */
  key: string;
}

function formatSigned(value: number | null, suffix: string, fractional = false): string {
  if (value == null) return '—';
  const rounded = fractional ? Math.round(value * 10) / 10 : Math.round(value);
  if (rounded === 0) return `±0${suffix}`;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}${suffix}`;
}

function deltaTone(value: number | null, positiveIsBetter: boolean): 'neutral' | 'positive' | 'negative' {
  if (value == null || Math.abs(value) < 0.01) return 'neutral';
  const improved = positiveIsBetter ? value > 0 : value < 0;
  return improved ? 'positive' : 'negative';
}

function toneColor(tone: 'neutral' | 'positive' | 'negative'): string {
  if (tone === 'positive') return '#3CC8A9';
  if (tone === 'negative') return '#EF4444';
  return '#9AACD1';
}

export function SessionCompareToLastCard({
  comparison,
  onPress,
  testID = 'session-compare-to-last-card',
}: SessionCompareToLastCardProps) {
  if (!comparison.priorSessionId) return null;

  const deltas: DeltaSpec[] = [
    {
      key: 'reps',
      label: 'Reps',
      value: comparison.repCountDelta,
      positiveIsBetter: true,
      suffix: ' reps',
      icon: 'repeat-outline',
    },
    {
      key: 'fqi',
      label: 'Form Quality',
      value: comparison.fqiDelta,
      positiveIsBetter: true,
      suffix: ' form quality',
      icon: 'pulse-outline',
    },
    {
      key: 'rest',
      label: 'Avg rest',
      value: comparison.restDeltaSec,
      // Shorter rest ("negative delta") is generally a conditioning win;
      // longer rest can be a strength-block positive. We color it only as
      // neutral / context — not pass/fail.
      positiveIsBetter: false,
      suffix: 's',
      icon: 'timer-outline',
      // Override tone to neutral so we never accuse the athlete of a
      // regression on a metric that lacks inherent direction.
      tone: 'neutral',
    },
  ];

  const inner = (
    <View style={styles.card} testID={testID}>
      <View style={styles.header}>
        <Ionicons name="trending-up" size={16} color="#4C8CFF" />
        <Text style={styles.title}>Compare to last session</Text>
        {onPress ? (
          <Ionicons
            name="chevron-forward"
            size={16}
            color="#9AACD1"
            style={styles.chevron}
          />
        ) : null}
      </View>
      <View style={styles.deltaRow}>
        {deltas.map((d) => {
          const tone = d.tone ?? deltaTone(d.value, d.positiveIsBetter);
          const color = toneColor(tone);
          const fractional = d.key === 'fqi' || d.key === 'rest';
          const text = d.valueText ?? formatSigned(d.value, '', fractional);
          return (
            <View
              key={d.key}
              style={styles.deltaCell}
              testID={`${testID}-delta-${d.key}`}
            >
              <View style={styles.deltaHeader}>
                <Ionicons name={d.icon} size={12} color="#C9D7F4" />
                <Text style={styles.deltaLabel}>{d.label}</Text>
              </View>
              <Text style={[styles.deltaValue, { color }]} testID={`${testID}-delta-${d.key}-value`}>
                {text}
              </Text>
              <Text style={styles.deltaUnit}>{d.suffix.trim()}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  if (!onPress) return inner;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Compare to last session"
      accessibilityHint="Opens the full session comparison"
      style={({ pressed }) => [pressed && styles.pressed]}
      testID={`${testID}-pressable`}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F2339',
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#F5F7FF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  chevron: {
    marginLeft: 'auto',
  },
  deltaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  deltaCell: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  deltaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deltaLabel: {
    color: '#C9D7F4',
    fontFamily: 'Lexend_500Medium',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  deltaValue: {
    fontFamily: 'Lexend_700Bold',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  deltaUnit: {
    color: '#6F80A0',
    fontFamily: 'Lexend_400Regular',
    fontSize: 11,
  },
  pressed: {
    opacity: 0.8,
  },
});

export default SessionCompareToLastCard;
