import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '@/styles/theme';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { useHealthKit } from '@/features/health/contexts/HealthKitContext';
import { PersonalCoachingInsights } from './PersonalCoachingInsights';
import { TrendContextPanel } from './TrendContextPanel';
import { BodyCompositionCard } from './BodyCompositionCard';
import { getStepHistoryAsync, type HealthMetricPoint } from '@/lib/services/healthkit/health-metrics';

export function HealthInsightsExtras() {
  const { user } = useAuth();
  const { recordedWeightHistory = [], stepHistory = [], isAvailable, lastUpdatedAt } = useHealthKit();
  const owner = user?.id;
  const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [expanded, setExpanded] = useState<'training' | 'body' | 'context' | null>(null);
  const [history, setHistory] = useState<{owner: string; points: HealthMetricPoint[]} | null>(null);
  useEffect(() => {
    let active = true;
    setHistory(null);
    if (owner && isAvailable && expanded === 'context') {
      void getStepHistoryAsync(180).then(points => {
        if (active) setHistory({owner, points});
      }).catch(() => { /* Keep the existing short history; coverage remains explicit. */ });
    }
    return () => { active = false; };
  }, [owner, isAvailable, lastUpdatedAt, expanded]);
  const weightObservations = recordedWeightHistory.map(point => ({
    date: point.dayKey, value: point.value, observed: point.provenance === 'observed', source: point.source, unit: point.unit,
  }));
  // Zeroes in this legacy daily array may be missing-data padding, not observations.
  const stepSeries = history?.owner === owner && history?.points.length ? history.points : stepHistory;
  const stepObservations = stepSeries.filter(point => Number.isFinite(point.date) && Number.isFinite(point.value) && point.value > 0)
    .map(point => ({date:new Date(point.date).toISOString().slice(0,10), value:point.value, observed:true, source:'HealthKit daily totals', unit:'steps'}));
  return <View style={styles.sections}>
    <Text accessibilityRole="header" style={styles.title}>Explore your patterns</Text>
    <Text style={styles.subtitle}>Choose a question to explore. Insights use your recorded history.</Text>
    {([
      ['training', 'Recovery & training', 'How do session spacing and tracked form relate?'],
      ['body', 'Body composition', 'Optional measured body-fat history'],
      ['context', 'Trips & routine changes', 'Compare recorded trends before, during and after'],
    ] as const).map(([id, title, subtitle]) => <View key={id} style={styles.group}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{expanded: expanded === id}}
        onPress={() => setExpanded(expanded === id ? null : id)} style={({pressed}) => [styles.row, expanded === id && styles.rowExpanded, pressed && styles.pressed]}>
        <View style={styles.rowContent}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Text importantForAccessibility="no" accessibilityElementsHidden style={styles.indicator}>{expanded === id ? '−' : '+'}</Text>
      </Pressable>
      {expanded === id && id === 'training' ? <PersonalCoachingInsights /> : null}
      {expanded === id && id === 'body' ? <BodyCompositionCard ownerId={user?.id} /> : null}
      {expanded === id && id === 'context' ? <TrendContextPanel ownerId={user?.id} weightObservations={weightObservations} stepObservations={stepObservations} /> : null}
    </View>)}
    <Pressable accessibilityRole="button" accessibilityLabel="Data & privacy" accessibilityState={{expanded: privacyExpanded}} onPress={() => setPrivacyExpanded(!privacyExpanded)} style={({pressed}) => [styles.privacyButton, pressed && styles.pressed]}>
      <Text style={styles.privacyLabel}>Data & privacy</Text>
    </Pressable>
    {privacyExpanded ? <Text style={styles.subtitle}>Health readings come from this device’s Health store, not a separate app-account health profile. Trip notes and training records are kept separate by account. Trip notes stay on this device; no location tracking is enabled here.</Text> : null}
  </View>;
}
const styles=StyleSheet.create({
  sections:{gap:12},
  group:{gap:12},
  row:{padding:18,minHeight:80,borderRadius:theme.radius.card,backgroundColor:theme.colors.surface,gap:12,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:theme.colors.border},
  rowExpanded:{borderColor:theme.colors.accentText},
  rowContent:{flex:1,gap:6},
  rowTitle:{color:theme.colors.text,fontSize:16,fontFamily:theme.font.medium},
  title:{color:theme.colors.text,fontSize:20,fontFamily:theme.font.medium},
  subtitle:{color:theme.colors.secondary,fontSize:13,lineHeight:20,fontFamily:theme.font.regular},
  indicator:{color:theme.colors.accentText,fontSize:24,width:24,textAlign:'center'},
  pressed:{opacity:0.72},
  privacyButton:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',paddingHorizontal:8},
  privacyLabel:{color:theme.colors.accentText,fontSize:13,fontFamily:theme.font.medium},
});
