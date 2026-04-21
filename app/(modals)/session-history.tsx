/**
 * SessionHistoryScreen
 *
 * Shows past completed workout sessions with date, name, exercise count,
 * and total volume.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { localDB } from '@/lib/services/database/local-db';
import { tabColors } from '@/styles/tabs/_tab-theme';
import { EmptySessionState } from '@/components/form-tracking/EmptySessionState';

interface SessionSummary {
  id: string;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  goal_profile: string;
  exercise_count: number;
  set_count: number;
}

export default function SessionHistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const db = localDB.db;
    if (!db) {
      setError('Failed to load. Tap to retry.');
      setLoading(false);
      return;
    }
    setError(null);

    try {
      setError(null);
      setLoading(true);
      const rows = await db.getAllAsync<SessionSummary>(`
        SELECT
          ws.id,
          ws.name,
          ws.started_at,
          ws.ended_at,
          ws.goal_profile,
          (SELECT COUNT(*) FROM workout_session_exercises wse
           WHERE wse.session_id = ws.id AND wse.deleted = 0) as exercise_count,
          (SELECT COUNT(*) FROM workout_session_sets wss
           JOIN workout_session_exercises wse2 ON wse2.id = wss.session_exercise_id
           WHERE wse2.session_id = ws.id AND wss.deleted = 0 AND wse2.deleted = 0) as set_count
        FROM workout_sessions ws
        WHERE ws.deleted = 0 AND ws.ended_at IS NOT NULL
        ORDER BY ws.started_at DESC
      `);
      setSessions(rows);
      setError(null);
    } catch (error) {
      console.error('[SessionHistory] Failed to load sessions:', error);
      setError('Failed to load. Tap to retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const formatDate = useCallback((iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, []);

  const formatDuration = useCallback((start: string, end: string | null): string => {
    if (!end) return '-';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: SessionSummary }) => (
      <TouchableOpacity
        style={historyStyles.card}
        testID={`session-card-${item.id}`}
        onPress={() => {
          router.push(`/form-quality-recovery?sessionId=${encodeURIComponent(item.id)}`);
        }}
      >
        <View style={historyStyles.cardHeader}>
          <Text style={historyStyles.cardDate}>{formatDate(item.started_at)}</Text>
          <Text style={historyStyles.cardDuration}>
            {formatDuration(item.started_at, item.ended_at)}
          </Text>
        </View>
        {item.name && <Text style={historyStyles.cardName}>{item.name}</Text>}
        <View style={historyStyles.cardStats}>
          <Text style={historyStyles.cardStat}>
            {item.exercise_count} exercise{item.exercise_count !== 1 ? 's' : ''}
          </Text>
          <Text style={historyStyles.cardStatSep}>&middot;</Text>
          <Text style={historyStyles.cardStat}>
            {item.set_count} set{item.set_count !== 1 ? 's' : ''}
          </Text>
          <Text style={historyStyles.cardStatSep}>&middot;</Text>
          <Text style={[historyStyles.cardStat, { color: tabColors.accent }]}>
            {item.goal_profile}
          </Text>
        </View>
        <View style={historyStyles.cardFooter}>
          <Text style={historyStyles.cardLink}>Review form quality →</Text>
        </View>
      </TouchableOpacity>
    ),
    [formatDate, formatDuration, router],
  );

  return (
    <SafeAreaView style={historyStyles.container} edges={['top']}>
      {/* Header */}
      <View style={historyStyles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color={tabColors.textPrimary} />
        </TouchableOpacity>
        <Text style={historyStyles.headerTitle}>Session History</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tabColors.accent} />
        </View>
      ) : error ? (
        <View style={historyStyles.stateContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
          <Text style={historyStyles.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={() => {
              setError(null);
              void loadSessions();
            }}
            style={historyStyles.retryButton}
          >
            <Text style={historyStyles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : sessions.length === 0 ? (
        <EmptySessionState />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const historyStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tabColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tabColors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  card: {
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardDate: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
  },
  cardDuration: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
  },
  cardName: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
    marginTop: 4,
    marginBottom: 4,
  },
  cardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  cardStat: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
  },
  cardStatSep: {
    fontSize: 12,
    color: tabColors.textSecondary,
  },
  cardFooter: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  cardLink: {
    fontSize: 12,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.accent,
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 16,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    marginTop: 12,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: tabColors.accent,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontFamily: 'Lexend_700Bold',
  },
});
