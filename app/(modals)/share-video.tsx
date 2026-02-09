import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import { getMutualFollowProfiles, shareVideo, type ProfileRecord } from '@/lib/services/social-service';
import { warnWithTs } from '@/lib/logger';

export default function ShareVideoModal() {
  const { videoId } = useLocalSearchParams<{ videoId?: string }>();
  const resolvedVideoId = typeof videoId === 'string' ? videoId : '';
  const safeBack = useSafeBack(['/(tabs)/index', '/']);
  const router = useRouter();
  const { show: showToast } = useToast();

  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [search, setSearch] = useState('');
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadRecipients = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getMutualFollowProfiles(100);
      setProfiles(rows);
    } catch (error) {
      warnWithTs('[share-video] Failed to load mutual follow profiles', error);
      showToast('Unable to load recipients.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadRecipients();
  }, [loadRecipients]);

  const filteredProfiles = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return profiles;
    return profiles.filter((profile) => {
      const display = profile.display_name?.toLowerCase() ?? '';
      const username = profile.username?.toLowerCase() ?? '';
      return display.includes(needle) || username.includes(needle);
    });
  }, [profiles, search]);

  const handleSend = useCallback(async () => {
    if (!resolvedVideoId) {
      showToast('Missing video id.', { type: 'error' });
      return;
    }
    if (!selectedRecipientId || sending) return;

    try {
      setSending(true);
      const created = await shareVideo(resolvedVideoId, selectedRecipientId, message.trim() || undefined);
      showToast('Video sent.', { type: 'success' });
      router.replace(`/(modals)/share-thread?shareId=${created.id}`);
    } catch (error) {
      warnWithTs('[share-video] Failed to share video', error);
      showToast('Unable to share video.', { type: 'error' });
    } finally {
      setSending(false);
    }
  }, [message, resolvedVideoId, router, selectedRecipientId, sending, showToast]);

  const renderRecipient = ({ item }: { item: ProfileRecord }) => {
    const selected = selectedRecipientId === item.user_id;
    const displayName = item.display_name || item.username || 'User';
    const initial = displayName.charAt(0).toUpperCase();

    return (
      <TouchableOpacity
        style={[styles.recipientRow, selected && styles.recipientRowSelected]}
        onPress={() => setSelectedRecipientId(item.user_id)}
        activeOpacity={0.85}
      >
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarFallbackText}>{initial}</Text>
          </View>
        )}
        <View style={styles.recipientText}>
          <Text style={styles.recipientName}>{displayName}</Text>
          {item.username ? <Text style={styles.recipientMeta}>@{item.username}</Text> : null}
        </View>
        {selected ? <Ionicons name="checkmark-circle" size={20} color="#4C8CFF" /> : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={safeBack} activeOpacity={1} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.headerRow}>
          <Text style={styles.title}>Send to…</Text>
          <TouchableOpacity onPress={safeBack} style={styles.closeButton}>
            <Ionicons name="close" size={20} color="#9AACD1" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={15} color="#6781A6" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search mutual followers"
            placeholderTextColor="#6781A6"
            style={styles.searchInput}
          />
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#4C8CFF" />
            <Text style={styles.mutedText}>Loading recipients…</Text>
          </View>
        ) : (
          <FlatList
            data={filteredProfiles}
            keyExtractor={(item) => item.user_id}
            renderItem={renderRecipient}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Text style={styles.mutedText}>No mutual followers available.</Text>
              </View>
            }
          />
        )}

        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Add a message (optional)"
          placeholderTextColor="#6781A6"
          style={styles.messageInput}
          multiline
          numberOfLines={2}
        />

        <TouchableOpacity
          style={[styles.sendButton, (!selectedRecipientId || sending) && styles.sendButtonDisabled]}
          onPress={() => void handleSend()}
          disabled={!selectedRecipientId || sending}
        >
          {sending ? <ActivityIndicator color="#0F2339" /> : <Text style={styles.sendButtonText}>Send Video</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 14, 31, 0.72)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    maxHeight: '86%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    backgroundColor: '#0B1A2F',
    borderWidth: 1,
    borderColor: '#152642',
    gap: 10,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#27466E',
    alignSelf: 'center',
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#E9EFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(154, 172, 209, 0.1)',
  },
  searchWrap: {
    borderWidth: 1,
    borderColor: '#1E3355',
    backgroundColor: '#0A172A',
    borderRadius: 12,
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
    gap: 8,
    paddingBottom: 6,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#152642',
    backgroundColor: '#0A172A',
    padding: 10,
  },
  recipientRowSelected: {
    borderColor: '#4C8CFF',
    backgroundColor: 'rgba(76, 140, 255, 0.15)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  recipientText: {
    flex: 1,
    minWidth: 0,
  },
  recipientName: {
    color: '#E9EFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  recipientMeta: {
    color: '#9AACD1',
    fontSize: 13,
    marginTop: 2,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: '#1E3355',
    borderRadius: 12,
    backgroundColor: '#0A172A',
    color: '#E9EFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  sendButton: {
    marginTop: 4,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#4C8CFF',
  },
  sendButtonDisabled: {
    backgroundColor: '#2E405D',
  },
  sendButtonText: {
    color: '#0F2339',
    fontWeight: '700',
    fontSize: 15,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  mutedText: {
    color: '#9AACD1',
  },
});
