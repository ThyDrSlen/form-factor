import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { localDB } from '@/lib/services/database/local-db';
import { useUnits } from '@/contexts/UnitsContext';
import {
  getWorkoutSessionHistoryDetail,
  listWorkoutSessionHistory,
  type WorkoutSessionHistorySummary,
  type WorkoutSessionHistoryDetail,
} from '@/lib/services/workout-session-history';
import { tabColors } from '@/styles/tabs/_tab-theme';

export default function SessionHistoryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={tabColors.textPrimary} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>Session History</Text>
      </View>
      {!user ? <View style={styles.state}><Text style={styles.secondary}>Sign in to view your session history.</Text></View>
        : !localDB.supportsWorkoutSync ? <View style={styles.state}><Text style={styles.secondary}>Session history is available in the mobile app.</Text></View>
        : <HistoryList key={`${user.id}:${sessionId ?? ""}`} userId={user.id} sessionId={sessionId} />}
    </SafeAreaView>
  );
}

function HistoryList({ userId, sessionId }: { userId: string; sessionId?: string }) {
  const [sessions, setSessions] = useState<WorkoutSessionHistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    listWorkoutSessionHistory(userId).then(rows => {
      if (current) setSessions(rows);
    }).catch(() => {
      if (current) setError(true);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [userId, attempt]);

  if (loading) return <ActivityIndicator accessibilityLabel="Loading session history" color={tabColors.accent} style={styles.state} />;
  if (error) return <View style={styles.state}><Text style={styles.secondary}>Could not load session history.</Text><Retry onPress={() => setAttempt(value => value + 1)} /></View>;
  return <FlatList
    data={sessionId ? [...sessions.filter(item => item.id === sessionId), ...sessions.filter(item => item.id !== sessionId)] : sessions}
    keyExtractor={item => item.id}
    contentContainerStyle={styles.list}
    ListHeaderComponent={<>
      <Text style={styles.intro}>Completed sessions · Quick logs stay in your workout log.</Text>
      {sessionId && !sessions.some(item => item.id === sessionId) ? <View style={styles.card}>
        <Text style={styles.secondary}>This session is not available in verified history yet. Connect and sync, then retry.</Text>
        <Retry onPress={() => setAttempt(value => value + 1)} />
      </View> : null}
    </>}
    ListEmptyComponent={sessionId ? null : <View style={styles.state}><Text style={styles.title}>No completed sessions yet</Text><Text style={styles.secondary}>Finish a workout session to see its completed exercises and sets here.</Text></View>}
    renderItem={({ item }) => <SessionCard summary={item} userId={userId} initiallyExpanded={item.id === sessionId} />}
  />;
}

function Retry({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}><Text style={styles.link}>Retry</Text></Pressable>;
}

function SessionCard({ summary, userId, initiallyExpanded = false }: { summary: WorkoutSessionHistorySummary; userId: string; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [detail, setDetail] = useState<WorkoutSessionHistoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { convertWeight, getWeightLabel } = useUnits();
  useEffect(() => {
    if (!expanded) return;
    let current = true;
    setLoading(true);
    setError(false);
    getWorkoutSessionHistoryDetail(userId, summary.id).then(result => {
      if (current) setDetail(result);
    }).catch(() => {
      if (current) setError(true);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [expanded, userId, summary.id, attempt]);
  return <View style={styles.card}>
    <Pressable testID={`session-card-${summary.id}`} accessibilityRole="button" accessibilityLabel={`${summary.name || 'Workout session'}, view completed sets`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}>
      <Text style={styles.secondary}>{new Date(summary.started_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</Text>
      <Text style={styles.title}>{summary.name || 'Workout session'}</Text>
      <Text style={styles.secondary}>{summary.completed_exercise_count} completed exercise{summary.completed_exercise_count === 1 ? '' : 's'}</Text>
      <Text style={styles.secondary}>{summary.completed_set_count} completed set{summary.completed_set_count === 1 ? '' : 's'}</Text>
      <Text style={styles.link}>{expanded ? 'Hide completed sets' : 'View completed sets'}</Text>
    </Pressable>
    {expanded ? <View style={styles.detail}>
      {loading ? <ActivityIndicator accessibilityLabel="Loading completed sets" color={tabColors.accent} /> : error ? <><Text style={styles.secondary}>Could not load completed sets.</Text><Retry onPress={() => setAttempt(value => value + 1)} /></> : !detail ? <Text style={styles.secondary}>This session is no longer available.</Text> : detail.exercises.length === 0 ? <Text style={styles.secondary}>No sets were marked complete in this session.</Text> : detail.exercises.map(exercise => <View key={exercise.id} style={styles.exercise}>
        <Text style={styles.exerciseName}>{exercise.name}</Text>
        {exercise.sets.map(set => {
          const values = [
            set.actual_reps !== null ? `${set.actual_reps} reps` : null,
            set.actual_seconds !== null ? `${set.actual_seconds} sec` : null,
            set.actual_weight !== null ? `${Number(convertWeight(set.actual_weight / 2.20462).toFixed(1))} ${getWeightLabel()}` : null,
          ].filter(Boolean);
          return <Text key={set.id} style={styles.secondary}>Set {set.sort_order + 1} · {values.length ? values.join(' · ') : 'Completed — no measurements recorded'}</Text>;
        })}
      </View>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tabColors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tabColors.border },
  title: { color: tabColors.textPrimary, fontFamily: 'Lexend_700Bold', fontSize: 18, marginVertical: 4 },
  secondary: { color: tabColors.textSecondary, fontFamily: 'Lexend_400Regular', fontSize: 14, lineHeight: 22 },
  intro: { color: tabColors.textSecondary, fontFamily: 'Lexend_400Regular', marginBottom: 16, lineHeight: 22 },
  list: { padding: 16, paddingBottom: 48, flexGrow: 1 },
  card: { backgroundColor: tabColors.overlaySubtle, borderRadius: 14, borderColor: tabColors.border, borderWidth: 1, padding: 16, marginBottom: 12 },
  detail: { marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tabColors.border },
  exercise: { marginBottom: 12, gap: 4 },
  exerciseName: { color: tabColors.textPrimary, fontFamily: 'Lexend_500Medium', fontSize: 16 },
  link: { color: tabColors.accent, fontFamily: 'Lexend_500Medium', marginTop: 8 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  action: { padding: 12, minHeight: 44 },
});
