import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/use-safe-back';
import { useToast } from '@/contexts/ToastContext';
import {
  getSharedInbox,
  getSharedOutbox,
  type VideoShareWithContext,
} from '@/lib/services/social-service';
import { formatRelativeTime } from '@/lib/video-feed';
import { warnWithTs } from '@/lib/logger';

type BoxTab = 'inbox' | 'sent';

export default function SharedInboxModal() {
  const safeBack = useSafeBack(['/(tabs)/index', '/']);
  const router = useRouter();
  const { show: showToast } = useToast();

  const [activeTab, setActiveTab] = useState<BoxTab>('inbox');
  const [rows, setRows] = useState<VideoShareWithContext[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const unreadCount = useMemo(
    () => rows.filter((row) => activeTab === 'inbox' && row.read_at == null).length,
    [activeTab, rows],
  );

  const load = useCallback(
    async (mode: 'reset' | 'more' = 'reset') => {
      const isReset = mode === 'reset';
      if (isReset) {
        setLoading(true);
      } else {
        if (!cursor || loadingMore) return;
        setLoadingMore(true);
      }

      try {
        const response =
          activeTab === 'inbox'
            ? await getSharedInbox(isReset ? null : cursor, 20)
            : await getSharedOutbox(isReset ? null : cursor, 20);

        setCursor(response.nextCursor);
        if (isReset) {
          setRows(response.items);
        } else {
          setRows((prev) => [...prev, ...response.items]);
        }
      } catch (error) {
        warnWithTs('[shared-inbox] Failed to load shares', error);
        showToast('Unable to load shared videos.', { type: 'error' });
      } finally {
        if (isReset) {
          setLoading(false);
        } else {
          setLoadingMore(false);
        }
      }
    },
    [activeTab, cursor, loadingMore, showToast],
  );

  useEffect(() => {
    void load('reset');
  }, [activeTab, load]);

  const renderRow = ({ item }: { item: VideoShareWithContext }) => {
    const counterparty = activeTab === 'inbox' ? item.sender_profile : item.recipient_profile;
    const counterpartyName =
      counterparty?.display_name || counterparty?.username || (activeTab === 'inbox' ? 'Sender' : 'Recipient');
    const subtitle = `${formatRelativeTime(item.created_at) || 'Recently'} • ${activeTab === 'inbox' ? 'sent you a video' : 'you shared this video'}`;

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push(`/(modals)/share-thread?shareId=${item.id}`)}
        activeOpacity={0.82}
      >
        <View style={styles.thumbWrap}>
          {item.video?.thumbnailUrl ? (
            <Image source={{ uri: item.video.thumbnailUrl }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Ionicons name="videocam-outline" size={18} color="#9AACD1" />
            </View>
          )}
          {activeTab === 'inbox' && !item.read_at ? <View style={styles.unreadDot} /> : null}
        </View>

        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{counterpartyName}</Text>
          <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text>
          {item.message ? <Text style={styles.rowMessage} numberOfLines={2}>{item.message}</Text> : null}
        </View>

        <Ionicons name="chevron-forward" size={18} color="#6781A6" />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconButton}>
          <Ionicons name="chevron-back" size={20} color="#9AACD1" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Shared Videos</Text>
          {activeTab === 'inbox' && unreadCount > 0 ? <Text style={styles.headerMeta}>{unreadCount} unread</Text> : null}
        </View>
        <TouchableOpacity onPress={() => void load('reset')} style={styles.iconButton}>
          <Ionicons name="refresh" size={16} color="#9AACD1" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'inbox' && styles.tabButtonActive]}
          onPress={() => setActiveTab('inbox')}
        >
          <Text style={[styles.tabText, activeTab === 'inbox' && styles.tabTextActive]}>Inbox</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'sent' && styles.tabButtonActive]}
          onPress={() => setActiveTab('sent')}
        >
          <Text style={[styles.tabText, activeTab === 'sent' && styles.tabTextActive]}>Sent</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#4C8CFF" />
          <Text style={styles.mutedText}>Loading shared videos…</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Text style={styles.mutedText}>No shared videos yet.</Text>
            </View>
          }
          ListFooterComponent={
            cursor ? (
              <TouchableOpacity style={styles.loadMoreButton} onPress={() => void load('more')} disabled={loadingMore}>
                {loadingMore ? <ActivityIndicator color="#4C8CFF" /> : <Text style={styles.loadMoreText}>Load more</Text>}
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(154, 172, 209, 0.1)',
  },
  headerTitleWrap: {
    alignItems: 'center',
  },
  headerTitle: {
    color: '#E9EFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  headerMeta: {
    color: '#9AACD1',
    fontSize: 12,
    marginTop: 2,
  },
  tabRow: {
    marginHorizontal: 16,
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E3355',
    overflow: 'hidden',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: '#0B1A2F',
  },
  tabButtonActive: {
    backgroundColor: '#214A85',
  },
  tabText: {
    color: '#9AACD1',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#E9EFFF',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 30,
    gap: 10,
  },
  row: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#152642',
    backgroundColor: '#0B1A2F',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thumbWrap: {
    width: 68,
    height: 68,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbFallback: {
    backgroundColor: '#10243F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4C8CFF',
    right: 6,
    top: 6,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: '#E9EFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  rowSubtitle: {
    color: '#9AACD1',
    fontSize: 12,
  },
  rowMessage: {
    color: '#D7E3FF',
    fontSize: 13,
    marginTop: 4,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 44,
    gap: 8,
  },
  mutedText: {
    color: '#9AACD1',
  },
  loadMoreButton: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E3355',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: '#0B1A2F',
  },
  loadMoreText: {
    color: '#9AACD1',
    fontWeight: '600',
  },
});
