import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WELCOME_SEEN_KEY = 'welcome_screen_seen';

type IoniconName = keyof typeof Ionicons.glyphMap;

const features: { icon: IoniconName; title: string; description: string }[] = [
  {
    icon: 'body-outline',
    title: 'Real-Time Form Cues',
    description: 'ARKit tracks your reps and flags swing, depth, and tempo as you move.',
  },
  {
    icon: 'barbell-outline',
    title: 'Auto Logging',
    description: 'Sets, reps, and weight captured automatically — no fiddling between sets.',
  },
  {
    icon: 'heart-outline',
    title: 'Health-Aware Coach',
    description: 'AI adapts to your sleep, HR, and recent load from HealthKit.',
  },
  {
    icon: 'cloud-offline-outline',
    title: 'Offline First',
    description: 'Everything works offline and syncs when you\'re back online.',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
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
      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.logoSection}>
          <View style={styles.logoCircle}>
            <Ionicons name="fitness" size={48} color="#4C8CFF" />
          </View>
          <Text style={styles.appName}>Form Factor</Text>
          <Text style={styles.tagline}>Real-time form coaching from your phone camera.</Text>
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
            <Text style={styles.primaryButtonText}>Get Started</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleExistingAccount}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="I already have an account"
            accessibilityHint="Opens login screen"
          >
            <Text style={styles.secondaryButtonText}>I already have an account</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
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
    backgroundColor: '#050E1F',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingBottom: 24,
  },
  logoSection: {
    alignItems: 'center',
    marginTop: 40,
    gap: 12,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.2)',
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: '#F5F7FF',
  },
  tagline: {
    fontSize: 16,
    color: '#9AACD1',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  featureList: {
    gap: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#0F2339',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
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
    fontWeight: '700',
    color: '#F5F7FF',
  },
  featureDescription: {
    fontSize: 14,
    color: '#9AACD1',
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
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: '#9AACD1',
    fontSize: 15,
    fontWeight: '600',
  },
});
