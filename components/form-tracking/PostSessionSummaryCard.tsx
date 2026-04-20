/**
 * PostSessionSummaryCard
 *
 * Renders a short narrative summary at the top of the workout session
 * screen once a session has ended: duration, rep/volume totals, the
 * top form insight (highest-priority fault across the session), and a
 * link to the full insights modal.
 *
 * Pure UI — caller computes metrics. This is intentionally a "dumb"
 * component to keep it trivially testable and safely reusable in the
 * post-workout recap sheet and the history feed.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import FqiGauge from './FqiGauge';

export interface PostSessionMetric {
  label: string;
  value: string;
  /** Optional sub-label (e.g., units). */
  hint?: string;
}

export interface PostSessionInsight {
  /** Headline for the top form takeaway (e.g., "Range of motion"). */
  title: string;
  /** One-sentence plain-english body. */
  body: string;
  /** Icon bucket for a quick visual mark. */
  kind?: 'positive' | 'neutral' | 'warning';
}

export interface PostSessionSummaryCardProps {
  /** Session's average or final FQI (0-100). Pass null if unavailable. */
  averageFqi: number | null;
  /** A short human-readable title (e.g., "Tuesday upper push"). */
  title?: string;
  /** Duration string (e.g., "48:20"). */
  durationLabel?: string;
  /** Three or four key metrics to render in a compact grid. */
  metrics: PostSessionMetric[];
  /** Optional top insight — the component hides the insight row if null. */
  insight?: PostSessionInsight | null;
  /** Label for the "View Full Analysis" link. */
  analyzeLabel?: string;
  /** Tap handler for "View Full Analysis". */
  onAnalyze?: () => void;
  /** Optional style override (e.g., margin). */
  style?: StyleProp<ViewStyle>;
  /** Optional testID for component tests. */
  testID?: string;
}

const INSIGHT_PALETTE: Record<NonNullable<PostSessionInsight['kind']>, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  positive: { icon: 'checkmark-circle', color: '#3CC8A9' },
  neutral: { icon: 'information-circle', color: '#4C8CFF' },
  warning: { icon: 'alert-circle', color: '#FFC244' },
};

export default function PostSessionSummaryCard({
  averageFqi,
  title,
  durationLabel,
  metrics,
  insight,
  analyzeLabel = 'View Full Analysis',
  onAnalyze,
  style,
  testID,
}: PostSessionSummaryCardProps) {
  const insightPalette = insight ? INSIGHT_PALETTE[insight.kind ?? 'neutral'] : null;

  return (
    <View
      style={[styles.card, style]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={
        title
          ? `${title}. ${durationLabel ?? ''}. Average form quality ${
              averageFqi == null ? 'not available' : Math.round(averageFqi)
            }`
          : `Session summary. Average form quality ${
              averageFqi == null ? 'not available' : Math.round(averageFqi)
            }`
      }
      testID={testID ?? 'post-session-summary-card'}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {durationLabel ? (
            <Text style={styles.subtitle}>{durationLabel}</Text>
          ) : null}
        </View>
        <FqiGauge score={averageFqi} size="sm" testID="post-session-fqi-gauge" />
      </View>

      <View style={styles.metricsGrid}>
        {metrics.map((m) => (
          <View key={m.label} style={styles.metricCell}>
            <Text style={styles.metricValue} numberOfLines={1}>
              {m.value}
              {m.hint ? (
                <Text style={styles.metricHint}>{` ${m.hint}`}</Text>
              ) : null}
            </Text>
            <Text style={styles.metricLabel} numberOfLines={1}>
              {m.label}
            </Text>
          </View>
        ))}
      </View>

      {insight && insightPalette ? (
        <View
          style={[styles.insightRow, { borderLeftColor: insightPalette.color }]}
          accessible
          accessibilityLabel={`Top form insight: ${insight.title}. ${insight.body}`}
          testID="post-session-insight"
        >
          <Ionicons name={insightPalette.icon} size={20} color={insightPalette.color} />
          <View style={styles.insightBody}>
            <Text style={styles.insightTitle}>{insight.title}</Text>
            <Text style={styles.insightText}>{insight.body}</Text>
          </View>
        </View>
      ) : null}

      {onAnalyze ? (
        <TouchableOpacity
          onPress={onAnalyze}
          accessibilityRole="button"
          accessibilityLabel={analyzeLabel}
          style={styles.analyzeButton}
          testID="post-session-analyze"
        >
          <Text style={styles.analyzeText}>{analyzeLabel}</Text>
          <Ionicons name="chevron-forward" size={16} color="#4C8CFF" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(15, 35, 57, 0.9)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    padding: 16,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  subtitle: {
    color: '#9AACD1',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCell: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: 'rgba(76, 140, 255, 0.08)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  metricValue: {
    color: '#F5F7FF',
    fontSize: 17,
    fontWeight: '800',
  },
  metricHint: {
    color: '#9AACD1',
    fontSize: 11,
    fontWeight: '600',
  },
  metricLabel: {
    color: '#9AACD1',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingLeft: 12,
    paddingVertical: 8,
    borderLeftWidth: 3,
  },
  insightBody: {
    flex: 1,
  },
  insightTitle: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  insightText: {
    color: '#BCCFE8',
    fontSize: 12,
    lineHeight: 17,
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
  },
  analyzeText: {
    color: '#4C8CFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
