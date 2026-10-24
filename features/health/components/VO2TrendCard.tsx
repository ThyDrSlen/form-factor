import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Svg, Circle, Line, Path } from 'react-native-svg';
import type { RecordedHealthObservation } from '@/lib/services/healthkit/health-types';
import { theme } from '@/styles/theme';

const dateLabel = (date: number) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dayKey = (date: number) => new Date(date).toDateString();

export function VO2TrendCard({ data, now = Date.now() }: { data: readonly RecordedHealthObservation[]; now?: number }) {
  const [about, setAbout] = useState(false);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState(90);
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const touchStart = useRef({ x: 0, y: 0 });
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - range + 1);
  const points = data.filter(p => p.provenance === 'observed' && p.unit === 'mL/kg/min'
    && Number.isFinite(p.date) && p.date >= start.getTime() && p.date <= now && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.date - b.date);
  const first = points[0];
  const latest = points[points.length - 1];
  const selectedIndex = Math.max(0, selectedDate == null ? points.length - 1 : points.findIndex(p => p.date === selectedDate));
  const selected = points[selectedIndex];
  const days = new Set(points.map(p => dayKey(p.date))).size;
  const compatible = Boolean(first?.source?.trim()) && points.every(p => p.source === first.source);
  const low = Math.max(0, Math.min(...points.map(p => p.value)) - 2);
  const high = Math.max(...points.map(p => p.value)) + 2;
  const x = (date: number) => latest.date === first.date ? width / 2 : 8 + (date - first.date) / (latest.date - first.date) * Math.max(0, width - 16);
  const y = (value: number) => 12 + (high - value) / (high - low) * 148;
  const path = points.map((p, i) => `${i === 0 || p.date - points[i-1].date > 14 * 86400000 ? 'M' : 'L'} ${x(p.date)} ${y(p.value)}`).join(' ');
  const scrub = (location: number) => setSelectedDate(points.reduce((best, p) => Math.abs(x(p.date) - location) < Math.abs(x(best.date) - location) ? p : best).date);
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>VO₂ max</Text>
    <Text style={styles.eyebrow}>Cardio fitness · HealthKit estimates</Text>
    <View style={styles.ranges} accessibilityRole="tablist" accessibilityLabel="VO₂ history range">
      {[30, 90, 180].map(days => <Pressable key={days}
        accessibilityRole="tab" accessibilityLabel={`VO₂ past ${days} days`}
        accessibilityState={{ selected: range === days }}
        onPress={() => { if (range !== days) { setRange(days); setSelectedDate(null); } }}
        style={({ pressed }) => [styles.range, range === days && styles.selectedRange, pressed && styles.pressed]}>
        <Text style={[styles.rangeLabel, range === days && styles.selectedRangeLabel]}>{days} days</Text>
      </Pressable>)}
    </View>
    {latest ? <>
      <View style={styles.valueRow}><Text style={styles.value}>{latest.value.toFixed(1)}</Text><Text style={styles.unit}>mL/kg/min</Text></View>
      <Text style={styles.caption}>Latest estimate · {dateLabel(latest.date)}</Text>
      {days > 1 && compatible ? <View>
        <Text style={styles.change}>{latest.value - first.value > 0 ? '+' : ''}{(latest.value - first.value).toFixed(1)} mL/kg/min</Text>
        <Text style={styles.caption}>First-to-latest estimate change · not a validated fitness trend</Text>
      </View> : <Text style={styles.caption}>{days <= 1 ? 'One recorded day. More dates are needed to show a change.' : 'Change unavailable: source labels differ or are missing.'}</Text>}
      <View style={styles.row}>
        <View style={styles.axis}>{[high, (high + low) / 2, low].map((value, i) => <Text key={i} style={styles.caption}>{value.toFixed(1)}</Text>)}</View>
        <View style={styles.plot} testID="vo2-plot" onLayout={event => setWidth(event.nativeEvent.layout.width)}
          accessible accessibilityRole="adjustable" accessibilityLabel="VO₂ estimates"
          accessibilityValue={{ min: 1, max: points.length, now: selectedIndex + 1, text: `${dateLabel(selected.date)}, ${selected.value.toFixed(1)} mL/kg/min` }}
          accessibilityActions={[{name:'increment'}, {name:'decrement'}]}
          onAccessibilityAction={event => setSelectedDate(points[Math.max(0, Math.min(points.length-1, selectedIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1)))].date)}
          onStartShouldSetResponder={event => {
            touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
            return false;
          }}
          onMoveShouldSetResponder={event => {
            const dx = Math.abs(event.nativeEvent.pageX - touchStart.current.x);
            const dy = Math.abs(event.nativeEvent.pageY - touchStart.current.y);
            return width > 0 && dx > 10 && dx > dy * 1.5;
          }}
          onResponderTerminationRequest={() => true}
          onResponderGrant={event => scrub(event.nativeEvent.locationX)} onResponderMove={event => scrub(event.nativeEvent.locationX)}>
          {width > 0 ? <Svg width={width} height={172} accessible={false}>
            {[high, (high + low) / 2, low].map((value, i) => <Line key={i} x1={0} x2={width} y1={y(value)} y2={y(value)} stroke={theme.colors.border} />)}
            {compatible ? <Path testID="vo2-line" d={path} stroke={theme.colors.accentText} strokeWidth={2} fill="none" /> : null}
            <Line x1={x(selected.date)} x2={x(selected.date)} y1={0} y2={172} stroke={theme.colors.secondary} strokeDasharray="3,4" />
            {points.map((point, i) => <Circle key={`${point.date}-${i}`} testID={`vo2-point-${i}`} cx={x(point.date)} cy={y(point.value)} r={i === selectedIndex ? 6 : 4} stroke={i === selectedIndex ? theme.colors.text : 'none'} strokeWidth={2} fill={theme.colors.accentText} />)}
          </Svg> : null}
        </View>
      </View>
      <View style={styles.dates}><Text style={styles.caption}>{dateLabel(first.date)}</Text><Text style={styles.caption}>{dateLabel(latest.date)}</Text></View>
      <Text style={styles.caption}>{points.length} estimates · {days} recorded days</Text>
      <Text testID="vo2-selected" style={styles.inspection} accessibilityLiveRegion="polite">{`${dateLabel(selected.date)} · ${selected.value.toFixed(1)} mL/kg/min`}</Text>
      <Text style={styles.caption}>Slide horizontally to inspect · nonzero axis</Text>
    </> : <View style={styles.empty}>
      <Text style={styles.change}>No recorded VO₂ estimates in the past {range} days.</Text>
      <Text style={styles.caption}>{range < 180 ? 'Try a wider range to view earlier estimates.' : 'Only recorded HealthKit estimates are shown.'}</Text>
    </View>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: about }} style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => setAbout(!about)}><Text style={styles.link}>About this estimate</Text></Pressable>
    {about ? <Text style={styles.caption}>VO₂ originating device and estimation method are unknown. A generic HealthKit label is not source proof. VO₂ max is weight-relative: a higher value alone does not prove aerobic improvement. Read-only estimates; not a laboratory measurement or clinical assessment. Gaps over 14 days are not connected.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 20, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, gap: 10 },
  empty: { paddingVertical: 12, gap: 6 },
  title: { fontFamily: theme.font.medium, fontSize: 22, lineHeight: 28, color: theme.colors.text },
  eyebrow: { fontFamily: theme.font.regular, fontSize: 12, lineHeight: 18, color: theme.colors.secondary },
  caption: { fontFamily: theme.font.regular, fontSize: 12, lineHeight: 18, color: theme.colors.secondary },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  value: { fontFamily: theme.font.medium, fontSize: 40, color: theme.colors.text, fontVariant: ['tabular-nums'] },
  unit: { fontFamily: theme.font.regular, fontSize: 13, color: theme.colors.secondary },
  row: { flexDirection: 'row', gap: 10 },
  axis: { justifyContent: 'space-between', paddingVertical: 10 },
  plot: { flex: 1, height: 172 },
  dates: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, justifyContent: 'center' },
  ranges: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border },
  range: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: 10 },
  rangeLabel: { fontFamily: theme.font.medium, fontSize: 12, lineHeight: 18, color: theme.colors.secondary },
  selectedRange: { backgroundColor: theme.colors.border },
  selectedRangeLabel: { color: theme.colors.accentText },
  pressed: { opacity: 0.6 },
  inspection: { fontFamily: theme.font.medium, fontSize: 13, lineHeight: 20, color: theme.colors.accentText, fontVariant: ['tabular-nums'], borderLeftWidth: 2, borderLeftColor: theme.colors.accentText, paddingLeft: 10, paddingVertical: 6 },
  change: { color: theme.colors.text, fontFamily: theme.font.medium, fontSize: 16, fontVariant: ['tabular-nums'] },
  link: { fontFamily: theme.font.medium, fontSize: 13, color: theme.colors.accentText },
});
