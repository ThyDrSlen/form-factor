import React from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';

export interface WeeklyTrendPoint {
  /** Human label (e.g. "Mon" or "4/11"). */
  label: string;
  /** Average FQI for the day, or null if no session. */
  avgFqi: number | null;
}

export interface WeeklyTrendChartProps {
  /** Exactly 7 points (earliest -> latest) — shorter arrays render gracefully. */
  data: WeeklyTrendPoint[];
  /** 90th-percentile personal FQI; drawn as a reference ceiling. */
  p90: number | null;
  /** All-time average — drawn as a reference floor. */
  allTimeAvg: number | null;
}

const CHART_HEIGHT = 160;

export function WeeklyTrendChart({ data, p90, allTimeAvg }: WeeklyTrendChartProps) {
  const width = Dimensions.get('window').width - 32;
  const hasAnyValue = data.some((d) => d.avgFqi !== null);

  if (!hasAnyValue) {
    return (
      <View style={styles.emptyCard} testID="weekly-trend-empty">
        <Text style={styles.title}>7-day FQI trend</Text>
        <Text style={styles.emptyText}>
          No FQI data yet. Run a form session to start your trend.
        </Text>
      </View>
    );
  }

  const labels = data.map((d) => d.label);
  // react-native-chart-kit requires numeric values — fill null with previous
  // value so gaps render as flat segments rather than vertical dives.
  const safeValues: number[] = [];
  let lastValue = data.find((d) => d.avgFqi != null)?.avgFqi ?? 70;
  for (const d of data) {
    if (d.avgFqi != null) lastValue = d.avgFqi;
    safeValues.push(Number(lastValue.toFixed(1)));
  }

  const datasets: { data: number[]; color?: (opacity?: number) => string; strokeWidth?: number; withDots?: boolean }[] = [
    {
      data: safeValues,
      color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
      strokeWidth: 3,
    },
  ];
  if (p90 != null) {
    datasets.push({
      data: new Array(safeValues.length).fill(p90),
      color: () => 'rgba(60, 200, 169, 0.55)',
      strokeWidth: 1,
      withDots: false,
    });
  }
  if (allTimeAvg != null) {
    datasets.push({
      data: new Array(safeValues.length).fill(allTimeAvg),
      color: () => 'rgba(255, 184, 76, 0.55)',
      strokeWidth: 1,
      withDots: false,
    });
  }

  return (
    <View style={styles.card} testID="weekly-trend-chart">
      <View style={styles.headerRow}>
        <Text style={styles.title}>7-day FQI trend</Text>
        <View style={styles.legendRow}>
          <LegendDot color="#4C8CFF" label="FQI" />
          {p90 != null && <LegendDot color="#3CC8A9" label="P90" />}
          {allTimeAvg != null && <LegendDot color="#FFB84C" label="Avg" />}
        </View>
      </View>
      <LineChart
        data={{ labels, datasets }}
        width={width}
        height={CHART_HEIGHT}
        withDots={false}
        withInnerLines
        withOuterLines={false}
        withVerticalLines={false}
        chartConfig={{
          backgroundColor: 'transparent',
          backgroundGradientFrom: '#0F2339',
          backgroundGradientTo: '#1B2E4A',
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(154, 172, 209, ${opacity})`,
          propsForBackgroundLines: {
            stroke: 'rgba(154, 172, 209, 0.15)',
            strokeWidth: 1,
          },
        }}
        bezier
        style={styles.chart}
      />
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F2339',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  emptyCard: {
    backgroundColor: '#0F2339',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  title: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyText: {
    color: '#97A3C2',
    fontSize: 13,
    marginTop: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    color: '#97A3C2',
    fontSize: 11,
  },
  chart: {
    marginLeft: -8,
    borderRadius: 10,
  },
});
