/**
 * SessionTimelineScreen (modal)
 *
 * Unified view of recent workout + scan-arkit sessions. Data comes from
 * `session-timeline-service`; the service currently reads workouts from
 * local SQLite and expects scan sessions to be passed in from a caller
 * once scan-persistence lands (see the service's TODO).
 *
 * Entries are grouped into date buckets (Today / Yesterday / This week /
 * Last week / This month / Older) and tapping an entry drills into
 * /(modals)/workout-insights (workout) or surfaces a toast for scans
 * (detail screen is TODO).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { tabColors } from '@/styles/tabs/_tab-theme';
import {
  getUnifiedTimeline,
  groupByDateBucket,
  type TimelineEntry,
  type TimelineSection,
} from '@/lib/services/session-timeline-service';

// =============================================================================
// Screen
// =============================================================================

export default function SessionTimelineScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO(scan-persistence): pass options.scanSessions once scan
      // sessions land in a durable store.
      const timeline = await getUnifiedTimeline(userId, 30);
      setEntries(timeline);
    } catch (err) {
      console.error('[SessionTimelineScreen] load failed', err);
      setError('Failed to load timeline.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo<TimelineSection[]>(
    () => groupByDateBucket(entries),
    [entries],
  );

  const sectionListData = useMemo(
    () =>
      sections.map((s) => ({
        title: s.label,
        data: s.entries,
      })),
    [sections],
  );

  const handlePress = useCallback(
    (entry: TimelineEntry) => {
      if (entry.href) {
        router.push(entry.href as never);
      }
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: TimelineEntry }) => (
      <Pressable
        onPress={() => handlePress(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.title} ${item.type} session`}
        style={styles.row}
        testID={`timeline-row-${item.id}`}
        disabled={!item.href}
      >
        <View
          style={[
            styles.typeBadge,
            item.type === 'scan' ? styles.typeBadgeScan : styles.typeBadgeWorkout,
          ]}
        >
          <Ionicons
            name={item.type === 'scan' ? 'scan-outline' : 'barbell-outline'}
            size={14}
            color={item.type === 'scan' ? '#00C28C' : '#4C8CFF'}
          />
          <Text
            style={[
              styles.typeBadgeText,
              { color: item.type === 'scan' ? '#00C28C' : '#4C8CFF' },
            ]}
          >
            {item.type === 'scan' ? 'Scan' : 'Workout'}
          </Text>
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}
        </View>

        {item.href ? (
          <Ionicons name="chevron-forward" size={18} color="#8E8E93" />
        ) : null}
      </Pressable>
    ),
    [handlePress],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <Text style={styles.sectionHeader}>{section.title}</Text>
    ),
    [],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.navBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={tabColors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Session timeline</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={tabColors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color="#FF3B30" />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Ionicons
            name="calendar-outline"
            size={48}
            color={tabColors.textSecondary}
          />
          <Text style={styles.emptyTitle}>No sessions yet</Text>
          <Text style={styles.emptySub}>
            Your workouts and form scans will appear here once you log one.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sectionListData}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
    </SafeAreaView>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tabColors.background,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tabColors.border,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionHeader: {
    fontSize: 12,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
    marginBottom: 10,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeBadgeWorkout: {
    backgroundColor: '#4C8CFF20',
  },
  typeBadgeScan: {
    backgroundColor: '#00C28C20',
  },
  typeBadgeText: {
    fontSize: 11,
    fontFamily: 'Lexend_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    marginTop: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    marginTop: 12,
    textAlign: 'center',
  },
  retry: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#4C8CFF',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Lexend_700Bold',
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.textPrimary,
    marginTop: 10,
  },
  emptySub: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
});
