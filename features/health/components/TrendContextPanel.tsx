import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/styles/theme';
import { useTrendContext } from '@/features/health/hooks/use-trend-context';
import { compareTrendContext, TREND_CONTEXT_KINDS, type TrendContextAnnotation, type TrendContextKind, type TrendContextObservation } from '@/lib/services/healthkit/trend-context';

export interface TrendContextPanelProps {
  /** Supply the current authenticated user's ID. Incoming series must belong to this owner. */
  ownerId: string | null | undefined;
  weightObservations?: readonly TrendContextObservation[];
  /** Recorded daily totals only. Missing/unauthorized days must not become observed zeroes. */
  stepObservations?: readonly TrendContextObservation[];
}
const EMPTY: readonly TrendContextObservation[] = [];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ContextComparison({ annotation, observations, metric }: {
  annotation: TrendContextAnnotation; observations: readonly TrendContextObservation[]; metric: 'weight' | 'steps';
}) {
  const comparison = useMemo(() => compareTrendContext(annotation, observations, metric), [annotation, observations, metric]);
  const unit = comparison.periods.flatMap(p => p.units)[0] ?? (metric === 'steps' ? 'steps' : '');
  return <View style={styles.comparison}>
    <Text style={styles.heading}>{metric === 'weight' ? 'Weight' : 'Steps'} · recorded-day averages</Text>
    <Text style={styles.caption}>HealthKit is a shared data source, not a device identifier. When labeled HealthKit, the originating device or scale is unknown. These are descriptive comparisons; changes may reflect different sources rather than your trip or routine.</Text>
    {comparison.periods.map(period => <View key={period.label} style={styles.period}>
      <Text style={styles.text}>{period.label}: {period.startDate} to {period.endDate}</Text>
      <Text style={styles.text}>{period.mean === null ? 'No comparable readings' : `${period.mean.toFixed(metric === 'weight' ? 1 : 0)} ${period.units[0]}`} · {period.recordedDays}/{period.expectedDays} recorded days · {period.observations} observations</Text>
      <Text style={styles.caption}>Sources: {period.sources.join(', ') || 'none'}</Text>
      <Text style={styles.caption}>Window weekdays: {period.weekdayCounts.map((count, i) => `${WEEKDAYS[i]} ${count}`).join(', ')}</Text>
    </View>)}
    {comparison.reason ? <Text style={styles.caption}>{comparison.reason}</Text> : <Text style={styles.text}>
      During minus before: {comparison.duringMinusBefore!.toFixed(metric === 'weight' ? 1 : 0)} {unit}. After minus before: {comparison.afterMinusBefore!.toFixed(metric === 'weight' ? 1 : 0)} {unit}.
    </Text>}
  </View>;
}

/** Key the inner editor so private unsaved fields cannot survive account transitions. */
export function TrendContextPanel(props: TrendContextPanelProps) {
  return <ContextEditor key={props.ownerId || 'signed-out'} {...props} />;
}
function ContextEditor({ ownerId, weightObservations = EMPTY, stepObservations = EMPTY }: TrendContextPanelProps) {
  const context = useTrendContext(ownerId);
  const [kind, setKind] = useState<TrendContextKind>('Vacation');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [city, setCity] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const disabled = !context.ready || context.loading || context.saving;
  async function save() {
    if (await context.add({ kind, startDate, endDate, city })) { setCity(''); setStartDate(''); setEndDate(''); }
  }
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Optional context</Text>
    <Text style={styles.caption}>Manually label a past period: Vacation, Travel, Illness or New routine. City is optional; no GPS or location inference.</Text>
    <Text style={styles.caption}>Saved only on this device for this account, not uploaded or encrypted by this feature. Delete an annotation below to remove it from local storage.</Text>
    {!ownerId ? <Text style={styles.text}>Sign in to keep context separate by account.</Text> : <>
      <View style={styles.choices}>{TREND_CONTEXT_KINDS.map(label => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ selected: kind === label, disabled: context.saving }} disabled={context.saving} onPress={() => setKind(label)} style={[styles.button, kind === label && styles.selected]}>
        <Text style={styles.text}>{label}</Text>
      </Pressable>)}</View>
      {([
        ['Start date (YYYY-MM-DD)', startDate, setStartDate],
        ['End date (YYYY-MM-DD)', endDate, setEndDate],
        ['City (optional)', city, setCity],
      ] as const).map(([label, value, onChangeText]) => <View key={label} style={styles.field}>
        <Text style={styles.text}>{label}</Text>
        <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={!context.saving}
          autoCapitalize="none" autoCorrect={false} maxLength={label === 'City (optional)' ? 80 : 10} style={styles.input} />
      </View>)}
      <Pressable accessibilityRole="button" accessibilityLabel="Save context" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { void save(); }} style={[styles.button, disabled && styles.disabled]}>
        <Text style={styles.text}>{context.saving ? 'Saving…' : 'Save context'}</Text>
      </Pressable>
      {context.loading ? <ActivityIndicator accessibilityLabel="Loading local context" color={theme.colors.accentText} /> : null}
      {context.error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{context.error}</Text> : null}
      {!context.ready && !context.loading ? <Pressable accessibilityRole="button" onPress={() => { void context.retry(); }} style={styles.button}><Text style={styles.text}>Retry loading context</Text></Pressable> : null}
      {context.ready && context.annotations.length === 0 ? <Text style={styles.caption}>No context added. This is optional.</Text> : null}
      {context.annotations.map(annotation => {
        const label = `${annotation.kind} ${annotation.startDate} to ${annotation.endDate}`;
        return <View key={annotation.id} style={styles.annotation}>
          <Text style={styles.heading}>{annotation.kind}{annotation.city ? ` · ${annotation.city}` : ''}</Text>
          <Text style={styles.text}>{annotation.startDate} to {annotation.endDate}</Text>
          <View style={styles.choices}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Compare ${label}`} accessibilityState={{ expanded: expanded === annotation.id }} onPress={() => setExpanded(expanded === annotation.id ? null : annotation.id)} style={styles.button}><Text style={styles.text}>Before / during / after</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${label}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { void context.remove(annotation.id); }} style={styles.button}><Text style={styles.error}>Delete</Text></Pressable>
          </View>
          {expanded === annotation.id ? <>
            <ContextComparison annotation={annotation} observations={weightObservations} metric="weight" />
            <ContextComparison annotation={annotation} observations={stepObservations} metric="steps" />
            <Text style={styles.caption}>These equal-duration windows describe readings around your tagged period, not evidence that the tagged event caused a change. Weekday mix, missing readings and other changes may differ. Sparse weight readings may not represent a whole period. No location pattern is inferred.</Text>
            <Text style={styles.caption}>Differences require at least two recorded days per window; steps also require at least half the days. This is a display rule, not a statistical significance test. Weekdays are not adjusted.</Text>
          </> : null}
        </View>;
      })}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.card, padding: 16, gap: 12 },
  title: { color: theme.colors.text, fontFamily: theme.font.bold, fontSize: 18 },
  heading: { color: theme.colors.text, fontFamily: theme.font.medium, fontSize: 14 },
  text: { color: theme.colors.text, fontFamily: theme.font.regular, fontSize: 13 },
  caption: { color: theme.colors.secondary, fontFamily: theme.font.regular, fontSize: 12, lineHeight: 19 },
  error: { color: theme.colors.danger, fontFamily: theme.font.regular, fontSize: 13 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: theme.radius.button, backgroundColor: theme.colors.elevated, borderWidth: 1, borderColor: theme.colors.border },
  selected: { borderColor: theme.colors.accentText },
  disabled: { opacity: 0.5 },
  field: { gap: 6 },
  input: { color: theme.colors.text, fontFamily: theme.font.regular, minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.input, padding: 10 },
  annotation: { borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 12, gap: 10 },
  comparison: { gap: 8 },
  period: { gap: 3 },
});
