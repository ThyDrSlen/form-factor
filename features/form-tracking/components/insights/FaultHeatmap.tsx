import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, Text, View } from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import {
  getFaultHeatmap,
  type FaultHeatmapEntry,
  type FaultHeatmapScope,
} from '@/lib/services/rep-analytics';

interface Props {
  scope: FaultHeatmapScope;
  /** Optional pre-fetched data to skip network calls. */
  initialData?: FaultHeatmapEntry[] | null;
}

function severityColor(avg: number): string {
  if (avg >= 1.5) return '#EF4444'; // high
  if (avg >= 0.5) return '#F59E0B'; // medium
  return '#3CC8A9'; // low
}

function severityLabel(avg: number): string {
  if (avg >= 1.5) return 'high';
  if (avg >= 0.5) return 'medium';
  return 'low';
}

export function FaultHeatmap({ scope, initialData }: Props) {
  const [data, setData] = useState<FaultHeatmapEntry[] | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const next = await getFaultHeatmap(scope);
      if (!cancelled) {
        setData(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, initialData]);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return null;
    const top = data.slice(0, 6);
    return {
      labels: top.map((d) => d.faultId.replace(/_/g, ' ').slice(0, 10)),
      datasets: [
        {
          data: top.map((d) => d.count),
        },
      ],
    };
  }, [data]);

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(280, screenWidth - 40);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Fault Heatmap</Text>
      <Text style={styles.cardSubtitle}>Most-detected form faults across your reps.</Text>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#F59E0B" />
        </View>
      ) : !chartData ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No faults detected yet. Nice work.</Text>
        </View>
      ) : (
        <>
          <BarChart
            data={chartData}
            width={chartWidth}
            height={200}
            yAxisLabel=""
            yAxisSuffix=""
            fromZero
            showValuesOnTopOfBars
            chartConfig={{
              backgroundColor: 'transparent',
              backgroundGradientFrom: '#0F2339',
              backgroundGradientTo: '#1B2E4A',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(245, 158, 11, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(154, 172, 209, ${opacity})`,
              propsForBackgroundLines: { stroke: 'rgba(154, 172, 209, 0.15)', strokeWidth: 1 },
              barPercentage: 0.6,
            }}
            style={styles.chart}
          />

          <View style={styles.legend}>
            {data?.slice(0, 6).map((entry) => (
              <View key={entry.faultId} style={styles.legendRow}>
                <View style={[styles.dot, { backgroundColor: severityColor(entry.severityAvg) }]} />
                <Text style={styles.legendFault}>{entry.faultId}</Text>
                <Text style={styles.legendCount}>{entry.count}</Text>
                <Text style={[styles.legendSeverity, { color: severityColor(entry.severityAvg) }]}>
                  {severityLabel(entry.severityAvg)}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

export default FaultHeatmap;

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
  legend: {
    marginTop: 10,
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendFault: {
    flex: 1,
    color: '#F5F7FF',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  legendCount: {
    color: '#DCE5F5',
    fontSize: 12,
    fontWeight: '700',
    width: 26,
    textAlign: 'right',
  },
  legendSeverity: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
    width: 58,
    textAlign: 'right',
  },
});
