import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import {
  calculateRepFqiTrend,
  type RepFqiTrend,
} from '@/lib/services/rep-analytics';

type TimeRange = '30d' | '90d' | 'all';

const RANGE_OPTIONS: { id: TimeRange; label: string; days: number }[] = [
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: 3650 },
];

interface Props {
  exerciseId: string;
  /** Optional pre-fetched snapshot to skip network calls (used for previews/tests). */
  initialSnapshot?: RepFqiTrend | null;
  /** Default range selection. */
  defaultRange?: TimeRange;
}

export function FqiTrendChart({ exerciseId, initialSnapshot, defaultRange = '30d' }: Props) {
  const [range, setRange] = useState<TimeRange>(defaultRange);
  const [snapshot, setSnapshot] = useState<RepFqiTrend | null>(initialSnapshot ?? null);
  const [loading, setLoading] = useState(!initialSnapshot);

  useEffect(() => {
    if (initialSnapshot) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const days = RANGE_OPTIONS.find((o) => o.id === range)?.days ?? 30;
      const next = await calculateRepFqiTrend(exerciseId, days);
      if (!cancelled) {
        setSnapshot(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exerciseId, range, initialSnapshot]);

  const chartData = useMemo(() => {
    if (!snapshot || snapshot.dataPoints.length === 0) return null;
    const points = snapshot.dataPoints;
    const stride = Math.max(1, Math.ceil(points.length / 6));
    return {
      labels: points.map((p, i) => (i % stride === 0 || i === points.length - 1 ? new Date(p.ts).toISOString().slice(5, 10) : '')),
      datasets: [
        {
          data: points.map((p) => p.fqi),
          color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
          strokeWidth: 2,
        },
      ],
    };
  }, [snapshot]);

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(280, screenWidth - 40);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>FQI Trend</Text>
      <Text style={styles.cardSubtitle}>Form quality across your last sessions.</Text>

      <View style={styles.tabs}>
        {RANGE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.id}
            style={[styles.tab, range === opt.id && styles.tabActive]}
            onPress={() => setRange(opt.id)}
          >
            <Text style={[styles.tabText, range === opt.id && styles.tabTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#4C8CFF" />
        </View>
      ) : !chartData ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No rep data in this window yet.</Text>
        </View>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <View style={styles.summaryPill}>
              <Text style={styles.summaryLabel}>Avg</Text>
              <Text style={styles.summaryValue}>{snapshot?.avgFqi ?? '--'}</Text>
            </View>
            <View style={styles.summaryPill}>
              <Text style={styles.summaryLabel}>Slope</Text>
              <Text style={styles.summaryValue}>
                {snapshot?.slope === null || snapshot?.slope === undefined
                  ? '--'
                  : `${snapshot.slope > 0 ? '+' : ''}${snapshot.slope.toFixed(2)}/d`}
              </Text>
            </View>
            <View style={styles.summaryPill}>
              <Text style={styles.summaryLabel}>R²</Text>
              <Text style={styles.summaryValue}>
                {snapshot?.rSquared === null || snapshot?.rSquared === undefined
                  ? '--'
                  : snapshot.rSquared.toFixed(2)}
              </Text>
            </View>
            <View style={styles.summaryPill}>
              <Text style={styles.summaryLabel}>Reps</Text>
              <Text style={styles.summaryValue}>{snapshot?.dataPoints.length ?? 0}</Text>
            </View>
          </View>

          <LineChart
            data={chartData}
            width={chartWidth}
            height={200}
            chartConfig={{
              backgroundColor: 'transparent',
              backgroundGradientFrom: '#0F2339',
              backgroundGradientTo: '#1B2E4A',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(154, 172, 209, ${opacity})`,
              propsForBackgroundLines: { stroke: 'rgba(154, 172, 209, 0.15)', strokeWidth: 1 },
              propsForDots: { r: '2', strokeWidth: '0' },
            }}
            withDots
            withInnerLines
            withOuterLines={false}
            withVerticalLines={false}
            bezier
            style={styles.chart}
          />
        </>
      )}
    </View>
  );
}

export default FqiTrendChart;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#12243A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.16)',
    padding: 14,
  },
  cardTitle: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#9AACD1',
    marginTop: 4,
    marginBottom: 10,
    fontSize: 12,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.2)',
    backgroundColor: '#0F2339',
  },
  tabActive: {
    backgroundColor: '#4C8CFF',
    borderColor: '#4C8CFF',
  },
  tabText: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#F5F7FF',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  summaryPill: {
    flex: 1,
    minWidth: '22%',
    backgroundColor: '#0F2339',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  summaryLabel: {
    color: '#9AACD1',
    fontSize: 11,
  },
  summaryValue: {
    color: '#F5F7FF',
    fontWeight: '600',
    marginTop: 3,
  },
  chart: {
    borderRadius: 12,
    marginLeft: -10,
  },
  empty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9AACD1',
    fontSize: 13,
  },
});
