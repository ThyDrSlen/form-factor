import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  type AlertButton,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useSafeBack } from '@/hooks/use-safe-back';
import { warnWithTs } from '@/lib/logger';
import {
  addVideoComment,
  deleteVideoComment,
  fetchVideoComments,
  getVideoById,
  subscribeToVideoComments,
  type CommentRecord,
  type VideoWithUrls,
} from '@/lib/services/video-service';
import { emitCommentEvent } from '@/lib/video-comments-events';
import { formatRelativeTime, getFormLabel, getFormScore } from '@/lib/video-feed';
import { styles } from '../../styles/modals/_video-comments.styles';

export default function VideoCommentsModal() {
  const { videoId, returnTo } = useLocalSearchParams<{ videoId?: string; returnTo?: string }>();
  const { user } = useAuth();
  const { show: showToast } = useToast();
  const [video, setVideo] = useState<VideoWithUrls | null>(null);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isFocused = useIsFocused();

  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'You';
  const displayInitial = displayName.charAt(0).toUpperCase();

  const commentCount = useMemo(() => {
    if (comments.length > 0) return comments.length;
    return video?.comment_count ?? 0;
  }, [comments.length, video?.comment_count]);

  const fallbackPaths = useMemo(() => {
    if (returnTo === 'profile') {
      return ['/(tabs)/profile', '/profile'];
    }
    return ['/(tabs)/index', '/'];
  }, [returnTo]);

  const safeBack = useSafeBack(fallbackPaths);

  const sortedComments = useMemo(() => {
    return [...comments].sort((a, b) => {
      const aTs = new Date(a.created_at).getTime();
      const bTs = new Date(b.created_at).getTime();
      return bTs - aTs;
    });
  }, [comments]);

  const summaryData = useMemo(() => {
    if (!video) return null;
    const metrics = video.metrics || {};
    const formScore = getFormScore(metrics, video.exercise);
    const formLabel = getFormLabel(formScore);
    const reps = metrics.reps;
    const tokens: { type: 'text' | 'score'; value: string }[] = [];
    if (video.exercise) tokens.push({ type: 'text', value: video.exercise });
    if (formScore !== null) tokens.push({ type: 'score', value: String(formScore) });
    if (reps) tokens.push({ type: 'text', value: `${reps} reps` });
    if (formLabel) tokens.push({ type: 'text', value: formLabel });

    const chips: string[] = [];
    if (metrics.avgElbowDeg) chips.push(`Elbow avg ${Math.round(metrics.avgElbowDeg)}°`);
    if (metrics.avgShoulderDeg) chips.push(`Shoulder ${Math.round(metrics.avgShoulderDeg)}°`);
    if (metrics.hipDropRatio !== undefined && metrics.hipDropRatio !== null) {
      chips.push(`Hip drop ${(metrics.hipDropRatio * 100).toFixed(0)}%`);
    }
    if (metrics.headToHand !== undefined && metrics.headToHand !== null) {
      chips.push('Range look: clean');
    }

    return {
      tokens,
      chips: chips.slice(0, 2),
      meta: formatRelativeTime(video.created_at),
    };
  }, [video]);

  const primaryCue = useMemo(() => {
    if (!video) return null;
    const metrics = video.metrics || {};
    const formScore = getFormScore(metrics, video.exercise);
    const label = getFormLabel(formScore);
    if (label) return `Form was ${label.toLowerCase()} - keep it up.`;
    return null;
  }, [video]);

  const loadComments = useCallback(async () => {
    if (!videoId || typeof videoId !== 'string') return;
    setLoading(true);
    setLoadError(null);
    setComments([]);
    try {
      const [videoData, commentData] = await Promise.all([
        getVideoById(videoId),
        fetchVideoComments(videoId),
      ]);
      setVideo(videoData);
      setComments(commentData);
      setLoadError(null);
    } catch (error) {
      if (__DEV__) {
        warnWithTs('[Comments] Failed to load video/comments', error);
      }
      setLoadError('Unable to load comments. Tap to retry.');
      showToast('Unable to load comments right now.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showToast, videoId]);

  useEffect(() => {
    if (!isFocused) return;
    loadComments();
  }, [isFocused, loadComments]);

  useEffect(() => {
    if (!videoId || typeof videoId !== 'string') return;
    return () => {
      emitCommentEvent({ type: 'commentModalClosed', videoId });
    };
  }, [videoId]);

  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!videoId || typeof videoId !== 'string') return;

    // Always clean up any previously registered subscription before creating a
    // new one. This guards against rapid videoId changes or React Strict Mode
    // double-invocations where the cleanup from the previous run may not have
    // fired yet before the next run starts.
    unsubscribeRef.current?.();

    const unsubscribe = subscribeToVideoComments(videoId, (incoming) => {
      setComments((prev) => (prev.some((comment) => comment.id === incoming.id) ? prev : [...prev, incoming]));
    });
    unsubscribeRef.current = unsubscribe;

    return () => {
      unsubscribe();
      unsubscribeRef.current = null;
    };
  }, [videoId]);

  const handleSend = useCallback(async () => {
    if (!videoId || typeof videoId !== 'string') return;
    const trimmed = commentInput.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const created = await addVideoComment(videoId, trimmed);
      setComments((prev) => (prev.some((comment) => comment.id === created.id) ? prev : [...prev, created]));
      setCommentInput('');
      emitCommentEvent({ type: 'commentAdded', videoId });
    } catch (error) {
      if (__DEV__) {
        warnWithTs('[Comments] Failed to add comment', error);
      }
      showToast('Unable to send comment right now.', { type: 'error' });
    } finally {
      setSending(false);
    }
  }, [commentInput, sending, showToast, videoId]);

  const appendChip = useCallback((label: string) => {
    setCommentInput((prev) => {
      const next = prev.trim().length > 0 ? `${prev.trim()} ${label}` : label;
      return `${next} `;
    });
  }, []);

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      if (deleting) return;
      setDeleting(true);
      try {
        const result = await deleteVideoComment(commentId);
        setComments((prev) => prev.filter((c) => c.id !== commentId));
        showToast('Comment deleted.', { type: 'success' });
        emitCommentEvent({ type: 'commentDeleted', videoId: result.videoId });
      } catch (error) {
        if (__DEV__) {
          warnWithTs('[Comments] Failed to delete comment', error);
        }
        showToast('Unable to delete comment right now.', { type: 'error' });
      } finally {
        setDeleting(false);
        setSelectedCommentId(null);
      }
    },
    [deleting, showToast],
  );

  const renderComment = ({ item }: { item: CommentRecord }) => {
    const isMine = item.user_id === user?.id;
    const name = isMine ? 'You' : 'FF Athlete';
    const time = formatRelativeTime(item.created_at);

    const handleCommentOptions = () => {
      setSelectedCommentId(item.id);
      const actions: AlertButton[] = [
        {
          text: 'Report',
          style: 'destructive',
          onPress: () => {
            setSelectedCommentId(item.id);
            showToast('Comment reported. We will review it shortly.', { type: 'info' });
            setSelectedCommentId(null);
          },
        },
      ];

      if (isMine) {
        actions.push({
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete Comment',
              'Are you sure you want to delete this comment?',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => setSelectedCommentId(null) },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => void handleDeleteComment(item.id),
                },
              ],
              { onDismiss: () => setSelectedCommentId(null) },
            );
          },
        });
      }

      actions.push({
        text: 'Cancel',
        style: 'cancel',
        onPress: () => setSelectedCommentId(null),
      });

      Alert.alert('Comment Options', undefined, actions, {
        onDismiss: () => setSelectedCommentId(null),
      });
    };

    return (
      <View style={styles.commentRow}>
        <View style={styles.commentAvatar}>
          <Text style={styles.commentAvatarText}>{name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.commentBody}>
          <View style={styles.commentHeader}>
            <Text style={styles.commentName}>{name}</Text>
            <Text style={styles.commentTime}>{time}</Text>
            <TouchableOpacity
              style={styles.commentMore}
              onPress={handleCommentOptions}
              accessibilityLabel={selectedCommentId === item.id ? 'Comment options open' : 'Comment options'}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color="#9AACD1" />
            </TouchableOpacity>
          </View>
          <Text style={styles.commentText}>{item.comment}</Text>
          <View style={styles.commentMetaRow}>
            <View style={styles.commentMetaGroup}>
              <Ionicons name="heart-outline" size={14} color="#6781A6" />
              <Text style={styles.commentMetaText}>0</Text>
            </View>
            <View style={styles.commentMetaGroup}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color="#6781A6" />
              <Text style={styles.commentMetaText}>0</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={safeBack}>
            <Ionicons name="chevron-back" size={22} color="#9AACD1" />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Comments {commentCount}</Text>
        </View>

        {loading && comments.length === 0 ? (
          <View style={[styles.emptyState, { flex: 1, justifyContent: 'center' }]}>
            <ActivityIndicator size="large" color="#4C8CFF" />
            <Text style={styles.emptyText}>Loading comments…</Text>
          </View>
        ) : loadError && comments.length === 0 && !video ? (
          <TouchableOpacity
            onPress={() => {
              setLoadError(null);
              void loadComments();
            }}
            style={[styles.emptyState, { flex: 1, justifyContent: 'center', paddingHorizontal: 20 }]}
          >
            <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
            <Text style={[styles.emptyText, { marginTop: 12, fontSize: 16, textAlign: 'center' }]}>{loadError}</Text>
            <Text style={{ color: '#4C8CFF', fontSize: 14, marginTop: 8 }}>Tap to retry</Text>
          </TouchableOpacity>
        ) : (
          <FlatList
            data={sortedComments}
            keyExtractor={(item) => item.id}
            renderItem={renderComment}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View style={styles.summaryCard}>
                <View style={styles.summaryHeader}>
                  <View style={styles.avatarWrap}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{displayInitial}</Text>
                    </View>
                    <View style={styles.avatarStatus} />
                  </View>
                  <View>
                    <Text style={styles.summaryName}>{displayName}</Text>
                    <Text style={styles.summaryMeta}>
                      {summaryData?.meta ? `${summaryData.meta} • Personal Record` : 'Workout share'}
                    </Text>
                  </View>
                </View>

                <View style={styles.summaryLine}>
                  {summaryData?.tokens.map((token, index) => (
                    <React.Fragment key={`${token.value}-${index}`}>
                      {index > 0 ? <Text style={styles.summaryToken}>•</Text> : null}
                      {token.type === 'score' ? (
                        <View style={styles.scorePill}>
                          <Text style={styles.scoreText}>{token.value}</Text>
                        </View>
                      ) : (
                        <Text style={styles.summaryToken}>{token.value}</Text>
                      )}
                    </React.Fragment>
                  ))}
                </View>

                {summaryData?.chips && summaryData.chips.length > 0 ? (
                  <View style={styles.summaryChipRow}>
                    {summaryData.chips.map((chip) => (
                      <View key={chip} style={styles.summaryChip}>
                        <Text style={styles.summaryChipText}>{chip}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {primaryCue ? (
                  <View style={styles.takeawayRow}>
                    <Ionicons name="mic" size={14} color="#9AACD1" />
                    <Text style={styles.takeawayText}>{primaryCue}</Text>
                  </View>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No comments yet. Be the first.</Text>
              </View>
            }
          />
        )}

        {!loadError || comments.length > 0 || !!video ? (
          <View style={styles.composerWrap}>
            <View style={styles.composerRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{displayInitial}</Text>
              </View>
              <TextInput
                style={styles.composerInput}
                placeholder="Add a comment..."
                placeholderTextColor="#6E7FA3"
                value={commentInput}
                onChangeText={setCommentInput}
                multiline
              />
              <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending}>
                <Text style={styles.sendButtonText}>{sending ? '...' : 'Send'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.quickChipRow}>
              <TouchableOpacity style={styles.quickChip} onPress={() => appendChip('🔥')}>
                <Text style={styles.quickChipText}>🔥 +</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickChip} onPress={() => appendChip('Form tip:')}>
                <Text style={styles.quickChipText}>Form tip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickChip} onPress={() => appendChip('Question:')}>
                <Text style={styles.quickChipText}>Question</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
