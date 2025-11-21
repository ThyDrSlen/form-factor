import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, RefreshControl, Share, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import { useAuth } from '../../contexts/AuthContext';
import { DashboardHealth } from '@/components';
import { listVideos, VideoWithUrls } from '@/lib/services/video-service';
import { styles } from './index.styles';

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

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'videos'>('dashboard');
  const [videos, setVideos] = useState<VideoWithUrls[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [refreshingVideos, setRefreshingVideos] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
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

    return (
      <View style={styles.feedCard}>
        <View style={styles.feedHeader}>
          <View style={styles.feedAvatar}>
            <Text style={styles.feedAvatarInitial}>{(item.exercise?.[0] || 'F').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.feedTitle}>{item.exercise || 'Workout share'}</Text>
            <Text style={styles.feedMeta}>Uploaded • {uploadedDate}</Text>
          </View>
          <TouchableOpacity onPress={() => handleShare(item)} style={styles.iconButton}>
            <Ionicons name="share-outline" size={20} color="#9AACD1" />
          </TouchableOpacity>
        </View>

        <View style={styles.videoWrapper}>
          {item.signedUrl ? (
            <Video
              source={{ uri: item.signedUrl }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              useNativeControls
              posterSource={item.thumbnailUrl ? { uri: item.thumbnailUrl } : undefined}
              usePoster={!!item.thumbnailUrl}
            />
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
            router.push('/add-workout');
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
            router.push('/add-food');
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
            </View>
          ) : null
        }
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Welcome back, {getDisplayName()}!</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <TouchableOpacity onPress={() => setActiveTab(activeTab === 'dashboard' ? 'videos' : 'dashboard')}>
          <Ionicons name={activeTab === 'videos' ? 'play-circle-outline' : 'stats-chart-outline'} size={22} color="#4C8CFF" />
        </TouchableOpacity>
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
      </View>

      {activeTab === 'dashboard' ? renderDashboard() : renderVideoFeed()}
    </View>
  );
}
