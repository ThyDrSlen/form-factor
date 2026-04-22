import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/use-safe-back';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { getFollowers, getFollowing, type FollowRelationship } from '@/lib/services/social-service';
import { warnWithTs } from '@/lib/logger';

type ActiveTab = 'followers' | 'following';

export default function FollowersModal() {
  const { user } = useAuth();
  const { show: showToast } = useToast();
  const safeBack = useSafeBack(['/(tabs)/profile', '/profile']);
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string; tab?: string }>();
  const targetUserId = typeof params.userId === 'string' ? params.userId : user?.id || '';

  const [activeTab, setActiveTab] = useState<ActiveTab>(params.tab === 'following' ? 'following' : 'followers');
  const [followers, setFollowers] = useState<FollowRelationship[]>([]);
  const [following, setFollowing] = useState<FollowRelationship[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (options?: { showLoading?: boolean }) => {
    if (!targetUserId) return;
    const showLoading = options?.showLoading ?? true;
    if (showLoading) {
      setLoading(true);
    }

    try {
      const [followerRows, followingRows] = await Promise.all([
        getFollowers(targetUserId),
        getFollowing(targetUserId),
      ]);
      setFollowers(followerRows);
      setFollowing(followingRows);
    } catch (error) {
      warnWithTs('[followers] Failed to load followers modal data', error);
      showToast('Unable to load followers right now.', { type: 'error' });
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [showToast, targetUserId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load({ showLoading: false });
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = activeTab === 'followers' ? followers : following;
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const display = row.profile?.display_name?.toLowerCase() ?? '';
      const username = row.profile?.username?.toLowerCase() ?? '';
      return display.includes(needle) || username.includes(needle);
    });
  }, [rows, search]);

  const emptyMessage = useMemo(() => {
    const trimmed = search.trim();
    if (trimmed.length > 0) {
      return `No results for '${trimmed}'`;
    }

    return activeTab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.';
  }, [activeTab, search]);

  const emptySubtext = useMemo(() => {
    if (search.trim().length > 0) {
      return 'Try a different name or username.';
    }

    return activeTab === 'followers'
      ? 'When people follow this account, they will appear here.'
      : 'Accounts followed by this user will appear here.';
  }, [activeTab, search]);

  const renderItem = ({ item }: { item: FollowRelationship }) => {
    const profile = item.profile;
    const displayName = profile?.display_name || profile?.username || 'User';
    const displayInitial = displayName.charAt(0).toUpperCase();
    // Wave-31 Pack A / A5 (#562): explicit per-row a11y so VoiceOver
    // announces "{name}'s profile, double tap to open" rather than a
    // generic "button". Decorative avatar / chevron are excluded from
    // the a11y tree so the label isn't repeated.
    const rowA11yLabel = `${displayName}'s profile`;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => profile?.user_id && router.push(`/(modals)/user-profile?userId=${profile.user_id}`)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={rowA11yLabel}
        accessibilityHint="Double tap to open"
      >
        {profile?.avatar_url ? (
          <Image
            source={{ uri: profile.avatar_url }}
            style={styles.avatar}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : (
          <View
            style={[styles.avatar, styles.avatarFallback]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.avatarFallbackText}>{displayInitial}</Text>
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{displayName}</Text>
          {profile?.username ? <Text style={styles.rowMeta}>@{profile.username}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color="#6781A6" accessible={false} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.iconButton}>
            <Ionicons name="chevron-back" size={20} color="#9AACD1" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Connections</Text>
          <TouchableOpacity onPress={() => void load()} style={styles.iconButton}>
            <Ionicons name="refresh" size={16} color="#9AACD1" />
          </TouchableOpacity>
        </View>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'followers' && styles.tabButtonActive]}
            onPress={() => setActiveTab('followers')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'followers' }}
            accessibilityLabel="Followers tab"
          >
            <Text style={[styles.tabText, activeTab === 'followers' && styles.tabTextActive]}>Followers</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'following' && styles.tabButtonActive]}
            onPress={() => setActiveTab('following')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'following' }}
            accessibilityLabel="Following tab"
          >
            <Text style={[styles.tabText, activeTab === 'following' && styles.tabTextActive]}>Following</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={15} color="#6781A6" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={`Search ${activeTab}`}
            placeholderTextColor="#6781A6"
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#4C8CFF" />
            <Text style={styles.mutedText}>Loading {activeTab}…</Text>
          </View>
        ) : (
          <FlatList
            data={filteredRows}
            keyExtractor={(item) => `${item.follower_id}:${item.following_id}`}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#4C8CFF"
                colors={['#4C8CFF']}
              />
            }
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Text style={styles.mutedText}>{emptyMessage}</Text>
                <Text style={styles.mutedText}>{emptySubtext}</Text>
              </View>
            }
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  flex: {
    flex: 1,
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
  searchWrap: {
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E3355',
    backgroundColor: '#0B1A2F',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: '#E9EFFF',
    paddingVertical: 10,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 30,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#152642',
    backgroundColor: '#0B1A2F',
    padding: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  mutedText: {
    color: '#9AACD1',
  },
});
