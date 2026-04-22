/**
 * CoachHistoryScreen
 *
 * Shows past coach conversation sessions with date, message preview,
 * turn count, and relative time. Supports cursor-based pagination.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useRelativeTime } from '@/hooks/use-relative-time';
import {
  fetchCoachSessions,
  type CoachSessionSummary,
} from '@/lib/services/coach-history-service';
import { tabColors } from '@/styles/tabs/_tab-theme';
import { styles } from '@/styles/tabs/_coach-history.styles';

/** Format: "Mon, Mar 24" */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Format: "2h ago", "5m ago", "just now" */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function SessionCard({
  session,
  onPress,
}: {
  session: CoachSessionSummary;
  onPress: () => void;
}) {
  const preview =
    session.firstMessage.length > 80
      ? session.firstMessage.slice(0, 77) + '...'
      : session.firstMessage;
  // Re-render the "Xm ago" label every minute so stale sessions don't
  // freeze at their initial-mount value.
  const relativeTime = useRelativeTime(session.createdAt, formatRelativeTime);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{formatDate(session.createdAt)}</Text>
        <View style={styles.cardTurnBadge}>
          <Text style={styles.cardTurnText}>
            {session.turnCount} turn{session.turnCount !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
      <Text style={styles.cardPreview} numberOfLines={2}>
        {preview}
      </Text>
      <Text style={styles.cardTime}>{relativeTime}</Text>
    </TouchableOpacity>
  );
}

export default function CoachHistoryScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [sessions, setSessions] = useState<CoachSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(
    async (mode: 'reset' | 'more') => {
      if (!user) {
        setLoading(false);
        return;
      }

      const isReset = mode === 'reset';
      if (isReset) {
        setLoading(true);
        setError(null);
      } else {
        if (!cursor || loadingMore) return;
        setLoadingMore(true);
      }

      try {
        const result = await fetchCoachSessions(
          user.id,
          isReset ? undefined : (cursor ?? undefined),
        );

        setCursor(result.nextCursor);
        if (isReset) {
          setSessions(result.sessions);
        } else {
          setSessions((prev) => [...prev, ...result.sessions]);
        }
      } catch (err) {
        console.warn('[coach-history] Failed to load sessions:', err);
        if (isReset) {
          setSessions([]);
          setCursor(null);
          setError('Unable to load your coach history right now.');
        }
      } finally {
        if (isReset) {
          setLoading(false);
          setRefreshing(false);
        } else {
          setLoadingMore(false);
        }
      }
    },
    [user, cursor, loadingMore],
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadSessions('reset');
  }, [loadSessions]);

  useEffect(() => {
    void loadSessions('reset');
  }, [loadSessions]);

  const handleSessionPress = useCallback(
    (session: CoachSessionSummary) => {
      router.push(
        `/(tabs)/coach?restoreSessionId=${session.sessionId}` as const,
      );
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: CoachSessionSummary }) => (
      <SessionCard session={item} onPress={() => handleSessionPress(item)} />
    ),
    [handleSessionPress],
  );

  const keyExtractor = useCallback(
    (item: CoachSessionSummary) => item.sessionId,
    [],
  );

  const renderFooter = useCallback(() => {
    if (!cursor) return null;
    return (
      <TouchableOpacity
        style={styles.loadMoreButton}
        onPress={() => void loadSessions('more')}
        disabled={loadingMore}
      >
        {loadingMore ? (
          <ActivityIndicator color={tabColors.accent} />
        ) : (
          <Text style={styles.loadMoreText}>Load more</Text>
        )}
      </TouchableOpacity>
    );
  }, [cursor, loadingMore, loadSessions]);

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Ionicons
          name="chatbubbles-outline"
          size={64}
          color={tabColors.textSecondary}
        />
        <Text style={styles.emptyTitle}>No Conversations Yet</Text>
        <Text style={styles.emptySubtitle}>
          Start chatting with your coach to see your history here.
        </Text>
      </View>
    ),
    [],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={tabColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Coach History</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={tabColors.accent} />
        </View>
      ) : error ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={64}
            color={tabColors.textSecondary}
          />
          <Text style={styles.emptyTitle}>Couldn&apos;t Load History</Text>
          <Text style={styles.emptySubtitle}>{error}</Text>
          <TouchableOpacity
            style={styles.loadMoreButton}
            onPress={() => void loadSessions('reset')}
          >
            <Text style={styles.loadMoreText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            sessions.length === 0 && { flex: 1 },
          ]}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={tabColors.accent}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
