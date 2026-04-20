/**
 * OverloadAnalyticsCard
 *
 * Compact chart card visualising progressive-overload history for a single
 * exercise. Renders:
 *   - Weight-over-time line (newest-rightmost)
 *   - Rep-count legend badge
 *   - PR markers (1RM / 5RM / Volume) pulled from the exercise history
 *     service, plus a "next PR" threshold banner.
 *
 * Uses `react-native-chart-kit` (already a dependency) for the line plot.
 * The card is additive and safe to mount on any scrollable container.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { getExerciseHistorySummary } from '@/lib/services/exercise-history-service';
import type {
  ExerciseHistorySummary,
  ExerciseHistorySet,
} from '@/lib/services/exercise-history-service';
import type { PrResult } from '@/lib/services/pr-detector-overload';

export interface OverloadAnalyticsCardProps {
  userId: string;
  exercise: string;
  limit?: number;
  /** Optional handler fired when user taps the card CTA. */
  onPressPlan?: () => void;
  /** Optional override for testing / storybook. */
  summaryOverride?: ExerciseHistorySummary;
}

const PANEL = '#0E1A2E';
const ACCENT = '#4C8CFF';
const TEXT_PRIMARY = '#F8F9FF';
const TEXT_SECONDARY = '#8E9BAD';
const SUCCESS = '#3CC8A9';

function buildChartLabels(sets: ExerciseHistorySet[]): string[] {
  if (sets.length === 0) return [];
  // sets are newest-first; render oldest-first left-to-right.
  const ordered = [...sets].reverse();
  const stride = Math.max(1, Math.ceil(ordered.length / 4));
  return ordered.map((set, index) => {
    if (index % stride !== 0 && index !== ordered.length - 1) return '';
    const date = new Date(set.date);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });
}

function buildChartDataset(sets: ExerciseHistorySet[]): number[] {
  if (sets.length === 0) return [0];
  return [...sets].reverse().map((s) => s.weight);
}

function nextPrThreshold(summary: ExerciseHistorySummary): number | null {
  if (!summary.lastSession) return null;
  const est = summary.estimatedOneRepMax;
  if (est <= 0) return Math.round(summary.lastSession.weight * 1.025);
  // Target a 2.5% bump on the working weight; the estimated 1RM flags when
  // we are creeping close to a new 1RM PR.
  return Math.round(summary.lastSession.weight * 1.025);
}

function prChipLabel(pr: PrResult): string {
  switch (pr.category) {
    case 'one_rep_max':
      return `1RM ${Math.round(pr.current)}`;
    case 'three_rep_max':
      return `3RM ${Math.round(pr.current)}`;
    case 'five_rep_max':
      return `5RM ${Math.round(pr.current)}`;
    case 'volume':
    default:
      return `Vol ${Math.round(pr.current)}`;
  }
}

export function OverloadAnalyticsCard({
  userId,
  exercise,
  limit = 30,
  onPressPlan,
  summaryOverride,
}: OverloadAnalyticsCardProps): React.ReactElement {
  const [summary, setSummary] = useState<ExerciseHistorySummary | null>(
    summaryOverride ?? null,
  );
  const [loading, setLoading] = useState<boolean>(!summaryOverride);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (summaryOverride) {
      setSummary(summaryOverride);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getExerciseHistorySummary({
          userId,
          exerciseNameOrId: exercise,
          limit,
        });
        if (!cancelled) setSummary(result);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Could not load history.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, exercise, limit, summaryOverride]);

  const chartWidth = Math.max(260, Dimensions.get('window').width - 48);

  const labels = useMemo(() => buildChartLabels(summary?.sets ?? []), [summary]);
  const data = useMemo(() => buildChartDataset(summary?.sets ?? []), [summary]);
  const triggeredPrs = useMemo(
    () => (summary?.prData ?? []).filter((p) => p.isPr),
    [summary],
  );
  const threshold = useMemo(() => (summary ? nextPrThreshold(summary) : null), [summary]);

  if (loading) {
    return (
      <View style={styles.card} testID="overload-card-loading">
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.card} testID="overload-card-error">
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!summary || summary.sets.length === 0) {
    return (
      <View style={styles.card} testID="overload-card-empty">
        <View style={styles.headerRow}>
          <Text style={styles.exerciseName}>{exercise}</Text>
          <Text style={styles.subLabel}>Progressive overload</Text>
        </View>
        <Text style={styles.emptyText}>
          No history yet for this exercise. Log a set to start tracking overload.
        </Text>
      </View>
    );
  }

  const lastWeight = summary.lastSession?.weight ?? 0;
  const est = summary.estimatedOneRepMax;

  return (
    <View style={styles.card} testID="overload-card">
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.exerciseName}>{exercise}</Text>
          <Text style={styles.subLabel}>
            Last {lastWeight} lb · est. 1RM {est || '—'}
          </Text>
        </View>
        {onPressPlan ? (
          <TouchableOpacity
            onPress={onPressPlan}
            accessibilityRole="button"
            accessibilityLabel="Open progression plan"
            style={styles.planButton}
          >
            <Ionicons name="sparkles" size={14} color={ACCENT} />
            <Text style={styles.planButtonText}>Plan</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <LineChart
        data={{
          labels,
          datasets: [
            {
              data,
              color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
              strokeWidth: 2,
            },
          ],
        }}
        width={chartWidth}
        height={160}
        bezier
        withInnerLines={false}
        withOuterLines={false}
        withHorizontalLabels
        withVerticalLabels
        fromZero={false}
        chartConfig={{
          backgroundGradientFrom: PANEL,
          backgroundGradientTo: PANEL,
          color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(142, 155, 173, ${opacity})`,
          propsForDots: { r: '3' },
          propsForBackgroundLines: { stroke: 'rgba(142,155,173,0.12)' },
          decimalPlaces: 0,
        }}
        style={styles.chart}
      />

      {triggeredPrs.length > 0 ? (
        <View style={styles.chipRow}>
          {triggeredPrs.map((pr) => (
            <View key={pr.category} style={styles.chip} testID={`overload-pr-${pr.category}`}>
              <Ionicons name="trophy" size={12} color={SUCCESS} />
              <Text style={styles.chipText}>{prChipLabel(pr)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {threshold ? (
        <View style={styles.thresholdBanner} testID="overload-card-threshold">
          <Ionicons name="trending-up" size={14} color={ACCENT} />
          <Text style={styles.thresholdText}>
            Next PR threshold ≈ {threshold} lb
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default OverloadAnalyticsCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: PANEL,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  subLabel: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginTop: 2,
  },
  chart: {
    borderRadius: 12,
    marginVertical: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(60,200,169,0.12)',
  },
  chipText: {
    color: SUCCESS,
    fontSize: 11,
    fontWeight: '600',
  },
  thresholdBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(76,140,255,0.08)',
    borderRadius: 8,
  },
  thresholdText: {
    color: TEXT_PRIMARY,
    fontSize: 12,
  },
  planButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(76,140,255,0.12)',
  },
  planButtonText: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    color: TEXT_SECONDARY,
    fontSize: 13,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
  },
});
