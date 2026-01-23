import { Ionicons } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/use-safe-back';
import { isIOS } from '@/lib/platform-utils';

interface TipCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  tips: string[];
  delay: number;
}

function TipCard({ icon, title, tips, delay }: TipCardProps) {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [isExpanded, setIsExpanded] = useState(false);
  
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      delay: delay,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, delay]);
  
  return (
    <Animated.View style={[styles.tipCard, { opacity: fadeAnim }]}>
      <TouchableOpacity 
        style={styles.tipHeader}
        onPress={() => setIsExpanded(!isExpanded)}
        activeOpacity={0.7}
      >
        <View style={styles.tipHeaderLeft}>
          <View style={styles.tipIconContainer}>
            <Ionicons name={icon} size={24} color="#4C8CFF" />
          </View>
          <Text style={styles.tipTitle}>{title}</Text>
        </View>
        <Ionicons 
          name={isExpanded ? 'chevron-up' : 'chevron-down'} 
          size={20} 
          color="#9AACD1" 
        />
      </TouchableOpacity>
      
      {isExpanded && (
        <View style={styles.tipContent}>
          {tips.map((tip, index) => (
            <View key={index} style={styles.tipItem}>
              <Ionicons name="ellipse" size={6} color="#4C8CFF" />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

interface ExerciseCardProps {
  emoji: string;
  name: string;
  delay: number;
}

function ExerciseCard({ emoji, name, delay }: ExerciseCardProps) {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scale] = useState(new Animated.Value(1));
  
  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      delay: delay,
      useNativeDriver: true,
    }).start();
  }, [scale, delay]);
  
  return (
    <Animated.View style={[styles.exerciseCard, { opacity: fadeAnim, transform: [{ scale }] }]}>
      <Text style={styles.exerciseEmoji}>{emoji}</Text>
      <Text style={styles.exerciseName}>{name}</Text>
    </Animated.View>
  );
}

export default function ARKitUsageScreen() {
  const router = useRouter();
  const safeBack = useSafeBack('/(tabs)');
  const insets = useSafeAreaInsets();
  const isiOS = isIOS();
  
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleGetStarted = () => {
    router.replace('/(tabs)/scan-arkit');
  };

  const handleSkip = () => {
    router.replace('/(tabs)');
  };

  const setupTips: { icon: keyof typeof Ionicons.glyphMap; title: string; tips: string[] }[] = [
    {
      icon: 'aperture-outline',
      title: 'Phone Position',
      tips: [
        'Place phone 3-6 feet away (arm\'s length)',
        'Angle camera to see your full body',
        'Secure phone on tripod, stand, or propped up',
        'Good lighting improves tracking accuracy',
      ],
    },
    {
      icon: 'fitness-outline',
      title: 'Exercise Setup',
      tips: [
        'Stay within the camera frame at all times',
        'Face the camera for best tracking results',
        'Keep your entire body visible (head to toes)',
        'Wait for detection before starting reps',
      ],
    },
    {
      icon: 'bulb-outline',
      title: 'Best Practices',
      tips: [
        'Start with exercises you know well',
        'Use mirrors as backup safety measure',
        'Progressively increase difficulty',
        'Review form feedback after each set',
      ],
    },
  ];

  const exercises = [
    { emoji: '🏋️', name: 'Pull-ups' },
    { emoji: '💪', name: 'Push-ups' },
    { emoji: '🦵', name: 'Squats' },
    { emoji: '🏃', name: 'Lunges' },
    { emoji: '💪', name: 'Dips' },
    { emoji: '✨', name: 'More...', comingSoon: true },
  ];

  const troubleshootingItems = [
    {
      question: 'Camera not detecting me',
      answer: 'Move to better lighting, adjust your position, or try a different camera angle.',
    },
    {
      question: 'Form cues not showing',
      answer: 'Make sure your full body is visible and you\'re facing the camera directly.',
    },
    {
      question: 'App running slow',
      answer: 'Close other apps and restart Form Factor. Ensure sufficient storage space.',
    },
    {
      question: 'Accuracy issues',
      answer: 'Try better lighting, adjust camera angle, and ensure you\'re in frame.',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.keyboardAvoid}
        behavior={isiOS ? 'padding' : undefined}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <TouchableOpacity onPress={safeBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#007AFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Get Started</Text>
            <View style={styles.progressContainer}>
              <View style={[styles.progressDot, styles.progressDotInactive]} />
              <View style={styles.progressDot} />
            </View>
          </Animated.View>

          {/* Hero Section */}
          <Animated.View style={[styles.heroSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={styles.heroIconContainer}>
              <Ionicons name="fitness" size={48} color="#4C8CFF" />
            </View>
            <Text style={styles.heroTitle}>Ready to Track Your Form?</Text>
            <Text style={styles.heroSubtitle}>
              Let&apos;s get you set up for successful form tracking with your camera.
            </Text>
          </Animated.View>

          {/* Setup Tips */}
          <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
            <Text style={styles.sectionTitle}>Setup Tips</Text>
            {setupTips.map((tip, index) => (
              <TipCard 
                key={tip.title}
                icon={tip.icon}
                title={tip.title}
                tips={tip.tips}
                delay={200 + (index * 100)}
              />
            ))}
          </Animated.View>

          {/* Supported Exercises */}
          <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
            <Text style={styles.sectionTitle}>Supported Exercises</Text>
            <View style={styles.exerciseGrid}>
              {exercises.map((exercise, index) => (
                <ExerciseCard 
                  key={exercise.name}
                  emoji={exercise.emoji}
                  name={exercise.name}
                  delay={400 + (index * 50)}
                />
              ))}
            </View>
          </Animated.View>

          {/* Safety Tips */}
          <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
            <View style={styles.safetySection}>
              <View style={styles.safetyHeader}>
                <Ionicons name="medical-outline" size={24} color="#FF6B6B" />
                <Text style={styles.safetyTitle}>Safety First</Text>
              </View>
              <View style={styles.safetyTips}>
                <View style={styles.safetyTip}>
                  <Ionicons name="warning-outline" size={20} color="#FF6B6B" />
                  <Text style={styles.safetyTipText}>
                    Use mirrors for safety - don&apos;t rely solely on your phone
                  </Text>
                </View>
                <View style={styles.safetyTip}>
                  <Ionicons name="warning-outline" size={20} color="#FF6B6B" />
                  <Text style={styles.safetyTipText}>
                    Clear area of obstacles before exercising
                  </Text>
                </View>
                <View style={styles.safetyTip}>
                  <Ionicons name="warning-outline" size={20} color="#FF6B6B" />
                  <Text style={styles.safetyTipText}>
                    Start with lighter weights to perfect your form
                  </Text>
                </View>
                <View style={styles.safetyTip}>
                  <Ionicons name="warning-outline" size={20} color="#FF6B6B" />
                  <Text style={styles.safetyTipText}>
                    Always listen to your body and stop if you feel pain
                  </Text>
                </View>
              </View>
            </View>
          </Animated.View>

          {/* Troubleshooting */}
          <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
            <Text style={styles.sectionTitle}>Troubleshooting</Text>
            {troubleshootingItems.map((item, index) => (
              <View key={index} style={styles.troubleshootingItem}>
                <Text style={styles.troubleshootingQuestion}>❓ {item.question}</Text>
                <Text style={styles.troubleshootingAnswer}>💡 {item.answer}</Text>
              </View>
            ))}
          </Animated.View>

          {/* Action Buttons */}
          <Animated.View style={[styles.actionsSection, { opacity: fadeAnim }]}>
            <TouchableOpacity 
              style={styles.getStartedButton}
              onPress={handleGetStarted}
            >
              <Ionicons name="play" size={20} color="#fff" />
              <Text style={styles.getStartedButtonText}>Start Your First Workout</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.skipButton}
              onPress={handleSkip}
            >
              <Text style={styles.skipButtonText}>Skip to Dashboard</Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Bottom Safe Area */}
          <View style={{ height: insets.bottom + 20 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 20,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F7FF',
    textAlign: 'center',
    marginRight: 40,
  },
  progressContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007AFF',
  },
  progressDotInactive: {
    backgroundColor: '#1B2E4A',
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  heroIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F5F7FF',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#9AACD1',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 16,
  },
  tipCard: {
    backgroundColor: '#0F2339',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  tipHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tipIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  tipContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  tipText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: '#9AACD1',
    lineHeight: 20,
  },
  exerciseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  exerciseCard: {
    width: '30%',
    backgroundColor: '#0F2339',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  exerciseEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  exerciseName: {
    fontSize: 12,
    color: '#9AACD1',
    textAlign: 'center',
  },
  safetySection: {
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
    padding: 20,
  },
  safetyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  safetyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FF6B6B',
    marginLeft: 12,
  },
  safetyTips: {
    gap: 12,
  },
  safetyTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  safetyTipText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: '#FFB3B3',
    lineHeight: 20,
  },
  troubleshootingItem: {
    backgroundColor: '#0F2339',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  troubleshootingQuestion: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 8,
  },
  troubleshootingAnswer: {
    fontSize: 14,
    color: '#9AACD1',
    lineHeight: 20,
  },
  actionsSection: {
    marginTop: 8,
    gap: 12,
  },
  getStartedButton: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  getStartedButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipButtonText: {
    color: '#9AACD1',
    fontSize: 16,
    fontWeight: '600',
  },
});
