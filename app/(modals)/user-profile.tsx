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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/use-safe-back';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSocial } from '@/contexts/SocialContext';
import {
  getFollowCounts,
  getProfile,
  getUserVideos,
  type FollowCounts,
  type FollowStatusSummary,
  type ProfileRecord,
} from '@/lib/services/social-service';
import { type VideoWithUrls } from '@/lib/services/video-service';
import { formatRelativeTime } from '@/lib/video-feed';
import { warnWithTs } from '@/lib/logger';

const INITIAL_COUNTS: FollowCounts = { followers: 0, following: 0, pending_requests: 0 };
const INITIAL_STATUS: FollowStatusSummary = {
  is_self: false,
  outgoing_status: null,
  incoming_status: null,
  follows: false,
  requested: false,
  followed_by: false,
  blocked_by_me: false,
  blocked_between: false,
};

export default function UserProfileModal() {
  const { user } = useAuth();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const targetUserId = typeof userId === 'string' ? userId : '';
  const safeBack = useSafeBack(['/(tabs)/index', '/']);
  const router = useRouter();
  const { show: showToast } = useToast();
  const social = useSocial();

  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [status, setStatus] = useState<FollowStatusSummary>(INITIAL_STATUS);
  const [counts, setCounts] = useState<FollowCounts>(INITIAL_COUNTS);
  const [videos, setVideos] = useState<VideoWithUrls[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingFollowAction, setLoadingFollowAction] = useState(false);

  const canViewVideos = useMemo(() => {
    if (!profile) return false;
    if (profile.user_id === user?.id) return true;
    if (!profile.is_private) return true;
    return status.follows;
  }, [profile, status.follows, user?.id]);

  const load = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    try {
      const [loadedProfile, loadedCounts, loadedStatus] = await Promise.all([
        getProfile(targetUserId),
        getFollowCounts(targetUserId),
        social.getFollowStatus(targetUserId, { refresh: true }),
      ]);

      setProfile(loadedProfile);
      setCounts(loadedCounts);
      setStatus(loadedStatus);

      if (loadedProfile && (loadedProfile.user_id === user?.id || !loadedProfile.is_private || loadedStatus.follows)) {
        const videoResult = await getUserVideos(targetUserId, null, 20);
        setVideos(videoResult.items);
      } else {
        setVideos([]);
      }
    } catch (error) {
      warnWithTs('[user-profile] Failed to load profile modal data', error);
      showToast('Unable to load profile right now.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showToast, social, targetUserId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFollowAction = useCallback(async () => {
    if (!targetUserId || status.is_self || loadingFollowAction) return;

    try {
      setLoadingFollowAction(true);

      if (status.follows || status.requested) {
        await social.unfollowUser(targetUserId);
      } else {
        await social.followUser(targetUserId);
      }

      const [nextStatus, nextCounts] = await Promise.all([
        social.getFollowStatus(targetUserId, { refresh: true }),
        getFollowCounts(targetUserId),
      ]);
      setStatus(nextStatus);
      setCounts(nextCounts);

      if (profile && (profile.user_id === user?.id || !profile.is_private || nextStatus.follows)) {
        const nextVideos = await getUserVideos(targetUserId, null, 20);
        setVideos(nextVideos.items);
      } else {
        setVideos([]);
      }
    } catch (error) {
      warnWithTs('[user-profile] Follow action failed', error);
      showToast('Could not update follow status.', { type: 'error' });
    } finally {
      setLoadingFollowAction(false);
    }
  }, [loadingFollowAction, profile, showToast, social, status.follows, status.is_self, status.requested, targetUserId, user?.id]);

  const followButtonLabel = useMemo(() => {
    if (status.is_self) return '';
    if (status.follows) return 'Following';
    if (status.requested) return 'Requested';
    return 'Follow';
  }, [status.follows, status.is_self, status.requested]);

  const displayName = profile?.display_name || profile?.username || 'User';
  const displayInitial = displayName.charAt(0).toUpperCase();

  const renderVideoItem = ({ item }: { item: VideoWithUrls }) => {
    const exercise = item.exercise || 'Workout';
    const dateText = formatRelativeTime(item.created_at);

    return (
      <View style={styles.videoCard}>
        <View style={styles.videoThumbWrap}>
          {item.thumbnailUrl ? (
            <Image source={{ uri: item.thumbnailUrl }} style={styles.videoThumb} />
          ) : (
            <View style={[styles.videoThumb, styles.videoThumbFallback]}>
              <Ionicons name="videocam-outline" size={18} color="#9AACD1" />
            </View>
          )}
        </View>
        <View style={styles.videoMeta}>
          <Text style={styles.videoTitle}>{exercise}</Text>
          <Text style={styles.videoSubtitle}>{dateText || 'Recently shared'}</Text>
        </View>
        <TouchableOpacity
          style={styles.videoAction}
          onPress={() => router.push(`/(modals)/video-comments?videoId=${item.id}&returnTo=videos`)}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={17} color="#9AACD1" />
        </TouchableOpacity>
      </View>
    );
  };

  if (!targetUserId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.iconButton}>
            <Ionicons name="chevron-back" size={20} color="#9AACD1" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={styles.iconButton} />
        </View>
        <View style={styles.centerState}>
          <Text style={styles.mutedText}>Missing profile id.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconButton}>
          <Ionicons name="chevron-back" size={20} color="#9AACD1" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.iconButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#4C8CFF" />
          <Text style={styles.mutedText}>Loading profile…</Text>
        </View>
      ) : !profile ? (
        <View style={styles.centerState}>
          <Text style={styles.mutedText}>Profile not found.</Text>
        </View>
      ) : (
        <FlatList
          data={canViewVideos ? videos : []}
          keyExtractor={(item) => item.id}
          renderItem={renderVideoItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.profileCard}>
              <View style={styles.profileTopRow}>
                <View style={styles.avatarWrap}>
                  {profile.avatar_url ? (
                    <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarFallbackText}>{displayInitial}</Text>
                    </View>
                  )}
                </View>

                {!status.is_self ? (
                  <TouchableOpacity
                    style={[styles.followButton, (status.follows || status.requested) && styles.followButtonMuted]}
                    onPress={handleFollowAction}
                    disabled={loadingFollowAction}
                  >
                    {loadingFollowAction ? (
                      <ActivityIndicator color="#0F2339" size="small" />
                    ) : (
                      <Text style={styles.followButtonText}>{followButtonLabel}</Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>

              <Text style={styles.nameText}>{displayName}</Text>
              {profile.username ? <Text style={styles.usernameText}>@{profile.username}</Text> : null}
              {profile.bio ? <Text style={styles.bioText}>{profile.bio}</Text> : null}

              <View style={styles.countsRow}>
                <TouchableOpacity
                  style={styles.countPill}
                  onPress={() => router.push(`/(modals)/followers?userId=${profile.user_id}&tab=followers`)}
                >
                  <Text style={styles.countValue}>{counts.followers}</Text>
                  <Text style={styles.countLabel}>Followers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.countPill}
                  onPress={() => router.push(`/(modals)/followers?userId=${profile.user_id}&tab=following`)}
                >
                  <Text style={styles.countValue}>{counts.following}</Text>
                  <Text style={styles.countLabel}>Following</Text>
                </TouchableOpacity>
              </View>

              {profile.is_private && !status.follows && !status.is_self ? (
                <View style={styles.privateCard}>
                  <Ionicons name="lock-closed" size={16} color="#9AACD1" />
                  <Text style={styles.privateText}>This account is private.</Text>
                </View>
              ) : null}

              <Text style={styles.sectionTitle}>Videos</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Text style={styles.mutedText}>
                {canViewVideos ? 'No videos yet.' : 'Follow this account to view their videos.'}
              </Text>
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
    paddingBottom: 40,
    gap: 10,
  },
  profileCard: {
    backgroundColor: '#0B1A2F',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#152642',
    padding: 16,
    marginBottom: 14,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  avatarWrap: {
    width: 74,
    height: 74,
    borderRadius: 37,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  avatarFallbackText: {
    color: '#E9EFFF',
    fontSize: 28,
    fontWeight: '700',
  },
  nameText: {
    color: '#E9EFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  usernameText: {
    color: '#9AACD1',
    marginTop: 2,
    fontSize: 14,
  },
  bioText: {
    color: '#D7E3FF',
    fontSize: 14,
    marginTop: 10,
    lineHeight: 20,
  },
  followButton: {
    backgroundColor: '#4C8CFF',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButtonMuted: {
    backgroundColor: '#1E3355',
  },
  followButtonText: {
    color: '#E9EFFF',
    fontWeight: '700',
  },
  countsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    marginBottom: 10,
  },
  countPill: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1E3355',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.08)',
  },
  countValue: {
    color: '#E9EFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  countLabel: {
    color: '#9AACD1',
    fontSize: 12,
    marginTop: 2,
  },
  privateCard: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E3355',
    backgroundColor: 'rgba(154, 172, 209, 0.1)',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  privateText: {
    color: '#C5D3F1',
    fontSize: 13,
    fontWeight: '500',
  },
  sectionTitle: {
    color: '#9AACD1',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
  },
  videoCard: {
    backgroundColor: '#0B1A2F',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#152642',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  videoThumbWrap: {
    width: 68,
    height: 68,
    borderRadius: 10,
    overflow: 'hidden',
  },
  videoThumb: {
    width: '100%',
    height: '100%',
  },
  videoThumbFallback: {
    backgroundColor: '#10243F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoMeta: {
    flex: 1,
    minWidth: 0,
  },
  videoTitle: {
    color: '#E9EFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  videoSubtitle: {
    color: '#9AACD1',
    fontSize: 13,
    marginTop: 2,
  },
  videoAction: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(154, 172, 209, 0.1)',
  },
  centerState: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mutedText: {
    color: '#9AACD1',
  },
});
