/**
 * RepPainJournalScreen (modal)
 *
 * Scrollable timeline of pain/injury flags logged across the user's
 * sessions. Flags are pulled from on-device AsyncStorage via
 * `rep-pain-journal` — server sync is stubbed pending a migration (see
 * `syncToSupabase` in that file).
 *
 * Reached via the workouts tab header menu.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import {
  deletePainFlag,
  getPainFlags,
  PAIN_LOCATION_LABELS,
  type PainFlag,
} from '@/lib/services/rep-pain-journal';
import { useAuth } from '@/contexts/AuthContext';
import { tabColors } from '@/styles/tabs/_tab-theme';

// =============================================================================
// Helpers
// =============================================================================

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const hr = ms / (60 * 60 * 1000);
  if (hr < 1) return 'Just now';
  if (hr < 24) return `${Math.round(hr)}h ago`;
  const days = Math.round(hr / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function severityColor(sev: number): string {
  if (sev >= 4) return '#FF3B30';
  if (sev === 3) return '#FF9500';
  return '#4C8CFF';
}

// =============================================================================
// Screen
// =============================================================================

export default function RepPainJournalScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [flags, setFlags] = useState<PainFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setFlags([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getPainFlags(userId, 90);
      setFlags(result);
    } catch (err) {
      setError('Failed to load pain journal.');
      console.error('[RepPainJournalScreen] load failed', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = useCallback(
    async (flagId: string) => {
      if (!userId) return;
      await deletePainFlag(userId, flagId);
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
    },
    [userId],
  );

  const renderItem = useCallback(
    ({ item }: { item: PainFlag }) => (
      <View style={styles.card} testID={`pain-flag-${item.id}`}>
        <View style={styles.cardHeader}>
          <View style={styles.locationBadge}>
            <Ionicons
              name="medkit-outline"
              size={14}
              color={severityColor(item.severity)}
            />
            <Text style={styles.locationText}>
              {PAIN_LOCATION_LABELS[item.location] ?? item.location}
            </Text>
          </View>
          <Text style={styles.when}>{formatWhen(item.createdAt)}</Text>
        </View>

        <View style={styles.severityRow}>
          <Text
            style={[styles.severity, { color: severityColor(item.severity) }]}
          >
            Severity {item.severity}/5
          </Text>
          {!item.synced ? (
            <View style={styles.syncBadge}>
              <Text style={styles.syncBadgeText}>On-device</Text>
            </View>
          ) : null}
        </View>

        {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}

        <View style={styles.meta}>
          <Text style={styles.metaText}>Rep {item.repId}</Text>
          <Pressable
            onPress={() => handleDelete(item.id)}
            accessibilityRole="button"
            accessibilityLabel="Delete this flag"
            testID={`pain-flag-${item.id}-delete`}
            hitSlop={8}
            style={styles.deleteBtn}
          >
            <Ionicons name="trash-outline" size={14} color="#FF3B30" />
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </View>
      </View>
    ),
    [handleDelete],
  );

  const content = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={tabColors.accent} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color="#FF3B30" />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (flags.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="medkit-outline" size={48} color={tabColors.textSecondary} />
          <Text style={styles.emptyTitle}>No pain flags yet</Text>
          <Text style={styles.emptySub}>
            When something hurts mid-set, tap the Flag pain button so we
            can adjust upcoming weights.
          </Text>
        </View>
      );
    }
    return (
      <FlatList
        data={flags}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    );
  }, [loading, error, flags, renderItem, load]);

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
        <Text style={styles.title}>Pain journal</Text>
        <View style={{ width: 24 }} />
      </View>
      <Text style={styles.disclaimer}>
        Stored on this device. Cloud sync lands with the next data migration.
      </Text>
      {content}
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
  disclaimer: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
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
    alignItems: 'center',
    marginBottom: 6,
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationText: {
    fontSize: 14,
    fontFamily: 'Lexend_500Medium',
    color: tabColors.textPrimary,
  },
  when: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: tabColors.textSecondary,
  },
  severityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  severity: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
  },
  syncBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#1B2E4A',
  },
  syncBadgeText: {
    fontSize: 10,
    fontFamily: 'Lexend_500Medium',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  notes: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: '#D1D5DB',
    lineHeight: 18,
    marginBottom: 8,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  metaText: {
    fontSize: 11,
    fontFamily: 'Lexend_400Regular',
    color: '#8E8E93',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  deleteText: {
    fontSize: 12,
    fontFamily: 'Lexend_500Medium',
    color: '#FF3B30',
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
