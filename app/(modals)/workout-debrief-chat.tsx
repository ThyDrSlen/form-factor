/**
 * WorkoutDebriefChatModal
 *
 * Gemma-powered retrospective chat for a past workout (GEMMA-5 /
 * INT-1). The modal route accepts a `workoutId` query param; the
 * first assistant message is generated from the recall context, after
 * which the user can ask follow-up questions.
 *
 * Flag gating: when EXPO_PUBLIC_WORKOUT_COACH_RECALL is off, the
 * modal renders a disabled fallback card instead of the chat UI so the
 * screen is always mountable (a deep-link into this route with the
 * flag off simply shows "feature disabled").
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TextInput } from 'react-native-paper';

import { useWorkoutCoachContext } from '@/hooks/use-workout-coach-context';
import type { CoachMessage } from '@/lib/services/coach-service';

interface ChatBubble {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

let bubbleSeq = 0;
function nextBubbleId(prefix: string): string {
  bubbleSeq += 1;
  return `${prefix}-${bubbleSeq}`;
}

export default function WorkoutDebriefChatModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ workoutId?: string }>();
  const workoutId = typeof params.workoutId === 'string' ? params.workoutId : '';

  const { enabled, askAboutWorkout } = useWorkoutCoachContext();

  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState('');
  const [firstLoading, setFirstLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the latest askAboutWorkout in a ref so the first-message
  // effect does not re-fire when the hook returns a fresh closure each
  // render (matters when consumers don't memoize the hook return).
  const askRef = useRef(askAboutWorkout);
  useEffect(() => {
    askRef.current = askAboutWorkout;
  }, [askAboutWorkout]);

  // First-message stream — triggered once on mount when flag is on.
  useEffect(() => {
    if (!enabled || !workoutId) return;
    let cancelled = false;
    (async () => {
      setFirstLoading(true);
      setError(null);
      try {
        const reply = await askRef.current(workoutId, '');
        if (cancelled || !mountedRef.current) return;
        if (reply) {
          setBubbles((prev) => [
            ...prev,
            { id: nextBubbleId('a'), role: 'assistant', content: reply.content },
          ]);
        }
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load the retrospective.');
      } finally {
        if (!cancelled && mountedRef.current) {
          setFirstLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, workoutId]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !enabled || !workoutId) return;
    const userBubble: ChatBubble = {
      id: nextBubbleId('u'),
      role: 'user',
      content: trimmed,
    };
    setBubbles((prev) => [...prev, userBubble]);
    setInput('');
    setSending(true);
    setError(null);
    try {
      const reply: CoachMessage | null = await askRef.current(workoutId, trimmed);
      if (!mountedRef.current) return;
      if (reply) {
        setBubbles((prev) => [
          ...prev,
          { id: nextBubbleId('a'), role: 'assistant', content: reply.content },
        ]);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Message failed to send.');
    } finally {
      if (mountedRef.current) {
        setSending(false);
      }
    }
  }, [input, enabled, workoutId]);

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleClose}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Close retrospective chat"
          testID="workout-debrief-chat-close"
        >
          <Ionicons name="close" size={22} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Workout retrospective</Text>
        <View style={styles.headerSpacer} />
      </View>
    ),
    [handleClose],
  );

  if (!enabled) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centerState}>
          <View style={styles.disabledCard} testID="workout-debrief-chat-disabled">
            <Ionicons name="lock-closed-outline" size={28} color="#9AACD1" />
            <Text style={styles.disabledTitle}>Feature disabled</Text>
            <Text style={styles.disabledText}>
              Ask-coach retrospective chat is behind a feature flag. Set
              {' '}EXPO_PUBLIC_WORKOUT_COACH_RECALL=1 to enable it.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="workout-debrief-chat-root">
      {header}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.bubbleList}
          showsVerticalScrollIndicator={false}
        >
          {firstLoading && bubbles.length === 0 ? (
            <View style={styles.skeletonBubble} testID="workout-debrief-chat-skeleton">
              <ActivityIndicator color="#4C8CFF" />
              <Text style={styles.skeletonText}>Building retrospective…</Text>
            </View>
          ) : null}
          {bubbles.map((b) => (
            <View
              key={b.id}
              style={[
                styles.bubble,
                b.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
              testID={`workout-debrief-chat-bubble-${b.role}`}
            >
              <Text
                style={[
                  styles.bubbleText,
                  b.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant,
                ]}
              >
                {b.content}
              </Text>
            </View>
          ))}
          {error ? (
            <View style={styles.errorBanner} testID="workout-debrief-chat-error">
              <Ionicons name="alert-circle" size={16} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.inputRow}>
          <TextInput
            mode="outlined"
            value={input}
            onChangeText={setInput}
            placeholder="Ask Gemma about this workout…"
            style={styles.input}
            outlineColor="rgba(154, 172, 209, 0.2)"
            activeOutlineColor="#4C8CFF"
            textColor="#F5F7FF"
            theme={{
              colors: {
                onSurfaceVariant: '#9AACD1',
                background: '#12243A',
                primary: '#4C8CFF',
              },
            }}
            editable={!sending}
            multiline
            testID="workout-debrief-chat-input"
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || input.trim().length === 0}
            style={[
              styles.sendButton,
              (sending || input.trim().length === 0) && styles.sendButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send follow-up"
            testID="workout-debrief-chat-send"
          >
            {sending ? (
              <ActivityIndicator color="#F5F7FF" size="small" />
            ) : (
              <Ionicons name="send" size={18} color="#F5F7FF" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1626',
  },
  flex: { flex: 1 },
  header: {
    paddingTop: 58,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(154, 172, 209, 0.18)',
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.2)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F7FF',
    marginRight: 34,
  },
  headerSpacer: { width: 0 },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  disabledCard: {
    backgroundColor: '#12243A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.2)',
    padding: 20,
    alignItems: 'center',
    gap: 8,
    maxWidth: 360,
  },
  disabledTitle: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  disabledText: {
    color: '#9AACD1',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  },
  bubbleList: {
    padding: 16,
    gap: 8,
    paddingBottom: 24,
  },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    maxWidth: '86%',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#4C8CFF',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#12243A',
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.14)',
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleTextUser: {
    color: '#F5F7FF',
  },
  bubbleTextAssistant: {
    color: '#DCE5F5',
  },
  skeletonBubble: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#12243A',
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.14)',
  },
  skeletonText: {
    color: '#9AACD1',
    fontSize: 13,
  },
  errorBanner: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  errorText: {
    color: '#F5F7FF',
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(154, 172, 209, 0.18)',
    backgroundColor: '#0B1626',
  },
  input: {
    flex: 1,
    backgroundColor: '#12243A',
    maxHeight: 120,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4C8CFF',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(76, 140, 255, 0.4)',
  },
});
