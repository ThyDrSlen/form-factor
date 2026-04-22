import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { CoachMessage, sendCoachPrompt } from '@/lib/services/coach-service';
import { fetchTodaySession, fetchCoachSessionMessages } from '@/lib/services/coach-history-service';
import { AppError, createError, logError, mapToUserMessage } from '@/lib/services/ErrorHandler';
import { CoachProviderBadge } from '@/components/coach/CoachProviderBadge';
import { CoachAvailabilityBanner } from '@/components/coach/CoachAvailabilityBanner';
import { styles } from '../../styles/tabs/_index.styles';
import { spacing } from '../../styles/tabs/_theme-constants';
import { tabColors } from '@/styles/tabs/_tab-theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVoiceMode } from '@/hooks/use-voice-mode';
import { useVoiceControl } from '@/contexts/VoiceControlContext';
import { isVoiceControlPipelineEnabled } from '@/lib/services/voice-pipeline-flag';
import { VoiceControlBanner } from '@/components/voice/VoiceControlBanner';
import { VoiceCommandFeedback } from '@/components/form-tracking/VoiceCommandFeedback';

const COACH_WELCOME_SEEN_KEY = 'coach_welcome_seen';

const coachIntroMessage: CoachMessage = {
  id: 'intro',
  role: 'assistant',
  content: 'I am your Form Factor AI coach. Tell me your goal, available time, gear, or any injuries and I will craft a realistic plan or adjust your current routine.',
};

const coachQuickPrompts = [
  'Plan a 75-minute strength session for today.',
  'Light recovery day ideas after heavy squats.',
  'Give me a 5-minute warm-up for pull day.',
  'High-protein meal ideas under 600 calories.',
];

export default function CoachScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { show: showToast } = useToast();
  const { restoreSessionId } = useLocalSearchParams<{ restoreSessionId?: string }>();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([coachIntroMessage]);
  const [coachInput, setCoachInput] = useState('');
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachErrorDomain, setCoachErrorDomain] = useState<AppError['domain'] | null>(null);
  const [coachErrorCode, setCoachErrorCode] = useState<string | null>(null);
  const [coachSending, setCoachSending] = useState(false);
  const [showCoachWelcome, setShowCoachWelcome] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const coachListRef = useRef<FlatList<CoachMessage>>(null);
  const voiceMode = useVoiceMode();
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const voiceControl = useVoiceControl();
  // Flag read at mount — safe to cache since the env var doesn't flip at runtime.
  const voicePipelineEnabled = useMemo(() => isVoiceControlPipelineEnabled(), []);
  const userMetadata = useMemo(
    () => (user?.user_metadata && typeof user.user_metadata === 'object'
      ? user.user_metadata as Record<string, unknown>
      : null),
    [user?.user_metadata],
  );

  const bottomOffset = Math.max(tabBarHeight, insets.bottom) + spacing.md;

  const [coachSessionId, setCoachSessionId] = useState(() => Crypto.randomUUID());

  const coachContext = useMemo(
    () => ({
      profile: {
        id: user?.id,
        name:
          (userMetadata && typeof userMetadata.full_name === 'string' ? userMetadata.full_name : null) ??
          (userMetadata && typeof userMetadata.name === 'string' ? userMetadata.name : null),
        email: user?.email ?? null,
      },
      focus: 'fitness_coach',
      sessionId: coachSessionId,
    }),
    [coachSessionId, user?.email, user?.id, userMetadata]
  );

  const handleCoachSend = async (preset?: string) => {
    Keyboard.dismiss();
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
    setCoachErrorDomain(null);
    setCoachErrorCode(null);
    setCoachSending(true);

    try {
      const reply = await sendCoachPrompt(conversation, coachContext);
      setCoachMessages(prev => [
        ...prev,
        { ...reply, id: reply.id || `coach-assistant-${Date.now()}` },
      ]);
      coachListRef.current?.scrollToEnd({ animated: true });
      if (voiceEnabled && reply.content) {
        voiceMode.playResponse(reply.content);
      }
    } catch (err) {
      const appErr = err as AppError | null;
      const hasDomain = Boolean(appErr && typeof appErr === 'object' && 'domain' in appErr);
      const fallback = 'Unable to reach the coach. Please try again.';
      setCoachError(hasDomain ? mapToUserMessage(appErr as AppError) : fallback);
      setCoachErrorDomain(hasDomain ? (appErr as AppError).domain : null);
      setCoachErrorCode(hasDomain ? (appErr as AppError).code : null);
    } finally {
      setCoachSending(false);
    }
  };

  const handleDismissWelcome = async () => {
    setShowCoachWelcome(false);
    await AsyncStorage.setItem(COACH_WELCOME_SEEN_KEY, 'true');
  };

  // Check if user has seen coach welcome on first visit
  React.useEffect(() => {
    const checkWelcomeSeen = async () => {
      try {
        const seen = await AsyncStorage.getItem(COACH_WELCOME_SEEN_KEY);
        if (!seen && coachMessages.length === 1) {
          setShowCoachWelcome(true);
        }
      } catch (err) {
        logError(
          createError(
            'coach',
            'WELCOME_CHECK_FAILED',
            err instanceof Error ? err.message : 'Failed to check welcome seen status',
            { details: err, severity: 'warning' },
          ),
          { feature: 'coach', location: 'coach.checkWelcomeSeen' },
        );
        // Default to not showing welcome on error
      }
    };
    checkWelcomeSeen();
  }, [coachMessages.length]);

  // Restore today's session on mount
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const restoreTodaySession = async () => {
      setSessionLoading(true);
      try {
        const session = await fetchTodaySession(user.id);
        if (cancelled) return;
        if (session && session.messages.length > 0) {
          setCoachMessages(session.messages.map((m, i) => ({ ...m, id: `restored-${i}` })));
          setCoachSessionId(session.sessionId);
        }
      } catch (error) {
        logError(
          createError(
            'coach',
            'SESSION_RESTORE_FAILED',
            error instanceof Error ? error.message : 'Failed to restore today session',
            { details: error },
          ),
          { feature: 'coach', location: 'coach.fetchTodaySession' },
        );
        if (!cancelled) {
          showToast('Unable to restore today\'s coach session.', { type: 'error' });
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    };

    void restoreTodaySession();
    return () => { cancelled = true; };
  }, [showToast, user?.id]);

  // Handle restoreSessionId param from history modal
  useEffect(() => {
    if (!restoreSessionId) return;
    let cancelled = false;

    const restoreSelectedSession = async () => {
      try {
        const session = await fetchCoachSessionMessages(restoreSessionId);
        if (cancelled) return;
        if (!session) {
          logError(
            createError(
              'coach',
              'SESSION_NOT_FOUND',
              'No session found for the requested id',
              { details: { restoreSessionId }, severity: 'warning' },
            ),
            { feature: 'coach', location: 'coach.fetchCoachSessionMessages' },
          );
          if (!cancelled) {
            showToast('Unable to restore that coach session.', { type: 'error' });
          }
          return;
        }

        setCoachMessages(session.messages.map((m, i) => ({ ...m, id: `restored-${i}` })));
        setCoachSessionId(session.sessionId);
      } catch (error) {
        logError(
          createError(
            'coach',
            'SESSION_RESTORE_FAILED',
            error instanceof Error ? error.message : 'Failed to restore coach session',
            { details: error },
          ),
          { feature: 'coach', location: 'coach.fetchCoachSessionMessages' },
        );
        if (!cancelled) {
          showToast('Unable to restore that coach session.', { type: 'error' });
        }
      }
    };

    void restoreSelectedSession();

    return () => {
      cancelled = true;
    };
  }, [restoreSessionId, showToast]);

  const handleNewChat = useCallback(() => {
    setCoachMessages([coachIntroMessage]);
    setCoachSessionId(Crypto.randomUUID());
    setCoachError(null);
    setCoachErrorDomain(null);
    setCoachErrorCode(null);
  }, []);

  const handleVoiceStart = useCallback(async () => {
    await voiceMode.startVoiceMode();
  }, [voiceMode]);

  const handleCoachSendRef = useRef(handleCoachSend);
  handleCoachSendRef.current = handleCoachSend;

  const handleVoiceStop = useCallback(() => {
    const transcript = voiceMode.stopVoiceMode();
    if (transcript.trim()) {
      handleCoachSendRef.current(transcript);
    }
  }, [voiceMode]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingBottom: bottomOffset }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={tabBarHeight}
    >
      <View style={styles.coachContainer}>
        {showCoachWelcome && (
          <View style={styles.coachWelcome}>
            <View style={styles.coachWelcomeHeader}>
              <TouchableOpacity onPress={handleDismissWelcome} style={styles.coachWelcomeClose}>
                <Ionicons name="close-circle" size={20} color="#4C8CFF" />
              </TouchableOpacity>
              <View style={styles.coachWelcomeTitleContainer}>
                <Text style={styles.coachWelcomeTitle}>Welcome to your AI Coach</Text>
              </View>
            </View>
            <Text style={styles.coachWelcomeText}>
              Tell me your fitness goals, available time, or any injuries and I&apos;ll craft personalized plans and recovery suggestions. I use your health data (sleep, heart rate, activity, weight trends) to adjust recommendations. Try prompts like:
            </Text>
            <View style={styles.coachWelcomeExampleContainer}>
              <Text style={styles.coachWelcomeExample}>• &quot;Plan a week of workouts&quot;</Text>
              <Text style={styles.coachWelcomeExample}>• &quot;Give me recovery ideas after heavy squats&quot;</Text>
              <Text style={styles.coachWelcomeExample}>• &quot;Suggest a high-protein meal for today&quot;</Text>
            </View>
            <TouchableOpacity
              style={styles.coachWelcomeButton}
              onPress={handleDismissWelcome}
            >
              <Text style={styles.coachWelcomeButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.coachHeader}>
          <Text style={styles.coachHeaderTitle}>Coach</Text>
          <View style={styles.coachHeaderActions}>
            <TouchableOpacity
              style={styles.coachHeaderButton}
              onPress={() => setVoiceEnabled(v => !v)}
              accessibilityRole="button"
              accessibilityLabel={voiceEnabled ? 'Turn off voice playback' : 'Turn on voice playback'}
            >
              <Ionicons
                name={voiceEnabled ? 'volume-high' : 'volume-mute-outline'}
                size={22}
                color={voiceEnabled ? tabColors.accent : tabColors.textSecondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.coachHeaderButton}
              onPress={() => router.push('/(modals)/coach-history')}
              accessibilityRole="button"
              accessibilityLabel="Open coach history"
            >
              <Ionicons name="time-outline" size={22} color={tabColors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.coachHeaderButton}
              onPress={handleNewChat}
              accessibilityRole="button"
              accessibilityLabel="Start new chat"
            >
              <Ionicons name="add-circle-outline" size={22} color={tabColors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {voicePipelineEnabled ? (
          <>
            <VoiceControlBanner
              style={{ marginHorizontal: spacing.md, marginBottom: spacing.sm }}
              testID="coach-voice-banner"
            />
            <VoiceCommandFeedback latestIntent={voiceControl.latestIntent} />
          </>
        ) : null}

        {/* #557 B4: offline-coach awareness banner. Self-hides when the
            network is online; dismissible with Got it on tap. */}
        <CoachAvailabilityBanner testID="coach-availability-banner" />

        <View style={styles.quickPrompts}>
          {coachQuickPrompts.map(prompt => (
            <TouchableOpacity
              key={prompt}
              style={styles.quickPrompt}
              onPress={() => handleCoachSend(prompt)}
              accessibilityRole="button"
              accessibilityLabel={`Quick prompt: ${prompt}`}
            >
              <Text style={styles.quickPromptText}>{prompt}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {coachError && (
          <View style={styles.coachError} testID="coach-error-banner">
            <Text style={styles.coachErrorTitle}>
              {coachErrorCode === 'COACH_RATE_LIMITED'
                ? 'Coach is rate-limited'
                : coachErrorDomain === 'network'
                  ? 'Connection error'
                  : coachErrorDomain === 'unknown' || coachErrorDomain == null
                    ? 'Coach is busy'
                    : 'Service unavailable'}
            </Text>
            <Text style={styles.coachErrorText}>{coachError}</Text>
          </View>
        )}

        {sessionLoading ? (
          <View style={styles.coachLoadingContainer}>
            <ActivityIndicator color={tabColors.accent} />
          </View>
        ) : (
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
                    {!isUser && item.provider && (
                      <CoachProviderBadge provider={item.provider} />
                    )}
                  </View>
                </View>
              );
            }}
            contentContainerStyle={styles.coachListContent}
            onContentSizeChange={() => coachListRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => coachListRef.current?.scrollToEnd({ animated: false })}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {voiceMode.isListening && (
          <View style={styles.coachVoiceIndicator}>
            <View style={styles.coachVoiceDot} />
            <Text style={styles.coachVoiceTranscript} numberOfLines={2}>
              {voiceMode.transcript || 'Listening...'}
            </Text>
          </View>
        )}

        {coachSending ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingBottom: 12 }}>
            <ActivityIndicator size="small" color="#4C8CFF" />
            <Text style={{ color: '#9AACD1', fontStyle: 'italic' }}>Coach is thinking...</Text>
          </View>
        ) : null}

        <View style={styles.coachComposer}>
          <TextInput
            style={styles.coachInput}
            placeholder="Ask for a plan, adjustment, or recovery ideas..."
            placeholderTextColor="#9AACD1"
            value={coachInput}
            onChangeText={setCoachInput}
            multiline
            accessibilityLabel="Coach message input"
            returnKeyType="send"
            onSubmitEditing={() => handleCoachSend()}
            editable={!coachSending}
          />

          {voiceEnabled && !coachSending && (
            <TouchableOpacity
              style={[
                styles.coachMicButton,
                voiceMode.isListening && styles.coachMicButtonActive,
              ]}
              onPress={voiceMode.isListening ? handleVoiceStop : handleVoiceStart}
            >
              <Ionicons
                name={voiceMode.isListening ? 'stop-circle' : 'mic'}
                size={20}
                color="#ffffff"
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.coachSend, (!coachInput.trim() || coachSending) && styles.coachSendDisabled]}
            onPress={() => handleCoachSend()}
            disabled={!coachInput.trim() || coachSending}
            accessibilityRole="button"
            accessibilityLabel={coachSending ? 'Sending message' : 'Send message'}
            accessibilityHint="Double-tap to send your prompt to the coach"
            accessibilityState={{ busy: coachSending, disabled: coachSending || !coachInput.trim() }}
          >
            {coachSending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Ionicons name="send" size={18} color="#ffffff" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
