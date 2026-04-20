/**
 * SymmetryComparatorCard
 *
 * Per-rep bilateral asymmetry chart. Bars represent `asymmetryPct` per rep
 * with a horizontal threshold line at 15% (anything above is red). Renders
 * an empty state when the rep-analytics stub returns no rows (PR #444 not
 * yet on main).
 */

import React, { useMemo } from 'react';
import { Dimensions, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import {
  SYMMETRY_THRESHOLD_PCT,
  type SymmetryDatum,
} from '@/hooks/use-symmetry-comparison';

export interface SymmetryComparatorCardProps {
  series: SymmetryDatum[];
  isLoading?: boolean;
  isFallback?: boolean;
  /** Optional chart width override; defaults to (screen - 48). */
  width?: number;
  style?: ViewStyle;
  testID?: string;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const DEFAULT_WIDTH = SCREEN_WIDTH - 48;
const CHART_HEIGHT = 180;

export function SymmetryComparatorCard({
  series,
  isLoading = false,
  isFallback = false,
  width,
  style,
  testID,
}: SymmetryComparatorCardProps) {
  const chartWidth = width ?? DEFAULT_WIDTH;

  const cleanSeries = useMemo(
    () => series.filter((d) => d.asymmetryPct !== null && Number.isFinite(d.asymmetryPct as number)),
    [series]
  );

  const data = useMemo(() => {
    if (cleanSeries.length === 0) return null;
    return {
      labels: cleanSeries.map((d) => `R${d.repNumber}`),
      datasets: [
        {
          data: cleanSeries.map((d) => d.asymmetryPct as number),
        },
      ],
    };
  }, [cleanSeries]);

  const maxAsymmetry = useMemo(() => {
    if (cleanSeries.length === 0) return 0;
    return Math.max(...cleanSeries.map((d) => d.asymmetryPct as number));
  }, [cleanSeries]);

  return (
    <View style={[styles.card, style]} testID={testID ?? 'symmetry-comparator-card'}>
      <View style={styles.header}>
        <Text style={styles.title}>Left vs Right</Text>
        <View style={styles.legendRow}>
          <ThresholdLegend />
        </View>
      </View>

      {isLoading && <Text style={styles.placeholder}>Loading rep history…</Text>}

      {!isLoading && data && (
        <View>
          <BarChart
            data={data}
            width={chartWidth}
            height={CHART_HEIGHT}
            yAxisLabel=""
            yAxisSuffix="%"
            fromZero
            showBarTops={false}
            chartConfig={{
              backgroundColor: 'transparent',
              backgroundGradientFrom: '#0F2339',
              backgroundGradientTo: '#1B2E4A',
              decimalPlaces: 0,
              color: (opacity = 1) =>
                maxAsymmetry > SYMMETRY_THRESHOLD_PCT
                  ? `rgba(220, 38, 38, ${opacity})`
                  : `rgba(76, 140, 255, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(154, 172, 209, ${opacity})`,
              propsForBackgroundLines: {
                stroke: 'rgba(154, 172, 209, 0.15)',
                strokeWidth: 1,
              },
            }}
            style={styles.chart}
          />
          {/* Threshold marker */}
          <View
            accessibilityLabel={`Threshold ${SYMMETRY_THRESHOLD_PCT}%`}
            style={styles.thresholdLine}
          />
          <Text style={styles.summaryText}>
            Peak asymmetry: <Text style={styles.summaryValue}>{maxAsymmetry.toFixed(1)}%</Text>
          </Text>
        </View>
      )}

      {!isLoading && !data && (
        <Text style={styles.placeholder} testID="symmetry-comparator-empty">
          {isFallback
            ? 'Rep analytics will be available after PR #444 merges.'
            : 'Not enough valid bilateral data yet.'}
        </Text>
      )}
    </View>
  );
}

function ThresholdLegend() {
  return (
    <View style={styles.legendItem}>
      <View style={styles.legendSwatch} />
      <Text style={styles.legendText}>{SYMMETRY_THRESHOLD_PCT}% threshold</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F1825',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#F2F4F8',
    fontSize: 16,
    fontWeight: '700',
  },
  legendRow: {
    flexDirection: 'row',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 8,
    height: 8,
    backgroundColor: '#DC2626',
    borderRadius: 2,
  },
  legendText: {
    color: '#9AACD1',
    fontSize: 12,
  },
  placeholder: {
    color: '#9AACD1',
    fontSize: 13,
    paddingVertical: 16,
    textAlign: 'center',
  },
  chart: {
    borderRadius: 12,
    marginVertical: 4,
  },
  thresholdLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Approximate threshold position assuming default chart height; the
    // BarChart owns its own y-axis so this line is decorative — the legend
    // tells users what the threshold means.
    top: CHART_HEIGHT * (1 - SYMMETRY_THRESHOLD_PCT / 100) - 1,
    height: 1,
    backgroundColor: 'rgba(220, 38, 38, 0.6)',
  },
  summaryText: {
    color: '#9AACD1',
    fontSize: 12,
    marginTop: 6,
  },
  summaryValue: {
    color: '#F2F4F8',
    fontWeight: '700',
  },
});

export default SymmetryComparatorCard;
