import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePersonalCoachingInsights } from '@/features/health/hooks/use-personal-coaching-insights';
import { theme } from '@/styles/theme';

/** Self-contained; mount under existing AuthProvider. No HealthKit permission request. */
export function PersonalCoachingInsights() {
  const { signedIn, loading, error, data, refresh } = usePersonalCoachingInsights();
  return (
    <View style={styles.card} testID="personal-coaching-insights">
      <Text accessibilityRole="header" style={styles.title}>Your training patterns</Text>
      <Text style={styles.meta}>Personal statistical learning • calculated on this device</Text>
      {!signedIn ? <Text style={styles.body}>Sign in to view your personal insights.</Text> : loading ? (
        <Text style={styles.body}>Learning from your existing records…</Text>
      ) : error ? <Text accessibilityRole="alert" style={styles.body}>{error}</Text> : data ? (
        <>
          {data.warnings?.map(warning => <Text key={warning} accessibilityRole="alert" style={styles.body}>{warning}</Text>)}
          <Text style={styles.heading}>Tracked-bout spacing × form</Text>
          {data.learning.status === 'validated' && data.learning.model ? (
            <Text style={styles.body}>
              Tentative association for {data.learning.exercise}: longer gaps between tracked bouts were associated with {data.learning.model.slope > 0 ? 'higher' : 'lower'} FQI within {data.learning.model.minHours.toFixed(0)}–{data.learning.model.maxHours.toFixed(0)} hours. Not causal; do not change training from this alone.
            </Text>
          ) : (
            <Text style={styles.body}>{data.learning.status === 'insufficient'
              ? 'Not enough paired history or spacing variation. Need at least 20 earlier and 10 later same-exercise sessions on separate UTC calendar days, each with at least 3 scored reps.'
              : 'No reliable personal association yet: the model did not pass the later-session validation gates.'}</Text>
          )}
          <Text style={styles.meta}>{data.learning.sampleCount} eligible session-days • {data.learning.trainCount} earlier / {data.learning.holdoutCount} later sessions</Text>
          {data.learning.modelMae !== null && data.learning.baselineMae !== null ? (
            <Text style={styles.meta}>Later-session mean absolute error: model {data.learning.modelMae.toFixed(1)} vs personal-mean baseline {data.learning.baselineMae.toFixed(1)} FQI points. Required improvement: at least 1 point and more than 10%, without extrapolation.</Text>
          ) : null}
          <Text style={styles.meta}>One shrunken linear model, one exercise selected by sample count; last 30% held out. Confidence is at most tentative, not statistical significance. Untracked exercise, load, camera quality and routine changes can explain this pattern. Sleep, HRV and physiological recovery are not inferred.</Text>
          <View style={styles.divider} />
          <Text style={styles.heading}>Working-set rep-range distribution</Text>
          <Text style={styles.body}>Rule-based rep-range support: {data.training.score === null ? 'unknown (need 3 known working sets)' : `${data.training.score}/100`}</Text>
          <Text style={styles.meta}>Rule: 100 × working sets with 5–30 reps ÷ working sets with known positive reps. {data.training.inRangeSets}/{data.training.eligibleSets} observed sets; {data.training.unknownSets} missing reps; {data.training.excludedSets} warm-up, timed or unsupported sets excluded.</Text>
          <Text style={styles.meta}>Latest {data.sessionCount} completed local sessions (up to 30), within 120 days. Form history: existing synced reps within 120 days. Quick logs are not included.</Text>
          {data.training.limitations.map(line => <Text key={line} style={styles.meta}>{line}</Text>)}
          <Text style={styles.body}>Overall hypertrophy quality: unknown. This narrow rating is not a recommendation to add sets or chase a score.</Text>
        </>
      ) : null}
      {signedIn ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh personal insights" disabled={loading} onPress={() => { void refresh(); }} style={styles.button}>
          <Text style={styles.buttonText}>{loading ? 'Loading…' : 'Refresh insights'}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.meta}>Existing records only; no new permissions or uploads. Not medical advice or an injury prediction.</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, gap: 10, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  heading: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  body: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  meta: { fontSize: 12, lineHeight: 18, color: theme.colors.secondary },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border },
  buttonText: { fontSize: 14, color: theme.colors.text, fontWeight: '600' },
});
