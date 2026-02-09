import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeBack } from '@/hooks/use-safe-back';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  getShareThread,
  markShareRead,
  replyToShare,
  type ShareReplyWithProfile,
  type ShareThread,
} from '@/lib/services/social-service';
import { buildOverlaySummary, formatRelativeTime, formatVideoTimestamp, getFormScore } from '@/lib/video-feed';
import { warnWithTs } from '@/lib/logger';

export default function ShareThreadModal() {
  const { user } = useAuth();
  const { shareId } = useLocalSearchParams<{ shareId?: string }>();
  const resolvedShareId = typeof shareId === 'string' ? shareId : '';
  const safeBack = useSafeBack(['/(modals)/shared-inbox', '/(tabs)/index', '/']);
  const { show: showToast } = useToast();

  const [thread, setThread] = useState<ShareThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyInput, setReplyInput] = useState('');
  const [sending, setSending] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoUri = thread?.share?.video?.signedUrl;
  const player = useVideoPlayer(videoUri ? { uri: videoUri } : null, (instance) => {
    instance.loop = false;
  });
  const videoRef = useRef<VideoView | null>(null);

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying: nextPlaying }) => {
      setIsPlaying(nextPlaying);
    });

    return () => sub.remove();
  }, [player]);

  const load = useCallback(async () => {
    if (!resolvedShareId) return;
    setLoading(true);
    try {
      await markShareRead(resolvedShareId);
      const next = await getShareThread(resolvedShareId);
      setThread(next);
    } catch (error) {
      warnWithTs('[share-thread] Failed to load share thread', error);
      showToast('Unable to load shared thread.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [resolvedShareId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSendReply = useCallback(async () => {
    if (!resolvedShareId || !replyInput.trim() || sending) return;

    try {
      setSending(true);
      const created = await replyToShare(resolvedShareId, replyInput);
      setThread((prev) => {
        if (!prev) return prev;

        const me = prev.share?.sender_id === user?.id ? prev.share?.sender_profile : prev.share?.recipient_profile;
        const nextReply: ShareReplyWithProfile = {
          ...created,
          profile: me ?? null,
        };

        return {
          ...prev,
          replies: [...prev.replies, nextReply],
        };
      });
      setReplyInput('');
    } catch (error) {
      warnWithTs('[share-thread] Failed to send share reply', error);
      showToast('Unable to send reply.', { type: 'error' });
    } finally {
      setSending(false);
    }
  }, [replyInput, resolvedShareId, sending, showToast, user?.id]);

  const videoOverlay = useMemo(() => {
    const video = thread?.share?.video;
    if (!video) {
      return { summary: 'Shared video', timestamp: '' };
    }
    const metrics = (video.metrics || {}) as Record<string, any>;
    const formScore = getFormScore(metrics, video.exercise);
    return {
      summary: buildOverlaySummary(metrics, video.duration_seconds, formScore),
      timestamp: formatVideoTimestamp(video.created_at),
    };
  }, [thread?.share?.video]);

  const renderReply = ({ item }: { item: ShareReplyWithProfile }) => {
    const isMine = item.user_id === user?.id;
    const name = isMine ? 'You' : item.profile?.display_name || item.profile?.username || 'Athlete';
    return (
      <View style={[styles.replyRow, isMine && styles.replyRowMine]}>
        <Text style={styles.replyName}>{name}</Text>
        <Text style={styles.replyBody}>{item.message}</Text>
        <Text style={styles.replyMeta}>{formatRelativeTime(item.created_at)}</Text>
      </View>
    );
  };

  const shareMessage = thread?.share?.message;
  const senderName = thread?.share?.sender_profile?.display_name || thread?.share?.sender_profile?.username || 'Sender';
  const recipientName = thread?.share?.recipient_profile?.display_name || thread?.share?.recipient_profile?.username || 'Recipient';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconButton}>
          <Ionicons name="chevron-back" size={20} color="#9AACD1" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Share Thread</Text>
        <View style={styles.iconButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#4C8CFF" />
          <Text style={styles.mutedText}>Loading thread…</Text>
        </View>
      ) : !thread?.share ? (
        <View style={styles.centerState}>
          <Text style={styles.mutedText}>Share not found.</Text>
        </View>
      ) : (
        <FlatList
          data={thread.replies}
          keyExtractor={(item) => item.id}
          renderItem={renderReply}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.shareCard}>
              <Text style={styles.shareMeta}>From {senderName} to {recipientName}</Text>

              <View style={styles.videoWrap}>
                {videoUri ? (
                  <>
                    <VideoView ref={videoRef} style={styles.video} player={player} contentFit="cover" nativeControls={false} />
                    <TouchableOpacity style={styles.videoTap} onPress={() => (isPlaying ? player.pause() : player.play())} />
                    {!isPlaying ? (
                      <TouchableOpacity style={styles.playButton} onPress={() => player.play()}>
                        <Ionicons name="play" size={22} color="#0B1324" />
                      </TouchableOpacity>
                    ) : null}
                    <View style={styles.videoOverlay}>
                      <Text style={styles.videoOverlayText}>{videoOverlay.summary}</Text>
                      {videoOverlay.timestamp ? <Text style={styles.videoOverlayMeta}>{videoOverlay.timestamp}</Text> : null}
                    </View>
                  </>
                ) : (
                  <View style={styles.videoFallback}>
                    <Ionicons name="videocam-off-outline" size={20} color="#9AACD1" />
                    <Text style={styles.mutedText}>Video unavailable</Text>
                  </View>
                )}
              </View>

              {shareMessage ? (
                <View style={styles.originalMessage}>
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color="#9AACD1" />
                  <Text style={styles.originalMessageText}>{shareMessage}</Text>
                </View>
              ) : null}

              <Text style={styles.replyHeading}>Replies</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Text style={styles.mutedText}>No replies yet. Start the conversation.</Text>
            </View>
          }
        />
      )}

      <View style={styles.composer}>
        <TextInput
          value={replyInput}
          onChangeText={setReplyInput}
          placeholder="Write a reply…"
          placeholderTextColor="#6781A6"
          style={styles.composerInput}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, (!replyInput.trim() || sending) && styles.sendButtonDisabled]}
          onPress={() => void handleSendReply()}
          disabled={!replyInput.trim() || sending}
        >
          {sending ? <ActivityIndicator color="#0F2339" /> : <Text style={styles.sendButtonText}>Send</Text>}
        </TouchableOpacity>
      </View>
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
    paddingBottom: 20,
    gap: 10,
  },
  shareCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#152642',
    backgroundColor: '#0B1A2F',
    padding: 12,
    marginBottom: 8,
  },
  shareMeta: {
    color: '#9AACD1',
    fontSize: 12,
    marginBottom: 10,
  },
  videoWrap: {
    height: 250,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    position: 'relative',
    backgroundColor: '#0A172A',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoTap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  playButton: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7FB3FF',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -24 }, { translateY: -24 }],
  },
  videoOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(10, 15, 28, 0.55)',
  },
  videoOverlayText: {
    color: '#F5F1DE',
    fontWeight: '600',
  },
  videoOverlayMeta: {
    marginTop: 2,
    color: '#CBD6F0',
    fontSize: 12,
  },
  videoFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  originalMessage: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E3355',
    backgroundColor: 'rgba(76, 140, 255, 0.08)',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  originalMessageText: {
    color: '#D7E3FF',
    flex: 1,
  },
  replyHeading: {
    color: '#9AACD1',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
  },
  replyRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#152642',
    backgroundColor: '#0B1A2F',
    padding: 10,
    gap: 3,
  },
  replyRowMine: {
    borderColor: '#315C97',
    backgroundColor: '#10243F',
  },
  replyName: {
    color: '#E9EFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  replyBody: {
    color: '#D7E3FF',
    fontSize: 14,
  },
  replyMeta: {
    color: '#9AACD1',
    fontSize: 11,
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: '#152642',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 8,
    backgroundColor: '#050E1F',
  },
  composerInput: {
    borderWidth: 1,
    borderColor: '#1E3355',
    borderRadius: 12,
    backgroundColor: '#0B1A2F',
    color: '#E9EFFF',
    minHeight: 48,
    textAlignVertical: 'top',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendButton: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4C8CFF',
    paddingVertical: 10,
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
    paddingVertical: 44,
    gap: 8,
  },
  mutedText: {
    color: '#9AACD1',
  },
});
