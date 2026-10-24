import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Animated,
  StyleSheet,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { isOnboardingReplay } from '@/lib/services/onboarding';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BrandMark } from '@/components/BrandMark';
import { theme } from '@/styles/theme';

const WELCOME_SEEN_KEY = 'welcome_screen_seen';

type IoniconName = keyof typeof Ionicons.glyphMap;

const features: { icon: IoniconName; title: string; description: string }[] = [
  {
    icon: 'body-outline',
    title: 'Real-Time Form Cues',
    description: 'See what to adjust as you move.',
  },
  {
    icon: 'barbell-outline',
    title: 'Auto Logging',
    description: 'Keep your sets and reps in one place.',
  },
  {
    icon: 'heart-outline',
    title: 'Health-Aware Coach',
    description: 'Connect recovery with your training.',
  },
  {
    icon: 'cloud-offline-outline',
    title: 'Offline First',
    description: 'Log offline. Sync when you reconnect.',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const replay = Boolean(user) && isOnboardingReplay(mode);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(30));

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

  const handleGetStarted = async () => {
    if (user) {
      router.replace(replay
        ? '/(onboarding)/profile-setup?mode=replay'
        : '/(onboarding)/profile-setup');
      return;
    }
    await AsyncStorage.setItem(WELCOME_SEEN_KEY, 'true');
    // Primary CTA routes new users to sign-up.
    router.replace('/sign-up');
  };

  const handleExistingAccount = async () => {
    await AsyncStorage.setItem(WELCOME_SEEN_KEY, 'true');
    // Secondary CTA routes returning users to the sign-in form.
    // `mode=existing` is forwarded so sign-in can default to the
    // existing-account tab when that is wired up (see TODO in sign-in).
    router.replace('/sign-in?mode=existing');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.logoSection}>
          <View style={styles.brandRow}>
            <BrandMark size={48} />
            <Text style={styles.wordmark}>FORM FACTOR</Text>
          </View>
          <Text style={styles.appName}>Better form.{'\n'}Stronger you.</Text>
          <Text style={styles.tagline}>Make every rep count with live feedback and a clear view of your progress.</Text>
        </View>

        <View style={styles.featureList}>
          {features.map((feature, index) => (
            <Animated.View
              key={feature.title}
              style={[
                styles.featureRow,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: Animated.multiply(slideAnim, new Animated.Value(1 + index * 0.3)) }],
                },
              ]}
            >
              <View style={styles.featureIcon}>
                <Ionicons name={feature.icon} size={24} color="#4C8CFF" />
              </View>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            </Animated.View>
          ))}
        </View>

        <View style={styles.ctaSection}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleGetStarted}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>{user ? 'Continue' : 'Get Started'}</Text>
            <Ionicons name="arrow-forward" size={20} color={theme.colors.onAccent} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={user ? () => router.replace('/(tabs)/profile') : handleExistingAccount}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={user ? 'Back to Profile' : 'I already have an account'}
            accessibilityHint={user ? 'Closes the walkthrough' : 'Opens login screen'}
          >
            <Text style={styles.secondaryButtonText}>{user ? 'Back to Profile' : 'I already have an account'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

export async function hasSeenWelcome(): Promise<boolean> {
  const value = await AsyncStorage.getItem(WELCOME_SEEN_KEY);
  return value === 'true';
}

export async function clearWelcomeSeen(): Promise<void> {
  await AsyncStorage.removeItem(WELCOME_SEEN_KEY);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
    paddingBottom: 24,
  },
  logoSection: {
    alignItems: 'flex-start',
    marginTop: 24,
    marginBottom: 36,
    gap: 12,
  },
  scrollContent: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 26 },
  wordmark: { fontFamily: theme.font.bold, color: theme.colors.text, fontSize: 13, letterSpacing: 2 },
  appName: { fontFamily: theme.font.bold, fontSize: 44, lineHeight: 51, letterSpacing: -1.6, color: theme.colors.text },
  tagline: { fontFamily: theme.font.regular, fontSize: 16, color: theme.colors.secondary, lineHeight: 25, marginTop: 6 },
  featureList: {
    gap: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'transparent',
    borderRadius: 16,
    paddingVertical: 12,

  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    flex: 1,
    gap: 4,
  },
  featureTitle: {
    fontSize: 16,
    fontFamily: theme.font.bold,
    color: theme.colors.text,
  },
  featureDescription: {
    fontSize: 14,
    color: theme.colors.secondary,
    lineHeight: 20,
  },
  ctaSection: {
    gap: 12,
    marginTop: 24,
  },
  primaryButton: {
    backgroundColor: '#4C8CFF',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: theme.colors.onAccent,
    fontSize: 17,
    fontFamily: theme.font.bold,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: theme.colors.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
