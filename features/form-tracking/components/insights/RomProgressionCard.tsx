import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { supabase } from '@/lib/supabase';
import { errorWithTs } from '@/lib/logger';

interface Props {
  exerciseId: string;
  /** Number of weeks of history to show. Defaults to 8. */
  weeks?: number;
  /** Optional pre-fetched data for preview/tests. */
  initialData?: RomWeekBucket[] | null;
}

export interface RomWeekBucket {
  /** ISO date string for the Monday of this week (UTC). */
  weekStart: string;
  /** Short label for the x-axis, e.g. "Mar 25". */
  label: string;
  /** Mean ROM across all reps that week (degrees). `null` when no data. */
  leftAvgRom: number | null;
  rightAvgRom: number | null;
  bilateralAvgRom: number | null;
  repCount: number;
}

function startOfUtcWeek(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function shortLabelFor(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function featureRom(features: unknown): number | null {
  if (!features || typeof features !== 'object') return null;
  const rec = features as Record<string, unknown>;
  const v = rec.romDeg ?? rec.rom_deg;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function loadWeeklyRom(exerciseId: string, weeks: number): Promise<RomWeekBucket[]> {
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);

    const { data, error } = await supabase
      .from('reps')
      .select('side,features,start_ts')
      .eq('exercise', exerciseId)
      .gte('start_ts', cutoff.toISOString())
      .order('start_ts', { ascending: true })
      .limit(3000);

    if (error) throw error;

    const rows = (data ?? []) as { side: 'left' | 'right' | null; features: unknown; start_ts: string }[];
    if (rows.length === 0) return [];

    const buckets = new Map<string, { left: number[]; right: number[]; bilateral: number[] }>();
    for (const row of rows) {
      const rom = featureRom(row.features);
      if (rom === null) continue;
      const weekStart = startOfUtcWeek(row.start_ts);
      const bucket = buckets.get(weekStart) ?? { left: [], right: [], bilateral: [] };
      if (row.side === 'left') bucket.left.push(rom);
      else if (row.side === 'right') bucket.right.push(rom);
      else bucket.bilateral.push(rom);
      buckets.set(weekStart, bucket);
    }

    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, b]) => {
        const avg = (xs: number[]): number | null =>
          xs.length === 0 ? null : Number((xs.reduce((a, c) => a + c, 0) / xs.length).toFixed(2));
        return {
          weekStart,
          label: shortLabelFor(weekStart),
          leftAvgRom: avg(b.left),
          rightAvgRom: avg(b.right),
          bilateralAvgRom: avg(b.bilateral),
          repCount: b.left.length + b.right.length + b.bilateral.length,
        };
      });
  } catch (error) {
    errorWithTs('[RomProgressionCard] loadWeeklyRom failed', error);
    return [];
  }
}

export function RomProgressionCard({ exerciseId, weeks = 8, initialData }: Props) {
  const [data, setData] = useState<RomWeekBucket[] | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const next = await loadWeeklyRom(exerciseId, weeks);
      if (!cancelled) {
        setData(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exerciseId, weeks, initialData]);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return null;

    const hasSideData = data.some((d) => d.leftAvgRom !== null || d.rightAvgRom !== null);
    const labelStride = Math.max(1, Math.ceil(data.length / 4));
    const labels = data.map((d, i) => (i % labelStride === 0 || i === data.length - 1 ? d.label : ''));

    const datasets: {
      data: number[];
      color?: (opacity?: number) => string;
      strokeWidth?: number;
    }[] = [];

    if (hasSideData) {
      datasets.push({
        data: data.map((d) => d.leftAvgRom ?? d.bilateralAvgRom ?? 0),
        color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
        strokeWidth: 2,
      });
      datasets.push({
        data: data.map((d) => d.rightAvgRom ?? d.bilateralAvgRom ?? 0),
        color: (opacity = 1) => `rgba(60, 200, 169, ${opacity})`,
        strokeWidth: 2,
      });
    } else {
      datasets.push({
        data: data.map((d) => d.bilateralAvgRom ?? 0),
        color: (opacity = 1) => `rgba(76, 140, 255, ${opacity})`,
        strokeWidth: 2,
      });
    }

    return {
      labels,
      datasets,
      legend: hasSideData ? ['Left', 'Right'] : ['ROM'],
    };
  }, [data]);

  const latestDelta = useMemo(() => {
    if (!data || data.length < 2) return null;
    const first = data[0];
    const last = data[data.length - 1];
    const firstAvg = first.bilateralAvgRom ?? ((first.leftAvgRom ?? 0) + (first.rightAvgRom ?? 0)) / 2;
    const lastAvg = last.bilateralAvgRom ?? ((last.leftAvgRom ?? 0) + (last.rightAvgRom ?? 0)) / 2;
    if (!Number.isFinite(firstAvg) || !Number.isFinite(lastAvg) || firstAvg === 0) return null;
    return Number((lastAvg - firstAvg).toFixed(1));
  }, [data]);

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(280, screenWidth - 40);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>ROM Progression</Text>
        {latestDelta !== null && (
          <Text style={[styles.delta, latestDelta >= 0 ? styles.deltaUp : styles.deltaDown]}>
            {latestDelta > 0 ? '+' : ''}
            {latestDelta.toFixed(1)}°
          </Text>
        )}
      </View>
      <Text style={styles.cardSubtitle}>Week-over-week range-of-motion trend.</Text>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#4C8CFF" />
        </View>
      ) : !chartData ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Not enough reps to compute a weekly trend.</Text>
        </View>
      ) : (
        <LineChart
          data={chartData}
          width={chartWidth}
          height={180}
          chartConfig={{
            backgroundColor: 'transparent',
            backgroundGradientFrom: '#0F2339',
            backgroundGradientTo: '#1B2E4A',
            decimalPlaces: 0,
            color: (opacity = 1) => `rgba(245, 247, 255, ${opacity})`,
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
      )}
    </View>
  );
}

export default RomProgressionCard;

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
    marginBottom: 10,
    fontSize: 12,
  },
  delta: {
    fontSize: 14,
    fontWeight: '700',
  },
  deltaUp: {
    color: '#3CC8A9',
  },
  deltaDown: {
    color: '#EF4444',
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
    textAlign: 'center',
    paddingHorizontal: 12,
  },
});
