import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { DashboardHealth } from '@/components';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';
import {
  deleteVideo,
  getVideoById,
  listVideos,
  toggleVideoLike,
  VideoWithUrls,
  uploadWorkoutVideo,
} from '@/lib/services/video-service';
import { CoachMessage, sendCoachPrompt } from '@/lib/services/coach-service';
import { AppError, mapToUserMessage } from '@/lib/services/ErrorHandler';
import {
  buildOverlaySummary,
  buildPostText,
  formatRelativeTime,
  formatVideoTimestamp,
  getFormScore,
  getPrimaryCue,
  type VideoFeedMetrics,
} from '@/lib/video-feed';
import { subscribeToCommentEvents } from '@/lib/video-comments-events';
import { styles } from '../../styles/tabs/_index.styles';
import { spacing } from '../../styles/tabs/_theme-constants';

const motivationalMessages = [
  'Sweat now, shine later',
  'Every rep counts',
  'Progress beats perfect',
  'Move with intent',
  'Hydrate and dominate',
  'Fuel up, level up',
  'Stronger than yesterday',
  'No off days',
  'Own your pace',
  'Small wins, big gains',
  'Stack those reps',
  'Build, do not burn out',
  'Cardio is calling',
  'Form first, then fire',
  'Leg day legends',
  'Mind on the muscle',
  'Breathe, then push',
  'Tempo is your coach',
  'Sweat equity grows',
  'Recovery is training',
  'Chase the pump',
  'Balance beats burnout',
  'Consistency is king',
  'It\'s You versus You',
  'Focus on the Mind and Muscle Connection'
];

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
  const [isFullscreen, setIsFullscreen] = useState(false);
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
        warnWithTs('[FeedVideoPlayer] replaceAsync failed', error);
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
        warnWithTs('[FeedVideoPlayer] enterFullscreen failed', error);
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
    <View style={styles.video}>
      <VideoView
        ref={videoViewRef}
        player={player}
        style={styles.videoSurface}
        contentFit="cover"
        nativeControls={isFullscreen}
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
        onFirstFrameRender={() => setPosterVisible(false)}
        onFullscreenEnter={() => setIsFullscreen(true)}
        onFullscreenExit={() => setIsFullscreen(false)}
      />
      {thumbnailUrl && posterVisible ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={styles.videoPoster}
          resizeMode="cover"
        />
      ) : null}
      {!isFullscreen ? (
        <TouchableOpacity style={styles.videoTapSurface} onPress={togglePlayback} activeOpacity={1} />
      ) : null}
      {!isFullscreen && !isPlaying ? (
        <TouchableOpacity
          style={styles.playButton}
          onPress={togglePlayback}
          activeOpacity={0.85}
        >
          <Ionicons name="play" size={26} color="#0B1324" />
        </TouchableOpacity>
      ) : null}
      {!isFullscreen ? (
        <LinearGradient
          colors={['rgba(10, 15, 28, 0)', 'rgba(10, 15, 28, 0.78)']}
          style={styles.videoOverlay}
        >
          <View style={styles.videoOverlayMetaRow}>
            <Text style={styles.videoOverlaySummary}>{overlaySummary}</Text>
            {overlayTime ? <Text style={styles.videoOverlayTime}>{overlayTime}</Text> : null}
          </View>
          <View style={styles.videoControlsRow}>
            <TouchableOpacity
              style={styles.videoProgressTrack}
              onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
              onPress={handleSeek}
              activeOpacity={0.85}
            >
              <View style={[styles.videoProgressFill, { width: `${progress * 100}%` }]} />
            </TouchableOpacity>
            <Text style={styles.videoTimecode}>{timecode}</Text>
            <TouchableOpacity style={styles.muteButton} onPress={toggleMuted}>
              <Ionicons name={isMuted ? 'volume-mute' : 'volume-high'} size={14} color="#DDE6FF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fullscreenButton} onPress={enterFullscreen}>
              <Ionicons name="scan-outline" size={14} color="#DDE6FF" />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      ) : null}
    </View>
  );
};

const coachIntroMessage: CoachMessage = {
  id: 'intro',
  role: 'assistant',
  content: 'I am your Form Factor coach. Tell me your goal, available time, gear, or any injuries and I will craft a realistic plan or adjust your current routine.',
};

const coachQuickPrompts = [
  'Plan a 30-minute strength session for today.',
  'Light recovery day ideas after heavy squats.',
  'Give me a 5-minute warm-up for pull day.',
  'High-protein meal ideas under 600 calories.',
];

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const tabBarHeight = useBottomTabBarHeight();
  const { show: showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'videos' | 'coach'>('dashboard');
  const [videos, setVideos] = useState<VideoWithUrls[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [refreshingVideos, setRefreshingVideos] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
  const [likedVideos, setLikedVideos] = useState<Record<string, boolean>>({});
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([coachIntroMessage]);
  const [coachInput, setCoachInput] = useState('');
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachSending, setCoachSending] = useState(false);
  const coachListRef = useRef<FlatList<CoachMessage>>(null);
  const subtitle = useMemo(() => {
    const index = Math.floor(Math.random() * motivationalMessages.length);
    return motivationalMessages[index];
  }, []);

  // Get display name from user metadata or fallback to email
  const getDisplayName = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name;
    }
    if (user?.user_metadata?.name) {
      return user.user_metadata.name;
    }
    return user?.email?.split('@')[0] || 'User';
  };
  const displayInitial = getDisplayName().charAt(0).toUpperCase();

  const loadVideos = useCallback(async (isRefresh = false) => {
    setFeedError(null);
    if (isRefresh) {
      setRefreshingVideos(true);
    } else {
      setLoadingVideos(true);
    }
    try {
      const fetched = await listVideos(15, { onlyMine: false });
      setVideos(fetched);
      setHasFetchedOnce(true);
    } catch (error) {
      if (__DEV__) {
        warnWithTs('Failed to load videos', error);
      }
      setFeedError('Unable to load videos right now.');
    } finally {
      setLoadingVideos(false);
      setRefreshingVideos(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'videos' && !hasFetchedOnce && !loadingVideos) {
      loadVideos();
    }
  }, [activeTab, hasFetchedOnce, loadVideos, loadingVideos]);

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
              warnWithTs('[Home] Failed to refresh comment counts', error);
            }
          });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const coachContext = useMemo(
    () => {
      const metadata =
        user?.user_metadata && typeof user.user_metadata === 'object'
          ? (user.user_metadata as Record<string, unknown>)
          : null;
      const fullName =
        (metadata && typeof metadata.full_name === 'string' ? metadata.full_name : null) ??
        (metadata && typeof metadata.name === 'string' ? metadata.name : null);

      return {
        profile: {
          id: user?.id,
          name: fullName,
          email: user?.email ?? null,
        },
        focus: 'fitness_coach',
      };
    },
    [user]
  );

  const handleCoachSend = async (preset?: string) => {
    const content = (preset ?? coachInput).trim();
    if (!content || coachSending) return;

    const userMessage: CoachMessage = {
      id: `coach-user-${Date.now()}`,
      role: 'user',
      content,
    };

    const conversation = [...coachMessages, userMessage];
    setCoachMessages(conversation);
    setCoachInput('');
    setCoachError(null);
    setCoachSending(true);

    try {
      const reply = await sendCoachPrompt(conversation, coachContext);
      setCoachMessages(prev => [
        ...prev,
        { ...reply, id: reply.id || `coach-assistant-${Date.now()}` },
      ]);
      coachListRef.current?.scrollToEnd({ animated: true });
    } catch (err) {
      const appErr = err as AppError | null;
      const hasDomain = Boolean(appErr && typeof appErr === 'object' && 'domain' in appErr);
      const fallback = 'Unable to reach the coach. Please try again.';
      setCoachError(hasDomain ? mapToUserMessage(appErr as AppError) : fallback);
    } finally {
      setCoachSending(false);
    }
  };

  const handleShare = useCallback(async (video: VideoWithUrls) => {
    if (!video.signedUrl) {
      Alert.alert('No link available', 'Try refreshing the feed to regenerate the link.');
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

  const handleUploadVideo = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'video/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      const info = await FileSystem.getInfoAsync(asset.uri);
      if (!info.exists) {
        Alert.alert('Error', 'File does not exist');
        return;
      }
      if (info.size && info.size > 250 * 1024 * 1024) {
        Alert.alert('File too large', 'Max file size is 250MB.');
        return;
      }

      setLoadingVideos(true);
      await uploadWorkoutVideo({
        fileUri: asset.uri,
        exercise: 'Workout Share',
      });
      
      Alert.alert('Success', 'Video uploaded successfully');
      loadVideos(true);
    } catch (error) {
      errorWithTs('Upload failed', error);
      Alert.alert('Error', 'Failed to upload video');
      setLoadingVideos(false);
    }
  }, [loadVideos]);

  const handleDeleteVideo = useCallback(
    async (videoId: string) => {
      try {
        await deleteVideo(videoId);
        setVideos((prev) => prev.filter((video) => video.id !== videoId));
        showToast('Video deleted', { type: 'info' });
      } catch (error) {
        errorWithTs('[Home] Failed to delete video', error);
        showToast('Unable to delete video right now.', { type: 'error' });
      }
    },
    [showToast]
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
          warnWithTs('[Home] Failed to toggle like', error);
        }
        showToast('Unable to update like right now.', { type: 'error' });
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

  const renderVideoCard = ({ item }: { item: VideoWithUrls }) => {
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
    const displayName = canDelete ? getDisplayName() : 'FF Athlete';
    return (
      <View style={styles.feedCard}>
        <View style={styles.postHeader}>
          <View style={styles.postHeaderLeft}>
            <View style={styles.postAvatarWrap}>
              <View style={styles.postAvatar}>
                <Text style={styles.postAvatarText}>{displayName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.postAvatarStatus} />
            </View>
            <View style={styles.postHeaderText}>
              <Text style={styles.postName} numberOfLines={1}>{displayName}</Text>
              {metaLine ? (
                <Text style={styles.postMeta} numberOfLines={1}>
                  {metaLine} • Workout share
                </Text>
              ) : null}
            </View>
          </View>
          <TouchableOpacity
            style={styles.postMoreButton}
            onPress={() => handlePostActions(item, canDelete)}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#9AACD1" />
          </TouchableOpacity>
        </View>

        <Text style={styles.postText}>{postText}</Text>

        <View style={styles.videoWrapper}>
          {item.signedUrl ? (
            <FeedVideoPlayer
              uri={item.signedUrl}
              thumbnailUrl={item.thumbnailUrl}
              overlaySummary={summary}
              overlayTime={postTimestamp}
            />
          ) : (
            <View style={styles.videoPlaceholder}>
              <Ionicons name="videocam-outline" size={24} color="#4C8CFF" />
              <Text style={styles.videoPlaceholderText}>Signed link unavailable</Text>
            </View>
          )}
          {formScore !== null ? (
            <View style={styles.formScoreBadge} pointerEvents="none">
              <Text style={styles.formScoreText}>{formScore}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.engagementRow}>
          <TouchableOpacity
            style={styles.engagementGroup}
            onPress={() => handleToggleLike(item.id)}
            activeOpacity={0.8}
          >
            <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={18} color={isLiked ? '#FF6B6B' : '#9AACD1'} />
            <Text style={[styles.engagementText, isLiked && styles.engagementTextActive]}>{likeCount}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.engagementGroup}
            onPress={() => router.push(`/(modals)/video-comments?videoId=${item.id}&returnTo=videos`)}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#9AACD1" />
            <Text style={styles.engagementText}>{commentCount}</Text>
          </TouchableOpacity>
        </View>

        {primaryCue ? (
          <View style={styles.statRow}>
            <Ionicons name="checkmark-circle" size={16} color="#7BD389" />
            <Text style={styles.statText}>{primaryCue}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  const renderDashboard = () => (
    <View style={styles.content}>
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      
      <View style={styles.actionGrid}>
        <TouchableOpacity 
          style={styles.actionCardWrapper}
          onPress={() => {
            logWithTs('Navigating to add-workout');
            router.push('/(modals)/add-workout');
          }}
        >
          <LinearGradient
            colors={['#0F2339', '#081526']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.actionCard}
          >
            <View style={styles.actionIcon}>
              <Text style={styles.actionIconText}>💪</Text>
            </View>
            <Text style={styles.actionTitle}>Log Workout</Text>
            <Text style={styles.actionSubtitle}>Track your exercise</Text>
          </LinearGradient>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.actionCardWrapper}
          onPress={() => {
            logWithTs('Navigating to add-food');
            router.push('/(modals)/add-food');
          }}
        >
          <LinearGradient
            colors={['#0F2339', '#081526']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.actionCard}
          >
            <View style={styles.actionIcon}>
              <Text style={styles.actionIconText}>🍎</Text>
            </View>
            <Text style={styles.actionTitle}>Log Meal</Text>
            <Text style={styles.actionSubtitle}>Track your nutrition</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
      
      <View style={styles.statsSection}>
        <Text style={styles.sectionTitle}>This Week</Text>
        <View style={styles.statsGrid}>
          <LinearGradient
            colors={['#0F2339', '#081526']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.statCard}
          >
            <Text style={styles.statNumber}>0</Text>
            <Text style={styles.statLabel}>Workouts</Text>
          </LinearGradient>
          <LinearGradient
            colors={['#0F2339', '#081526']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.statCard}
          >
            <Text style={styles.statNumber}>0</Text>
            <Text style={styles.statLabel}>Meals Logged</Text>
          </LinearGradient>
        </View>
      </View>

      {/* Health metrics from Apple Health */}
      <DashboardHealth />
    </View>
  );

  const renderVideoFeed = () => (
    <View style={styles.feedContainer}>
      {loadingVideos && !hasFetchedOnce ? (
        <View style={styles.feedLoading}>
          <ActivityIndicator color="#4C8CFF" />
          <Text style={styles.feedMeta}>Loading videos…</Text>
        </View>
      ) : null}

      {feedError ? <Text style={styles.errorText}>{feedError}</Text> : null}

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        renderItem={renderVideoCard}
        contentContainerStyle={styles.feedListContent}
        refreshControl={
          <RefreshControl
            tintColor="#4C8CFF"
            refreshing={refreshingVideos}
            onRefresh={() => loadVideos(true)}
          />
        }
        ListEmptyComponent={
          !loadingVideos && hasFetchedOnce ? (
            <View style={styles.feedEmpty}>
              <Ionicons name="videocam-off-outline" size={22} color="#9AACD1" />
              <Text style={styles.feedMeta}>No videos yet. Share a set to see it here.</Text>
              <TouchableOpacity style={styles.uploadButton} onPress={handleUploadVideo}>
                <Text style={styles.uploadButtonText}>Upload Video</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    </View>
  );

  const renderCoach = () => (
    <View style={styles.coachContainer}>
      <View style={styles.quickPrompts}>
        {coachQuickPrompts.map(prompt => (
          <TouchableOpacity
            key={prompt}
            style={styles.quickPrompt}
            onPress={() => handleCoachSend(prompt)}
          >
            <Text style={styles.quickPromptText}>{prompt}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {coachError && (
        <View style={styles.coachError}>
          <Text style={styles.coachErrorTitle}>Coach is busy</Text>
          <Text style={styles.coachErrorText}>{coachError}</Text>
        </View>
      )}

      <FlatList
        ref={coachListRef}
        data={coachMessages}
        keyExtractor={(item, index) => item.id || `coach-${index}`}
        style={styles.coachList}
        renderItem={({ item }) => {
          const isUser = item.role === 'user';
          return (
            <View style={[styles.coachBubbleRow, { justifyContent: isUser ? 'flex-end' : 'flex-start' }]}>
              <View
                style={[
                  styles.coachBubble,
                  isUser ? styles.coachBubbleUser : styles.coachBubbleAssistant,
                ]}
              >
                <Text style={styles.coachBubbleText}>{item.content}</Text>
                <Text style={styles.coachBubbleMeta}>{isUser ? 'You' : 'Coach'}</Text>
              </View>
            </View>
          );
        }}
        contentContainerStyle={styles.coachListContent}
        onContentSizeChange={() => coachListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => coachListRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      />

      <View style={styles.coachComposer}>
        <TextInput
          style={styles.coachInput}
          placeholder="Ask for a plan, adjustment, or recovery ideas..."
          placeholderTextColor="#9AACD1"
          value={coachInput}
          onChangeText={setCoachInput}
          multiline
        />
        <TouchableOpacity
          style={[styles.coachSend, (!coachInput.trim() || coachSending) && styles.coachSendDisabled]}
          onPress={() => handleCoachSend()}
          disabled={!coachInput.trim() || coachSending}
        >
          {coachSending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Ionicons name="send" size={18} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  // Add bottom padding when coach tab is active to keep composer above tab bar
  const bottomPadding = activeTab === 'coach' ? tabBarHeight + spacing.md : 0;

  return (
    <View style={[styles.container, { paddingBottom: bottomPadding }]}>
      {activeTab === 'videos' ? (
        <View style={styles.feedTopBar}>
          <View style={styles.feedTopLeft}>
            <View style={styles.feedTopAvatarWrap}>
              <View style={styles.feedTopAvatar}>
                <Text style={styles.feedTopAvatarText}>{displayInitial}</Text>
              </View>
              <View style={styles.feedTopStatus} />
            </View>
            <Text style={styles.feedTopTitle}>Feed</Text>
          </View>
          <View style={styles.feedTopActions}>
            <TouchableOpacity style={styles.coachEmojiButton} onPress={() => setActiveTab('coach')}>
              <Text style={styles.coachEmojiText}>🧑‍🏫</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.newPostButton} onPress={handleUploadVideo}>
              <Ionicons name="add" size={18} color="#DDE6FF" />
              <Text style={styles.newPostText}>New Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.headerRow}>
          <View style={styles.headerTextContainer}>
            <Text style={styles.title}>Welcome back, {getDisplayName()}!</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.coachEmojiButton} onPress={() => setActiveTab('coach')}>
              <Text style={styles.coachEmojiText}>🧑‍🏫</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.tabSwitcher}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'dashboard' && styles.tabButtonActive]}
          onPress={() => setActiveTab('dashboard')}
        >
          <Text style={[styles.tabText, activeTab === 'dashboard' && styles.tabTextActive]}>
            Dashboard
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'videos' && styles.tabButtonActive]}
          onPress={() => setActiveTab('videos')}
        >
          <Text style={[styles.tabText, activeTab === 'videos' && styles.tabTextActive]}>
            Videos
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'dashboard' ? renderDashboard() : activeTab === 'videos' ? renderVideoFeed() : renderCoach()}
    </View>
  );
}
