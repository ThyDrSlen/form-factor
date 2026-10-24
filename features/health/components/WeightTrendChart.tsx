import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Svg, Line, Circle, Path } from 'react-native-svg';
import { theme } from '@/styles/theme';
import type { HealthMetricPoint } from '@/lib/services/healthkit/health-metrics';
import type { RecordedHealthObservation } from '@/lib/services/healthkit/health-types';

type ChartPoint = HealthMetricPoint & Partial<RecordedHealthObservation> & { provenance: 'observed' };
interface WeightTrendChartProps {
  /** Callers must supply actual observations, never legacy carry-forward history. */
  data: ChartPoint[];
  period: '7d' | '30d' | '90d' | '180d';
  weightUnit: string;
  showPredictions?: boolean;
}
const dateLabel = (date: number) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const DAY = 86_400_000;

export function WeightTrendChart({ data, weightUnit }: WeightTrendChartProps) {
  const [width, setWidth] = useState(0);
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [showList, setShowList] = useState(false);
  const points = useMemo(() => data.filter((p) => p.provenance === 'observed' && Number.isFinite(p.date) && Number.isFinite(p.value) && p.value > 0).sort((a, b) => a.date - b.date), [data]);
  if (!points.length) return <View style={styles.card}><Text style={styles.text}>No weight data available</Text></View>;
  const first = points[0];
  const latest = points[points.length - 1];
  const selectedIndex = Math.max(0, selectedDate == null ? points.length - 1 : points.findIndex((p) => p.date === selectedDate));
  const selected = points[selectedIndex];
  const multipleDays = dateLabel(first.date) !== dateLabel(latest.date);
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Explicit nonzero axis with a proportional minimum span avoids magnifying tiny fluctuations.
  const buffer = Math.max((max - min) * 0.2, max * 0.015, 0.5);
  const lower = Math.max(0, min - buffer);
  const upper = max + buffer;
  const x = (date: number) => latest.date === first.date ? width / 2 : 8 + (date - first.date) / (latest.date - first.date) * Math.max(0, width - 16);
  const y = (value: number) => 16 + (upper - value) / (upper - lower) * 164;
  const scrub = (locationX: number) => {
    const nearest = points.reduce((best, point) => Math.abs(x(point.date) - locationX) < Math.abs(x(best.date) - locationX) ? point : best);
    setSelectedDate(nearest.date);
  };
  const path = points.map((point, i) => `${i === 0 || point.date - points[i - 1].date > 3 * DAY ? 'M' : 'L'} ${x(point.date)} ${y(point.value)}`).join(' ');
  return <View style={styles.card}>
    <Text style={styles.title}>Weight Trend</Text>
    <Text style={styles.value}>{latest.value.toFixed(1)}</Text>
    <Text style={styles.text}>Latest measured · {dateLabel(latest.date)} · {weightUnit}</Text>
    {!multipleDays ? <Text style={styles.text}>One day of weight data. Add a reading on another day to see a change.</Text> : null}
    <View style={styles.row}>
      <View style={styles.axis}>{[upper, (upper + lower) / 2, lower].map((v, i) => <Text key={i} style={styles.text}>{v.toFixed(1)} {weightUnit}</Text>)}</View>
      <View style={styles.plot} testID="weight-plot" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessible accessibilityRole="adjustable" accessibilityLabel="Weight readings"
        accessibilityValue={{ min: 1, max: points.length, now: selectedIndex + 1, text: `${dateLabel(selected.date)}, ${selected.value.toFixed(1)} ${weightUnit}, ${selected.source ?? 'HealthKit'}, recorded` }}
        accessibilityHint="Swipe up or down to select a reading. A reading list is available below."
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => setSelectedDate(points[Math.max(0, Math.min(points.length - 1, selectedIndex + (e.nativeEvent.actionName === 'increment' ? 1 : -1)))].date)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => scrub(e.nativeEvent.locationX)} onResponderMove={(e) => scrub(e.nativeEvent.locationX)}>
        {width > 0 ? <Svg width={width} height={196} accessible={false}>
          {[upper, (upper + lower) / 2, lower].map((v, i) => <Line key={i} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke={theme.colors.border} strokeWidth={1} />)}
          <Path testID="weight-line" d={path} stroke={theme.colors.accentText} strokeWidth={2} fill="none" />
          <Line x1={x(selected.date)} x2={x(selected.date)} y1={0} y2={196} stroke={theme.colors.secondary} strokeDasharray="3,4" />
          {points.map((p, i) => <Circle testID={`weight-point-${i}`} key={`${p.date}-${i}`} cx={x(p.date)} cy={y(p.value)} r={4} fill={theme.colors.accentText} />)}
        </Svg> : null}
      </View>
    </View>
    <View style={styles.dates}><Text style={styles.text}>{dateLabel(first.date)}</Text><Text style={styles.text}>{dateLabel(latest.date)}</Text></View>
    <Text style={styles.text}>Dots are readings · gaps over 3 days are not connected · {weightUnit}, nonzero axis</Text>
    <Text testID="selected-reading" style={styles.text} accessibilityLiveRegion="polite">{dateLabel(selected.date)} · {selected.value.toFixed(1)} {weightUnit} · {selected.source ?? 'HealthKit'} · Recorded</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showList }} onPress={() => setShowList(!showList)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.text}>{showList ? 'Hide readings' : 'Show readings'}</Text></Pressable>
    {showList ? points.map((p, i) => <Text key={`${p.date}-${i}`} style={styles.text}>{`${dateLabel(p.date)} · ${p.value.toFixed(1)} ${weightUnit} · ${p.source ?? 'HealthKit'} · Recorded`}</Text>) : null}
    {multipleDays ? <Text style={styles.text}>Trend</Text> : null}
    <Text style={styles.text}>{multipleDays ? (latest.value - first.value).toFixed(1) : '--'}</Text>
    <Text style={styles.text}>First-to-latest change ({weightUnit}) · not a forecast</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 20, backgroundColor: theme.colors.surface, gap: 10, borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.text, fontFamily: theme.font.medium, fontSize: 18 },
  value: { color: theme.colors.text, fontFamily: theme.font.medium, fontSize: 32, fontVariant: ['tabular-nums'] },
  text: { color: theme.colors.secondary, fontFamily: theme.font.regular, fontSize: 12 },
  row: { flexDirection: 'row', gap: 10 },
  axis: { justifyContent: 'space-between', paddingVertical: 12 },
  plot: { flex: 1, height: 196 },
  dates: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
});
