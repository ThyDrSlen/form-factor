import React, { useCallback, useEffect, useState } from 'react';
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
import { useSafeBack } from '@/hooks/use-safe-back';
import { useToast } from '@/contexts/ToastContext';
import { useSocial } from '@/contexts/SocialContext';
import { getPendingRequests, type FollowRelationship } from '@/lib/services/social-service';
import { warnWithTs } from '@/lib/logger';

export default function FollowRequestsModal() {
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile']);
  const social = useSocial();
  const { show: showToast } = useToast();

  const [requests, setRequests] = useState<FollowRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingKey, setActingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getPendingRequests();
      setRequests(rows);
      await social.refreshPendingRequestCount();
    } catch (error) {
      warnWithTs('[follow-requests] Failed to load requests', error);
      showToast('Unable to load follow requests.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showToast, social]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = useCallback(
    async (followerId: string) => {
      try {
        setActingKey(`accept:${followerId}`);
        await social.acceptFollow(followerId);
        setRequests((prev) => prev.filter((row) => row.follower_id !== followerId));
        showToast('Follow request accepted.', { type: 'success' });
      } catch (error) {
        warnWithTs('[follow-requests] Accept failed', error);
        showToast('Could not accept request.', { type: 'error' });
      } finally {
        setActingKey(null);
      }
    },
    [showToast, social],
  );

  const handleReject = useCallback(
    async (followerId: string) => {
      try {
        setActingKey(`reject:${followerId}`);
        await social.rejectFollow(followerId);
        setRequests((prev) => prev.filter((row) => row.follower_id !== followerId));
        showToast('Follow request rejected.', { type: 'info' });
      } catch (error) {
        warnWithTs('[follow-requests] Reject failed', error);
        showToast('Could not reject request.', { type: 'error' });
      } finally {
        setActingKey(null);
      }
    },
    [showToast, social],
  );

  const renderItem = ({ item }: { item: FollowRelationship }) => {
    const profile = item.profile;
    const displayName = profile?.display_name || profile?.username || 'User';
    const initial = displayName.charAt(0).toUpperCase();
    const accepting = actingKey === `accept:${item.follower_id}`;
    const rejecting = actingKey === `reject:${item.follower_id}`;
    const disabled = Boolean(actingKey);

    return (
      <View style={styles.row}>
        {profile?.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarFallbackText}>{initial}</Text>
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{displayName}</Text>
          {profile?.username ? <Text style={styles.rowMeta}>@{profile.username}</Text> : null}
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={() => void handleReject(item.follower_id)}
            disabled={disabled}
          >
            {rejecting ? <ActivityIndicator size="small" color="#E9EFFF" /> : <Text style={styles.actionText}>Reject</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.acceptButton]}
            onPress={() => void handleAccept(item.follower_id)}
            disabled={disabled}
          >
            {accepting ? <ActivityIndicator size="small" color="#0F2339" /> : <Text style={[styles.actionText, styles.acceptText]}>Accept</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconButton}>
          <Ionicons name="chevron-back" size={20} color="#9AACD1" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Follow Requests</Text>
        <TouchableOpacity onPress={() => void load()} style={styles.iconButton}>
          <Ionicons name="refresh" size={16} color="#9AACD1" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#4C8CFF" />
          <Text style={styles.mutedText}>Loading follow requests…</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => `${item.follower_id}:${item.following_id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Text style={styles.mutedText}>No pending requests.</Text>
            </View>
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
  headerTitle: {
    color: '#E9EFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 30,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#152642',
    backgroundColor: '#0B1A2F',
    padding: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.2)',
  },
  avatarFallbackText: {
    color: '#E9EFFF',
    fontWeight: '700',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: '#E9EFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  rowMeta: {
    color: '#9AACD1',
    fontSize: 13,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectButton: {
    backgroundColor: '#1E3355',
  },
  acceptButton: {
    backgroundColor: '#4C8CFF',
  },
  actionText: {
    color: '#E9EFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  acceptText: {
    color: '#0F2339',
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
});
