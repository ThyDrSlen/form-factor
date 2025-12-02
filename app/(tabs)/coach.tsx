import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { CoachMessage, sendCoachPrompt } from '@/lib/services/coach-service';
import { AppError, mapToUserMessage } from '@/lib/services/ErrorHandler';
import { styles } from '../../styles/tabs/_index.styles';
import { spacing } from '../../styles/tabs/_theme-constants';

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
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([coachIntroMessage]);
  const [coachInput, setCoachInput] = useState('');
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachSending, setCoachSending] = useState(false);
  const coachListRef = useRef<FlatList<CoachMessage>>(null);

  const bottomOffset = Math.max(tabBarHeight, insets.bottom) + spacing.md;

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

  return (
    <View style={[styles.container, { paddingBottom: bottomOffset }]}>
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
    </View>
  );
}
