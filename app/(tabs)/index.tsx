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
import { DashboardHealth, DeleteAction } from '@/components';
import { deleteVideo, listVideos, VideoWithUrls, uploadWorkoutVideo } from '@/lib/services/video-service';
import { CoachMessage, sendCoachPrompt } from '@/lib/services/coach-service';
import { AppError, mapToUserMessage } from '@/lib/services/ErrorHandler';
import { styles } from './_styles/_index.styles';
import { spacing } from './_styles/_theme-constants';

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
};

const FeedVideoPlayer = ({ uri, thumbnailUrl }: FeedVideoPlayerProps) => {
  const [posterVisible, setPosterVisible] = useState(Boolean(thumbnailUrl));
  
  // Initialize player with uri directly. Hook handles updates.
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    setPosterVisible(Boolean(thumbnailUrl));
  }, [thumbnailUrl]);

  return (
    <View style={styles.video}>
      <VideoView
        player={player}
        style={styles.videoSurface}
        contentFit="cover"
        nativeControls
        allowsFullscreen
        allowsPictureInPicture
        onFirstFrameRender={() => setPosterVisible(false)}
      />
      {thumbnailUrl && posterVisible ? (
        <Image source={{ uri: thumbnailUrl }} style={styles.videoPoster} resizeMode="cover" />
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

  const loadVideos = useCallback(async (isRefresh = false) => {
    setFeedError(null);
    if (isRefresh) {
      setRefreshingVideos(true);
    } else {
      setLoadingVideos(true);
    }
    try {
      const fetched = await listVideos(15);
      setVideos(fetched);
      setHasFetchedOnce(true);
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to load videos', error);
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

  const coachContext = useMemo(
    () => ({
      profile: {
        id: user?.id,
        name: (user?.user_metadata as any)?.full_name || user?.user_metadata?.name || null,
        email: user?.email ?? null,
      },
      focus: 'fitness_coach',
    }),
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
      const hasDomain = appErr && (appErr as any).domain;
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
      console.warn('Share failed', error);
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
      console.error('Upload failed', error);
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
        console.error('[Home] Failed to delete video', error);
        showToast('Unable to delete video right now.', { type: 'error' });
      }
    },
    [showToast]
  );

  const renderVideoCard = ({ item }: { item: VideoWithUrls }) => {
    const uploadedDate = new Date(item.created_at).toLocaleDateString();
    const metrics = item.metrics || {};
    const metricBadges: string[] = [];
    if (metrics.reps) metricBadges.push(`${metrics.reps} reps`);
    if (metrics.tempo) metricBadges.push(`Tempo ${metrics.tempo}`);
    if (metrics.depth) metricBadges.push(`Depth ${metrics.depth}`);
    if (metrics.range) metricBadges.push(`ROM ${metrics.range}`);
    if (metricBadges.length === 0 && item.duration_seconds) {
      metricBadges.push(`${Math.round(item.duration_seconds)}s`);
    }

    const canDelete = user?.id === item.user_id;
    return (
      <View style={styles.feedCard}>
        <View style={styles.feedHeader}>
          <View style={styles.feedAvatar}>
            <Text style={styles.feedAvatarInitial}>{(item.exercise?.[0] || 'F').toUpperCase()}</Text>
          </View>
          <View style={styles.feedHeaderContent}>
            <Text style={styles.feedTitle}>{item.exercise || 'Workout share'}</Text>
            <Text style={styles.feedMeta}>Uploaded • {uploadedDate}</Text>
          </View>
          <View style={styles.feedHeaderActions}>
            <TouchableOpacity onPress={() => handleShare(item)} style={styles.iconButton}>
              <Ionicons name="share-outline" size={20} color="#9AACD1" />
            </TouchableOpacity>
            {canDelete ? (
              <DeleteAction
                id={item.id}
                onDelete={handleDeleteVideo}
                variant="icon"
                confirmTitle="Delete video?"
                confirmMessage="This removes the clip and metrics permanently."
                style={styles.iconButton}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.videoWrapper}>
          {item.signedUrl ? (
            <FeedVideoPlayer uri={item.signedUrl} thumbnailUrl={item.thumbnailUrl} />
          ) : (
            <View style={styles.videoPlaceholder}>
              <Ionicons name="videocam-outline" size={24} color="#4C8CFF" />
              <Text style={styles.videoPlaceholderText}>Signed link unavailable</Text>
            </View>
          )}
        </View>

        <View style={styles.feedActions}>
          <View style={styles.feedActionGroup}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#9AACD1" />
            <Text style={styles.feedActionLabel}>Comments</Text>
          </View>
          <View style={styles.feedActionGroup}>
            <Ionicons name="time-outline" size={18} color="#9AACD1" />
            <Text style={styles.feedActionLabel}>{item.duration_seconds ? `${Math.round(item.duration_seconds)}s` : '—'}</Text>
          </View>
          <View style={styles.feedActionGroup}>
            <Ionicons name="link-outline" size={18} color="#9AACD1" />
            <Text style={styles.feedActionLabel}>Share</Text>
          </View>
        </View>

        {metricBadges.length > 0 && (
          <View style={styles.metricChips}>
            {metricBadges.map((badge) => (
              <View key={badge} style={styles.metricChip}>
                <Text style={styles.metricChipText}>{badge}</Text>
              </View>
            ))}
          </View>
        )}
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
            console.log('Navigating to add-workout');
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
            console.log('Navigating to add-food');
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
      <View style={styles.headerRow}>
        <View style={styles.headerTextContainer}>
          <Text style={styles.title}>Welcome back, {getDisplayName()}!</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setActiveTab('coach')}>
            <Ionicons name="sparkles-outline" size={22} color={activeTab === 'coach' ? '#4C8CFF' : '#9AACD1'} />
          </TouchableOpacity>
        </View>
      </View>

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
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'coach' && styles.tabButtonActive]}
          onPress={() => setActiveTab('coach')}
        >
          <Text style={[styles.tabText, activeTab === 'coach' && styles.tabTextActive]}>
            Coach
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'dashboard' ? renderDashboard() : activeTab === 'videos' ? renderVideoFeed() : renderCoach()}
    </View>
  );
}
