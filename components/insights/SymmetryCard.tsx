import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getSymmetryTrend,
  type SymmetryTrendResult,
  type SymmetryTrend,
} from '@/lib/services/rep-analytics';

interface Props {
  exerciseId: string;
  days?: number;
  /** Optional pre-fetched data for preview/tests. */
  initialData?: SymmetryTrendResult | null;
}

function trendIcon(trend: SymmetryTrend): React.ComponentProps<typeof Ionicons>['name'] {
  if (trend === 'improving') return 'trending-down';
  if (trend === 'worsening') return 'trending-up';
  if (trend === 'stable') return 'remove';
  return 'help';
}

function trendColor(trend: SymmetryTrend): string {
  if (trend === 'improving') return '#3CC8A9';
  if (trend === 'worsening') return '#EF4444';
  if (trend === 'stable') return '#9AACD1';
  return '#6781A6';
}

function trendLabel(trend: SymmetryTrend, asymmetryRatio: number | null): string {
  if (asymmetryRatio === null) return 'Insufficient bilateral data';
  const pct = (asymmetryRatio * 100).toFixed(1);
  if (trend === 'improving') return `Gap shrinking (${pct}%)`;
  if (trend === 'worsening') return `Gap widening (${pct}%)`;
  if (trend === 'stable') return `Holding steady at ${pct}%`;
  return `Current gap: ${pct}%`;
}

export function SymmetryCard({ exerciseId, days = 30, initialData }: Props) {
  const [data, setData] = useState<SymmetryTrendResult | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const next = await getSymmetryTrend(exerciseId, days);
      if (!cancelled) {
        setData(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exerciseId, days, initialData]);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>Left / Right Symmetry</Text>
        {data && (
          <View style={styles.trendPill}>
            <Ionicons name={trendIcon(data.trend)} size={14} color={trendColor(data.trend)} />
            <Text style={[styles.trendText, { color: trendColor(data.trend) }]}>{data.trend}</Text>
          </View>
        )}
      </View>
      <Text style={styles.cardSubtitle}>Bilateral ROM comparison over the last {days} days.</Text>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#4C8CFF" />
        </View>
      ) : !data ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No bilateral data yet.</Text>
        </View>
      ) : (
        <>
          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>Left avg</Text>
              <Text style={[styles.statValue, styles.leftColor]}>
                {data.leftAvgRom === null ? '--' : `${data.leftAvgRom.toFixed(1)}°`}
              </Text>
            </View>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>Right avg</Text>
              <Text style={[styles.statValue, styles.rightColor]}>
                {data.rightAvgRom === null ? '--' : `${data.rightAvgRom.toFixed(1)}°`}
              </Text>
            </View>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>Asymmetry</Text>
              <Text style={styles.statValue}>
                {data.asymmetryRatio === null ? '--' : `${(data.asymmetryRatio * 100).toFixed(1)}%`}
              </Text>
            </View>
          </View>

          <Text style={[styles.trendSummary, { color: trendColor(data.trend) }]}>
            {trendLabel(data.trend, data.asymmetryRatio)}
          </Text>
        </>
      )}
    </View>
  );
}

export default SymmetryCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#12243A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.16)',
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#9AACD1',
    marginTop: 4,
    marginBottom: 12,
    fontSize: 12,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F2339',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  trendText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCol: {
    flex: 1,
    backgroundColor: '#0F2339',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  statLabel: {
    color: '#9AACD1',
    fontSize: 11,
  },
  statValue: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  leftColor: {
    color: '#4C8CFF',
  },
  rightColor: {
    color: '#3CC8A9',
  },
  trendSummary: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9AACD1',
    fontSize: 13,
  },
});
