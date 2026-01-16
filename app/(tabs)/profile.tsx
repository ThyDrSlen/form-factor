import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Share, Modal, TextInput, ActivityIndicator, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { HealthTrendsView } from '@/components/dashboard-health/HealthTrendsView';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import { deleteVideo, getVideoById, listVideos, toggleVideoLike, VideoWithUrls } from '@/lib/services/video-service';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { syncService } from '@/lib/services/database/sync-service';
import { localDB } from '@/lib/services/database/local-db';
import { fixInvalidUUIDs } from '@/scripts/fix-invalid-uuids';
import { useDebugInfo } from '@/hooks/use-debug-info';
import {
  buildOverlaySummary,
  buildPostText,
  formatRelativeTime,
  formatVideoTimestamp,
  getFormScore,
  getPrimaryCue,
  type VideoFeedMetrics,
} from '@/lib/video-feed';
import { styles } from '../../styles/tabs/_profile.styles';
import { styles as feedStyles } from '../../styles/tabs/_index.styles';
import { subscribeToCommentEvents } from '@/lib/video-comments-events';

type FeedVideoPlayerProps = {
  uri: string;
  thumbnailUrl?: string | null;
  overlaySummary: string;
  overlayTime: string;
};

const FeedVideoPlayer = ({ uri, thumbnailUrl, overlaySummary, overlayTime }: FeedVideoPlayerProps) => {
  const [posterVisible, setPosterVisible] = useState(Boolean(thumbnailUrl));
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [progressWidth, setProgressWidth] = useState(0);
  const videoViewRef = useRef<VideoView | null>(null);

  const initialSourceRef = useRef<{ uri: string }>({ uri });
  const currentUriRef = useRef(uri);
  const player = useVideoPlayer(initialSourceRef.current, (instance) => {
    instance.loop = false;
  });

  const formatTime = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const rounded = Math.floor(seconds);
    const mins = Math.floor(rounded / 60);
    const secs = Math.floor(rounded % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    if (!uri || currentUriRef.current === uri) return;
    currentUriRef.current = uri;
    player.replaceAsync({ uri }).catch((error) => {
      if (__DEV__) {
        warnWithTs('[ProfileVideoPlayer] replaceAsync failed', error);
      }
    });
  }, [player, uri]);

  useEffect(() => {
    const subscription = player.addListener('playingChange', ({ isPlaying: nextPlaying }) => {
      setIsPlaying(nextPlaying);
    });
    const timeSubscription = player.addListener('timeUpdate', ({ currentTime: nextTime }) => {
      setCurrentTime(nextTime);
      if (player.duration) {
        setDuration(player.duration);
      }
    });
    const sourceSubscription = player.addListener('sourceLoad', () => {
      if (player.duration) {
        setDuration(player.duration);
      }
    });
    return () => {
      subscription.remove();
      timeSubscription.remove();
      sourceSubscription.remove();
    };
  }, [player]);

  useEffect(() => {
    setPosterVisible(Boolean(thumbnailUrl));
  }, [thumbnailUrl]);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.25;
  }, [player]);

  const togglePlayback = useCallback(() => {
    if (player.playing) {
      player.pause();
      return;
    }
    player.play();
  }, [player]);

  const toggleMuted = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    player.muted = nextMuted;
  }, [isMuted, player]);

  const enterFullscreen = useCallback(() => {
    if (!videoViewRef.current?.enterFullscreen) return;
    videoViewRef.current.enterFullscreen().catch((error) => {
      if (__DEV__) {
        warnWithTs('[ProfileVideoPlayer] enterFullscreen failed', error);
      }
    });
  }, []);

  const handleSeek = useCallback(
    (event: { nativeEvent: { locationX: number } }) => {
      if (!duration || !progressWidth) return;
      const ratio = Math.min(1, Math.max(0, event.nativeEvent.locationX / progressWidth));
      const nextTime = ratio * duration;
      player.currentTime = nextTime;
      setCurrentTime(nextTime);
    },
    [duration, progressWidth, player]
  );

  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const timecode = `${formatTime(currentTime)} / ${formatTime(duration)}`;

  return (
    <View style={feedStyles.video}>
      <VideoView
        ref={videoViewRef}
        player={player}
        style={feedStyles.videoSurface}
        contentFit="cover"
        nativeControls={false}
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
        onFirstFrameRender={() => setPosterVisible(false)}
      />
      {thumbnailUrl && posterVisible ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={feedStyles.videoPoster}
          resizeMode="cover"
        />
      ) : null}
      <TouchableOpacity style={feedStyles.videoTapSurface} onPress={togglePlayback} activeOpacity={1} />
      {!isPlaying ? (
        <TouchableOpacity
          style={feedStyles.playButton}
          onPress={togglePlayback}
          activeOpacity={0.85}
        >
          <Ionicons name="play" size={26} color="#0B1324" />
        </TouchableOpacity>
      ) : null}
      <LinearGradient
        colors={['rgba(10, 15, 28, 0)', 'rgba(10, 15, 28, 0.78)']}
        style={feedStyles.videoOverlay}
      >
        <View style={feedStyles.videoOverlayMetaRow}>
          <Text style={feedStyles.videoOverlaySummary}>{overlaySummary}</Text>
          {overlayTime ? <Text style={feedStyles.videoOverlayTime}>{overlayTime}</Text> : null}
        </View>
        <View style={feedStyles.videoControlsRow}>
          <TouchableOpacity
            style={feedStyles.videoProgressTrack}
            onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
            onPress={handleSeek}
            activeOpacity={0.85}
          >
            <View style={[feedStyles.videoProgressFill, { width: `${progress * 100}%` }]} />
          </TouchableOpacity>
          <Text style={feedStyles.videoTimecode}>{timecode}</Text>
          <TouchableOpacity style={feedStyles.muteButton} onPress={toggleMuted}>
            <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={14} color="#DDE6FF" />
          </TouchableOpacity>
          <TouchableOpacity style={feedStyles.fullscreenButton} onPress={enterFullscreen}>
            <Ionicons name="scan-outline" size={14} color="#DDE6FF" />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
};

export default function ProfileScreen() {
  const { user, signOut, updateProfile } = useAuth();
  const { show: showToast } = useToast();
  const [isFixing, setIsFixing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isEditProfileVisible, setIsEditProfileVisible] = useState(false);
  const [fullName, setFullName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [videos, setVideos] = useState<VideoWithUrls[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
  const [likedVideos, setLikedVideos] = useState<Record<string, boolean>>({});
  const { debugInfo, loading: debugLoading, refresh: refreshDebugInfo } = useDebugInfo();
  const currentName = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
  const memberSinceYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();
  const displayName = currentName || user?.email?.split('@')[0] || 'User';
  const displayInitial = (displayName || 'U').charAt(0).toUpperCase();

  const loadVideos = useCallback(async () => {
    setFeedError(null);
    setLoadingVideos(true);
    try {
      const fetched = await listVideos(12, { onlyMine: true });
      setVideos(fetched);
      setHasFetchedOnce(true);
    } catch (error) {
      if (__DEV__) {
        warnWithTs('Failed to load profile videos', error);
      }
      setFeedError('Unable to load your videos right now.');
    } finally {
      setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    if (!hasFetchedOnce && !loadingVideos) {
      loadVideos();
    }
  }, [hasFetchedOnce, loadVideos, loadingVideos]);

  useEffect(() => {
    const unsubscribe = subscribeToCommentEvents((event) => {
      if (event.type === 'commentAdded') {
        setVideos((prev) =>
          prev.map((video) => {
            if (video.id !== event.videoId) return video;
            const current = typeof video.comment_count === 'number' ? video.comment_count : 0;
            return { ...video, comment_count: current + 1 };
          })
        );
      }

      if (event.type === 'commentModalClosed') {
        getVideoById(event.videoId)
          .then((latest) => {
            setVideos((prev) =>
              prev.map((video) =>
                video.id === event.videoId
                  ? {
                      ...video,
                      comment_count: latest.comment_count,
                      like_count: latest.like_count,
                    }
                  : video
              )
            );
          })
          .catch((error) => {
            if (__DEV__) {
              warnWithTs('[Profile] Failed to refresh comment counts', error);
            }
          });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleShare = useCallback(async (video: VideoWithUrls) => {
    if (!video.signedUrl) {
      Alert.alert('No link available', 'Try refreshing your videos to regenerate the link.');
      return;
    }
    try {
      await Share.share({
        message: video.signedUrl,
      });
    } catch (error) {
      warnWithTs('Share failed', error);
    }
  }, []);

  const handleDeleteVideo = useCallback(
    async (videoId: string) => {
      try {
        await deleteVideo(videoId);
        setVideos((prev) => prev.filter((video) => video.id !== videoId));
        showToast('Video deleted', { type: 'info' });
      } catch (error) {
        errorWithTs('[Profile] Failed to delete video', error);
        showToast('Unable to delete video right now.', { type: 'error' });
      }
    },
    [showToast]
  );

  const handlePostActions = useCallback(
    (video: VideoWithUrls, canDelete: boolean) => {
      const buttons = [
        { text: 'Share', onPress: () => handleShare(video) },
        canDelete
          ? {
              text: 'Delete',
              style: 'destructive' as const,
              onPress: () => {
                Alert.alert(
                  'Delete video?',
                  'This removes the clip and metrics permanently.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => handleDeleteVideo(video.id) },
                  ]
                );
              },
            }
          : null,
        { text: 'Cancel', style: 'cancel' as const },
      ].filter(Boolean) as { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[];
      Alert.alert('Post actions', undefined, buttons);
    },
    [handleDeleteVideo, handleShare]
  );

  const handleToggleLike = useCallback(
    async (videoId: string) => {
      try {
        const result = await toggleVideoLike(videoId);
        setLikedVideos((prev) => ({ ...prev, [videoId]: result.liked }));
        setVideos((prev) =>
          prev.map((video) => {
            if (video.id !== videoId) return video;
            const currentCount = typeof video.like_count === 'number' ? video.like_count : 0;
            const nextCount = Math.max(0, currentCount + (result.liked ? 1 : -1));
            return { ...video, like_count: nextCount };
          })
        );
      } catch (error) {
        if (__DEV__) {
          warnWithTs('[Profile] Failed to toggle like', error);
        }
        showToast('Unable to update like right now.', { type: 'error' });
      }
    },
    [showToast]
  );

  const renderVideoCard = (item: VideoWithUrls) => {
    const metrics = (item.metrics || {}) as VideoFeedMetrics;
    const formScore = getFormScore(metrics, item.exercise);
    const primaryCue = getPrimaryCue(metrics, item.exercise);
    const postTimestamp = formatVideoTimestamp(item.created_at);
    const summary = buildOverlaySummary(metrics, item.duration_seconds, formScore);
    const metaLine = formatRelativeTime(item.created_at);
    const postText = buildPostText(metrics, item.exercise);
    const likeCount = typeof item.like_count === 'number' ? item.like_count : 0;
    const commentCount = typeof item.comment_count === 'number' ? item.comment_count : 0;
    const isLiked = likedVideos[item.id] === true;

    const canDelete = user?.id === item.user_id;
    return (
      <View key={item.id} style={feedStyles.feedCard}>
        <View style={feedStyles.postHeader}>
          <View style={feedStyles.postHeaderLeft}>
            <View style={feedStyles.postAvatarWrap}>
              <View style={feedStyles.postAvatar}>
                <Text style={feedStyles.postAvatarText}>{displayInitial}</Text>
              </View>
              <View style={feedStyles.postAvatarStatus} />
            </View>
            <View style={feedStyles.postHeaderText}>
              <Text style={feedStyles.postName} numberOfLines={1}>{displayName}</Text>
              {metaLine ? (
                <Text style={feedStyles.postMeta} numberOfLines={1}>
                  {metaLine} • Workout share
                </Text>
              ) : null}
            </View>
          </View>
          <TouchableOpacity
            style={feedStyles.postMoreButton}
            onPress={() => handlePostActions(item, canDelete)}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#9AACD1" />
          </TouchableOpacity>
        </View>

        <Text style={feedStyles.postText}>{postText}</Text>

        <View style={feedStyles.videoWrapper}>
          {item.signedUrl ? (
            <FeedVideoPlayer
              uri={item.signedUrl}
              thumbnailUrl={item.thumbnailUrl}
              overlaySummary={summary}
              overlayTime={postTimestamp}
            />
          ) : (
            <View style={feedStyles.videoPlaceholder}>
              <Ionicons name="videocam-outline" size={24} color="#4C8CFF" />
              <Text style={feedStyles.videoPlaceholderText}>Signed link unavailable</Text>
            </View>
          )}
          {formScore !== null ? (
            <View style={feedStyles.formScoreBadge} pointerEvents="none">
              <Text style={feedStyles.formScoreText}>{formScore}</Text>
            </View>
          ) : null}
        </View>

        <View style={feedStyles.engagementRow}>
          <TouchableOpacity
            style={feedStyles.engagementGroup}
            onPress={() => handleToggleLike(item.id)}
            activeOpacity={0.8}
          >
            <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={18} color={isLiked ? '#FF6B6B' : '#9AACD1'} />
            <Text style={[feedStyles.engagementText, isLiked && feedStyles.engagementTextActive]}>{likeCount}</Text>
        </TouchableOpacity>
          <TouchableOpacity
            style={feedStyles.engagementGroup}
            onPress={() => router.push(`/(modals)/video-comments?videoId=${item.id}&returnTo=profile`)}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#9AACD1" />
            <Text style={feedStyles.engagementText}>{commentCount}</Text>
          </TouchableOpacity>
        </View>

        {primaryCue ? (
          <View style={feedStyles.statRow}>
            <Ionicons name="checkmark-circle" size={16} color="#7BD389" />
            <Text style={feedStyles.statText}>{primaryCue}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
              router.replace('/(auth)/sign-in');
            } catch (error) {
              errorWithTs('Error signing out:', error);
            }
          },
        },
      ]
    );
  };

  const handleFixSync = async () => {
    Alert.alert(
      'Fix Sync Issues',
      'This will remove corrupted data and resync. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fix Now',
          onPress: async () => {
            setIsFixing(true);
            try {
              const result = await fixInvalidUUIDs();
              await refreshDebugInfo();
              if (result.success) {
                Alert.alert(
                  '✅ Sync Fixed!',
                  `Removed ${result.workoutsRemoved} invalid workouts\n` +
                  `Removed ${result.foodsRemoved} invalid foods\n` +
                  `Cleared ${result.queueCleared} queue items\n\n` +
                  `All new data will sync properly.`
                );
              } else {
                Alert.alert('Error', result.error || 'Failed to fix sync');
              }
            } catch {
              Alert.alert('Error', 'Failed to fix sync issues');
            } finally {
              setIsFixing(false);
            }
          },
        },
      ]
    );
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    try {
      await syncService.fullSync();
      await refreshDebugInfo();
      Alert.alert('✅ Sync Complete', 'All data has been synchronized');
    } catch {
      Alert.alert('Error', 'Failed to sync data');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearDatabase = async () => {
    Alert.alert(
      '⚠️ Clear All Data',
      'This will delete ALL local data. Data on server will be preserved. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            try {
              await localDB.clearAllData();
              await refreshDebugInfo();
              Alert.alert('✅ Cleared', 'All local data has been cleared');
            } catch {
              Alert.alert('Error', 'Failed to clear data');
            } finally {
              setIsClearing(false);
            }
          },
        },
      ]
    );
  };

  const handleViewSyncQueue = async () => {
    try {
      const queue = await localDB.getSyncQueue();
      if (queue.length === 0) {
        Alert.alert('Sync Queue', 'Queue is empty ✅');
        return;
      }
      
      const queueDetails = queue.map((item: any, idx: number) => 
        `${idx + 1}. ${item.table_name} ${item.operation} (retries: ${item.retry_count})`
      ).join('\n');
      
      Alert.alert(
        `Sync Queue (${queue.length} items)`,
        queueDetails,
        [{ text: 'OK' }]
      );
    } catch {
      Alert.alert('Error', 'Failed to fetch queue');
    }
  };

  const handleExportDebugInfo = async () => {
    if (!debugInfo) return;
    
    const debugReport = `
# Form Factor Debug Report
Generated: ${new Date().toISOString()}

## App Info
- Version: ${debugInfo.appVersion} (${debugInfo.buildNumber})
- Platform: ${debugInfo.platform}
- Expo SDK: ${debugInfo.expoVersion}

## Sync Status
- Unsynced Workouts: ${debugInfo.unsyncedWorkouts}
- Unsynced Foods: ${debugInfo.unsyncedFoods}
- Sync Queue Items: ${debugInfo.syncQueueItems}

## Auth Status
- Authenticated: ${debugInfo.isAuthenticated ? 'Yes' : 'No'}
- User ID: ${debugInfo.userId || 'N/A'}
- Email: ${debugInfo.userEmail || 'N/A'}

## Network
- Online: ${debugInfo.isOnline ? 'Yes' : 'No'}

## Database Stats
- Total Workouts: ${debugInfo.totalWorkouts}
- Total Foods: ${debugInfo.totalFoods}
`.trim();

    try {
      await Share.share({
        message: debugReport,
        title: 'Form Factor Debug Report',
      });
    } catch (error) {
      errorWithTs('Failed to share:', error);
    }
  };

  const handleOpenEditProfile = () => {
    setFullName(currentName);
    setIsEditProfileVisible(true);
  };

  const handleOpenNotifications = () => {
    router.push('/(modals)/notifications');
  };

  const handleSaveProfile = async () => {
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter your full name.');
      return;
    }

    try {
      setIsSavingName(true);
      const { error } = await updateProfile({ fullName: trimmedName });
      if (error) {
        Alert.alert('Error', error.message || 'Could not update profile.');
        return;
      }
      setIsEditProfileVisible(false);
      Alert.alert('Profile updated', 'Your name has been saved.');
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Could not update profile.');
    } finally {
      setIsSavingName(false);
    }
  };

  const MenuItem = ({ icon, title, onPress, danger = false }: any) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <LinearGradient
        colors={danger ? ['rgba(255, 59, 48, 0.1)', 'rgba(255, 59, 48, 0.05)'] : ['rgba(76, 140, 255, 0.05)', 'rgba(76, 140, 255, 0.02)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.menuItem}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons name={icon} size={20} color={danger ? '#FF3B30' : '#4C8CFF'} />
        </View>
        <Text style={[styles.menuText, danger && styles.menuTextDanger]}>{title}</Text>
        <Ionicons name="chevron-forward" size={20} color="#6781A6" />
      </LinearGradient>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header Card */}
      <LinearGradient
        colors={['rgba(76, 140, 255, 0.15)', 'rgba(76, 140, 255, 0.05)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerCard}
      >
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {displayInitial}
          </Text>
        </View>
        <Text style={styles.nameText}>{displayName}</Text>
        <Text style={styles.emailText}>{user?.email || 'Not signed in'}</Text>
        <Text style={styles.memberSince}>Member since {memberSinceYear}</Text>
      </LinearGradient>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Health Overview</Text>
        <HealthTrendsView />
      </View>

      <View style={styles.section}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.sectionTitle}>My Videos</Text>
          <TouchableOpacity style={styles.refreshButton} onPress={loadVideos} disabled={loadingVideos}>
            <Ionicons name="refresh-outline" size={16} color="#4C8CFF" />
            <Text style={styles.refreshText}>{loadingVideos ? 'Loading...' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>
        <View style={[feedStyles.feedContainer, styles.profileFeedContainer]}>
          {loadingVideos && !hasFetchedOnce ? (
            <View style={feedStyles.feedLoading}>
              <ActivityIndicator color="#4C8CFF" />
              <Text style={feedStyles.feedMeta}>Loading videos…</Text>
            </View>
          ) : null}

          {feedError ? <Text style={feedStyles.errorText}>{feedError}</Text> : null}

          {!loadingVideos && hasFetchedOnce && videos.length === 0 ? (
            <View style={feedStyles.feedEmpty}>
              <Ionicons name="videocam-off-outline" size={22} color="#9AACD1" />
              <Text style={feedStyles.feedMeta}>No videos yet. Record a set to see it here.</Text>
            </View>
          ) : null}

          {videos.length > 0 ? (
            <View style={[feedStyles.feedListContent, styles.profileFeedListContent]}>
              {videos.map(renderVideoCard)}
            </View>
          ) : null}
        </View>
      </View>

      {/* Debug Section - Remove before production */}
      {(__DEV__ || (Constants.expoConfig?.extra?.appVariant !== 'staging' && Constants.expoConfig?.extra?.appVariant !== 'production')) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔧 Debug Tools</Text>
          
          {/* Debug Stats Card */}
          {debugInfo && !debugLoading && (
            <LinearGradient
              colors={['rgba(76, 140, 255, 0.1)', 'rgba(76, 140, 255, 0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.debugStatsCard}
            >
              <View style={styles.debugStatsRow}>
                <View style={styles.debugStat}>
                  <Text style={styles.debugStatValue}>{debugInfo.unsyncedWorkouts + debugInfo.unsyncedFoods}</Text>
                  <Text style={styles.debugStatLabel}>Unsynced</Text>
                </View>
                <View style={styles.debugStatDivider} />
                <View style={styles.debugStat}>
                  <Text style={styles.debugStatValue}>{debugInfo.syncQueueItems}</Text>
                  <Text style={styles.debugStatLabel}>Queue</Text>
                </View>
                <View style={styles.debugStatDivider} />
                <View style={styles.debugStat}>
                  <Text style={[styles.debugStatValue, debugInfo.isOnline ? styles.debugStatOnline : styles.debugStatOffline]}>
                    {debugInfo.isOnline ? '●' : '○'}
                  </Text>
                  <Text style={styles.debugStatLabel}>{debugInfo.isOnline ? 'Online' : 'Offline'}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={refreshDebugInfo} style={styles.refreshButton}>
                <Ionicons name="refresh" size={16} color="#4C8CFF" />
                <Text style={styles.refreshText}>Refresh</Text>
              </TouchableOpacity>
            </LinearGradient>
          )}
          
          {/* Debug Actions */}
          <View style={styles.debugActions}>
            <TouchableOpacity onPress={handleFixSync} disabled={isFixing} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(255, 204, 0, 0.2)', 'rgba(255, 204, 0, 0.1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="build-outline" size={18} color="#FFCC00" />
                <Text style={styles.debugButtonText}>
                  {isFixing ? 'Fixing...' : 'Fix Sync'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleForceSync} disabled={isSyncing} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(76, 140, 255, 0.2)', 'rgba(76, 140, 255, 0.1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="sync-outline" size={18} color="#4C8CFF" />
                <Text style={[styles.debugButtonText, { color: '#4C8CFF' }]}>
                  {isSyncing ? 'Syncing...' : 'Force Sync'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleViewSyncQueue} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(76, 140, 255, 0.1)', 'rgba(76, 140, 255, 0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="list-outline" size={18} color="#9AACD1" />
                <Text style={[styles.debugButtonText, { color: '#9AACD1' }]}>
                  View Queue
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleExportDebugInfo} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(76, 140, 255, 0.1)', 'rgba(76, 140, 255, 0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="share-outline" size={18} color="#9AACD1" />
                <Text style={[styles.debugButtonText, { color: '#9AACD1' }]}>
                  Export Info
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleClearDatabase} disabled={isClearing} activeOpacity={0.7}>
              <LinearGradient
                colors={['rgba(255, 59, 48, 0.2)', 'rgba(255, 59, 48, 0.1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.debugButton}
              >
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                <Text style={[styles.debugButtonText, { color: '#FF3B30' }]}>
                  {isClearing ? 'Clearing...' : 'Clear DB'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Account Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.menuGroup}>
          <MenuItem icon="person-outline" title="Edit Profile" onPress={handleOpenEditProfile} />
          <MenuItem icon="notifications-outline" title="Notifications" onPress={handleOpenNotifications} />
          <MenuItem icon="lock-closed-outline" title="Privacy & Security" onPress={() => {}} />
        </View>
      </View>

      {/* App Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App</Text>
        <View style={styles.menuGroup}>
          <MenuItem icon="help-circle-outline" title="Help & Support" onPress={() => {}} />
          <MenuItem icon="information-circle-outline" title="About" onPress={() => {}} />
        </View>
      </View>

      {/* Sign Out */}
      <View style={styles.section}>
        <MenuItem icon="log-out-outline" title="Sign Out" onPress={handleSignOut} danger />
      </View>

      {/* Bottom Padding */}
      <View style={styles.bottomSpacer} />

      <Modal visible={isEditProfileVisible} animationType="slide" transparent onRequestClose={() => setIsEditProfileVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => (!isSavingName ? setIsEditProfileVisible(false) : null)}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <Text style={styles.modalLabel}>Full Name</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter your name"
              placeholderTextColor="#6781A6"
              style={styles.modalInput}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!isSavingName}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => setIsEditProfileVisible(false)}
                disabled={isSavingName}
              >
                <Text style={[styles.modalButtonText, styles.modalButtonTextSecondary]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleSaveProfile}
                disabled={isSavingName}
              >
                {isSavingName ? (
                  <ActivityIndicator color="#0F2339" />
                ) : (
                  <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
