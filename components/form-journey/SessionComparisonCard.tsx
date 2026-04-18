import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SessionComparison } from '@/lib/services/session-comparison-aggregator';

interface Props {
  comparison: SessionComparison;
  testID?: string;
}

const TREND_COPY: Record<SessionComparison['overallTrend'], string> = {
  improving: 'Trending up',
  regressing: 'Needs attention',
  mixed: 'Mixed signals',
  unchanged: 'Holding steady',
  baseline: 'First session',
};

const TREND_ICON: Record<
  SessionComparison['overallTrend'],
  keyof typeof Ionicons.glyphMap
> = {
  improving: 'trending-up',
  regressing: 'trending-down',
  mixed: 'swap-horizontal',
  unchanged: 'remove',
  baseline: 'sparkles',
};

const TREND_COLOR: Record<SessionComparison['overallTrend'], string> = {
  improving: '#3CC8A9',
  regressing: '#EF4444',
  mixed: '#F59E0B',
  unchanged: '#6B7280',
  baseline: '#6366F1',
};

function formatSignedNumber(
  value: number | null,
  suffix: string,
  invert = false,
): string {
  if (value == null) return '—';
  const signed = invert ? -value : value;
  const sign = signed > 0 ? '+' : signed < 0 ? '' : '';
  return `${sign}${signed.toFixed(1)}${suffix}`;
}

function metricColor(
  value: number | null,
  preferHigher: boolean,
  threshold = 0.5,
): string {
  if (value == null) return '#6B7280';
  if (Math.abs(value) < threshold) return '#6B7280';
  const positive = preferHigher ? value > 0 : value < 0;
  return positive ? '#3CC8A9' : '#EF4444';
}

export function SessionComparisonCard({ comparison, testID }: Props) {
  const { currentSummary, priorSummary, overallTrend } = comparison;
  const isBaseline = overallTrend === 'baseline';

  return (
    <View style={styles.card} testID={testID ?? 'session-comparison-card'}>
      <View style={styles.header}>
        <View style={[styles.trendBadge, { backgroundColor: TREND_COLOR[overallTrend] + '22' }]}>
          <Ionicons
            name={TREND_ICON[overallTrend]}
            size={16}
            color={TREND_COLOR[overallTrend]}
          />
          <Text style={[styles.trendText, { color: TREND_COLOR[overallTrend] }]}>
            {TREND_COPY[overallTrend]}
          </Text>
        </View>
        <Text style={styles.exerciseLabel}>{currentSummary.exerciseId}</Text>
      </View>

      {isBaseline ? (
        <Text style={styles.baselineMessage}>
          No prior session for {currentSummary.exerciseId} yet — this is your
          baseline. Future sessions will compare here.
        </Text>
      ) : (
        <>
          <View style={styles.metricGrid}>
            <Metric
              label="FQI"
              current={currentSummary.avgFqi}
              prior={priorSummary?.avgFqi ?? null}
              delta={comparison.fqiDelta}
              suffix=""
              preferHigher
              threshold={1}
              testID="metric-fqi"
            />
            <Metric
              label="ROM"
              current={currentSummary.avgRomDeg}
              prior={priorSummary?.avgRomDeg ?? null}
              delta={comparison.romDeltaDeg}
              suffix="°"
              preferHigher
              threshold={2}
              testID="metric-rom"
            />
            <Metric
              label="Symmetry"
              current={currentSummary.avgSymmetryDeg}
              prior={priorSummary?.avgSymmetryDeg ?? null}
              delta={comparison.symmetryDeltaDeg}
              suffix="°"
              preferHigher={false}
              threshold={1}
              invertDelta
              testID="metric-symmetry"
            />
            <Metric
              label="Faults"
              current={totalFaults(currentSummary.faultCounts)}
              prior={priorSummary ? totalFaults(priorSummary.faultCounts) : null}
              delta={comparison.faultCountDelta}
              suffix=""
              preferHigher={false}
              threshold={0.5}
              invertDelta
              testID="metric-faults"
            />
          </View>

          {(comparison.newFaults.length > 0 || comparison.resolvedFaults.length > 0) && (
            <View style={styles.faultChanges}>
              {comparison.resolvedFaults.length > 0 && (
                <View style={styles.faultRow} testID="resolved-faults">
                  <Ionicons name="checkmark-circle" size={14} color="#3CC8A9" />
                  <Text style={styles.faultRowText}>
                    Resolved: {comparison.resolvedFaults.join(', ')}
                  </Text>
                </View>
              )}
              {comparison.newFaults.length > 0 && (
                <View style={styles.faultRow} testID="new-faults">
                  <Ionicons name="alert-circle" size={14} color="#EF4444" />
                  <Text style={styles.faultRowText}>
                    New: {comparison.newFaults.join(', ')}
                  </Text>
                </View>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function totalFaults(counts: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(counts)) total += value;
  return total;
}

interface MetricProps {
  label: string;
  current: number | null;
  prior: number | null;
  delta: number | null;
  suffix: string;
  preferHigher: boolean;
  threshold?: number;
  invertDelta?: boolean;
  testID?: string;
}

function Metric({
  label,
  current,
  delta,
  suffix,
  preferHigher,
  threshold = 0.5,
  invertDelta = false,
  testID,
}: MetricProps) {
  const deltaColor = metricColor(delta, preferHigher, threshold);
  return (
    <View style={styles.metric} testID={testID}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>
        {current == null ? '—' : `${Math.round(current * 10) / 10}${suffix}`}
      </Text>
      <Text style={[styles.metricDelta, { color: deltaColor }]} testID={`${testID}-delta`}>
        {formatSignedNumber(delta, suffix, invertDelta)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    backgroundColor: '#0F1729',
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  trendText: {
    fontSize: 12,
    fontWeight: '600',
  },
  exerciseLabel: {
    color: '#B8C2D9',
    fontSize: 13,
    textTransform: 'capitalize',
  },
  baselineMessage: {
    color: '#B8C2D9',
    fontSize: 14,
    lineHeight: 20,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metric: {
    flexBasis: '48%',
    backgroundColor: '#162238',
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  metricLabel: {
    color: '#8B97B3',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    color: '#F8F9FF',
    fontSize: 18,
    fontWeight: '600',
  },
  metricDelta: {
    fontSize: 12,
    fontWeight: '500',
  },
  faultChanges: {
    gap: 6,
  },
  faultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  faultRowText: {
    color: '#F8F9FF',
    fontSize: 12,
  },
});

export default SessionComparisonCard;
