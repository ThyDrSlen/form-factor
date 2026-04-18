import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { FaultGlossaryChip } from '@/components/form-tracking/FaultGlossaryChip';
import { FaultSynthesisChip } from '@/components/form-tracking/FaultSynthesisChip';
import type { FaultFrequencyHint } from '@/lib/services/fault-explainer';
import {
  clearGlobalSynthesisCache,
  getGlobalSynthesisCacheStats,
} from '@/lib/services/fault-explainer-bootstrap';

interface Cluster {
  id: string;
  exerciseLabel: string;
  exerciseId: string;
  faultIds: string[];
  history?: FaultFrequencyHint[];
}

const CLUSTERS: Cluster[] = [
  {
    id: 'squat-depth',
    exerciseLabel: 'Squat — depth cluster',
    exerciseId: 'squat',
    faultIds: ['shallow_depth', 'forward_lean', 'hip_shift'],
    history: [
      { faultId: 'shallow_depth', occurrencesInLastNSessions: 4, sessionsSince: 0 },
      { faultId: 'forward_lean', occurrencesInLastNSessions: 3, sessionsSince: 1 },
    ],
  },
  {
    id: 'pushup-sag',
    exerciseLabel: 'Push-up — trunk sag cluster',
    exerciseId: 'pushup',
    faultIds: ['hip_sag', 'elbow_flare', 'shallow_depth'],
  },
  {
    id: 'deadlift-lockout',
    exerciseLabel: 'Deadlift — back-half cluster',
    exerciseId: 'deadlift',
    faultIds: ['hips_rise_first', 'rounded_back', 'incomplete_lockout'],
    history: [
      { faultId: 'rounded_back', occurrencesInLastNSessions: 2, sessionsSince: 2 },
    ],
  },
];

export default function FaultSynthesisLabScreen() {
  const [lowGate, setLowGate] = useState(false);
  const [stats, setStats] = useState(() => getGlobalSynthesisCacheStats());

  useEffect(() => {
    const timer = setInterval(() => {
      setStats(getGlobalSynthesisCacheStats());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const hitRate =
    stats.hits + stats.misses > 0
      ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100)
      : 0;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Fault synthesis lab' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Gemma · phase 0</Text>
          <Text style={styles.title}>Fault synthesis lab</Text>
          <Text style={styles.subtitle}>
            Hand-picked co-occurring fault clusters. Each card shows the per-fault chips we render
            today (yellow) and the new synthesized root-cause chip (blue) that collapses the
            cluster into a single line. The active runner falls back to a static synthesizer until
            the Edge Function or on-device Gemma lands.
          </Text>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Show low-confidence chips</Text>
            <Switch value={lowGate} onValueChange={setLowGate} />
          </View>
        </View>

        <View style={styles.statsCard}>
          <View style={styles.statsHeader}>
            <Text style={styles.statsTitle}>Cache stats</Text>
            <Pressable
              onPress={() => {
                clearGlobalSynthesisCache();
                setStats(getGlobalSynthesisCacheStats());
              }}
              accessibilityRole="button"
              style={styles.clearButton}
              testID="fault-synthesis-clear-cache"
            >
              <Text style={styles.clearButtonText}>Clear</Text>
            </Pressable>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{stats.hits}</Text>
              <Text style={styles.statLabel}>Hits</Text>
            </View>
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{stats.misses}</Text>
              <Text style={styles.statLabel}>Misses</Text>
            </View>
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{hitRate}%</Text>
              <Text style={styles.statLabel}>Hit rate</Text>
            </View>
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{stats.size}</Text>
              <Text style={styles.statLabel}>Entries</Text>
            </View>
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{stats.evictions}</Text>
              <Text style={styles.statLabel}>Evictions</Text>
            </View>
          </View>
        </View>

        {CLUSTERS.map((cluster) => (
          <View key={cluster.id} style={styles.card}>
            <Text style={styles.cardTitle}>{cluster.exerciseLabel}</Text>

            <FaultSynthesisChip
              exerciseId={cluster.exerciseId}
              faultIds={cluster.faultIds}
              recentHistory={cluster.history}
              minConfidence={lowGate ? 0 : 0.3}
            />

            <View style={styles.chipRow}>
              {cluster.faultIds.map((faultId) => (
                <FaultGlossaryChip
                  key={`${cluster.id}-${faultId}`}
                  exerciseId={cluster.exerciseId}
                  faultId={faultId}
                />
              ))}
            </View>

            {cluster.history && cluster.history.length > 0 ? (
              <Text style={styles.historyHint}>
                Recent history: {cluster.history
                  .map((h) => `${h.faultId} ×${h.occurrencesInLastNSessions}`)
                  .join(', ')}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#06101d',
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 16,
  },
  header: {
    gap: 8,
    paddingBottom: 8,
  },
  eyebrow: {
    color: '#60A5FA',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#F5F7FF',
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: '#0F2540',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    marginTop: 12,
  },
  toggleLabel: {
    color: '#E6EEFB',
    fontSize: 13,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#0C1A2E',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2E4A',
    gap: 10,
  },
  cardTitle: {
    color: '#F5F7FF',
    fontSize: 15,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 2,
  },
  historyHint: {
    color: '#6B7A94',
    fontSize: 11,
    fontStyle: 'italic',
  },
  statsCard: {
    backgroundColor: '#0A1626',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#14263F',
    gap: 10,
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statsTitle: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  clearButtonText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statBlock: {
    flex: 1,
    alignItems: 'flex-start',
  },
  statValue: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    color: '#6B7A94',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 2,
  },
});
