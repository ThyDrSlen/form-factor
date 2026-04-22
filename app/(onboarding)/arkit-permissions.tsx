import { Ionicons } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/use-safe-back';
import { isIOS } from '@/lib/platform-utils';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { trackOnboardingEvent } from '@/lib/services/onboarding-analytics';

type IoniconName = keyof typeof Ionicons.glyphMap;

interface FeatureCardProps {
  icon: IoniconName;
  title: string;
  description: string;
  delay: number;
}

function FeatureCard({ icon, title, description, delay }: FeatureCardProps) {
  const [fadeAnim] = useState(new Animated.Value(0));
  
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      delay: delay,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, delay]);
  
  return (
    <Animated.View style={[styles.featureCard, { opacity: fadeAnim }]}>
      <View style={styles.featureIconContainer}>
        <Ionicons name={icon} size={24} color="#4C8CFF" />
      </View>
      <View style={styles.featureContent}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
      </View>
    </Animated.View>
  );
}

export default function ARKitPermissionsScreen() {
  const router = useRouter();
  const safeBack = useSafeBack('/(tabs)');
  const insets = useSafeAreaInsets();
  const isiOS = isIOS();
  
  const [permission, requestPermission] = useCameraPermissions();
  const [isRequesting, setIsRequesting] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));

  useEffect(() => {
    trackOnboardingEvent('step_view', 'arkit-permissions');
  }, []);

  // A11: split the permission-check effect from the intro animation so a
  // slow permission lookup (first app launch / cold start) doesn't hold the
  // fade-in/slide-in animation hostage. The animation now runs exactly once
  // on mount; the permission-granted redirect runs independently.
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
    // Intentionally omit `permission` from deps so re-renders triggered by a
    // late-arriving permission status don't restart the intro animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (permission?.granted) {
      router.replace('/(onboarding)/arkit-usage');
    }
  }, [permission?.granted, router]);

  const handleRequestPermission = async () => {
    if (isRequesting) return;
    
    setIsRequesting(true);
    try {
      const response = await requestPermission();
      
      if (response.granted) {
        trackOnboardingEvent('step_complete', 'arkit-permissions');
        router.replace('/(onboarding)/arkit-usage');
      } else {
        Alert.alert(
          'Camera Access Needed',
          'To analyze your form, Form Factor needs camera access. You can enable it later in Settings.',
          [
            { text: 'Not Now', style: 'cancel' },
            { 
              text: 'Open Settings', 
              onPress: () => {
                if (isiOS) {
                  Linking.openURL('app-settings:');
                } else {
                  Linking.openSettings();
                }
              }
            },
          ]
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to request camera permission. Please try again.');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleOpenSettings = () => {
    if (isiOS) {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  const features: Omit<FeatureCardProps, 'delay'>[] = [
    {
      icon: 'eye-outline',
      title: 'Real-Time Analysis',
      description: 'AI detects your body position instantly to catch form issues early.',
    },
    {
      icon: 'fitness-outline',
      title: 'Automatic Rep Counting',
      description: 'Count reps and sets automatically so you can focus on your workout.',
    },
    {
      icon: 'bulb-outline',
      title: 'Instant Form Feedback',
      description: 'Get personalized cues for depth, angle, and technique improvement.',
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
            <Text style={styles.headerTitle}>Camera Access</Text>
            <OnboardingProgress current={1} total={3} />
          </Animated.View>

          {/* Hero Section */}
          <Animated.View style={[styles.heroSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={styles.heroIconContainer}>
              <Ionicons name="camera-outline" size={64} color="#4C8CFF" />
            </View>
            <Text style={styles.heroTitle}>See Your Form Like a Pro</Text>
            <Text style={styles.heroSubtitle}>
              Real-time AI analysis of your exercise form to help you train smarter and avoid injury.
            </Text>
          </Animated.View>

          {/* Feature Cards */}
          <Animated.View style={[styles.featuresSection, { opacity: fadeAnim }]}>
            {features.map((feature, index) => (
              <FeatureCard 
                key={feature.title}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
                delay={300 + (index * 100)}
              />
            ))}
          </Animated.View>

          {/* Privacy Section */}
          <Animated.View style={[styles.privacySection, { opacity: fadeAnim }]}>
            <View style={styles.privacyHeader}>
              <Ionicons name="shield-checkmark-outline" size={24} color="#34C759" />
              <Text style={styles.privacyTitle}>Your Privacy Matters</Text>
            </View>
            <View style={styles.privacyPoints}>
              <View style={styles.privacyPoint}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.privacyPointText}>Video is analyzed in real-time by default</Text>
              </View>
              <View style={styles.privacyPoint}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.privacyPointText}>Cloud upload only happens if you enable research upload</Text>
              </View>
              <View style={styles.privacyPoint}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.privacyPointText}>You control when camera is active</Text>
              </View>
              <View style={styles.privacyPoint}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.privacyPointText}>You can change upload consent anytime in Privacy settings</Text>
              </View>
            </View>
          </Animated.View>

          {/* Action Buttons */}
          <Animated.View style={[styles.actionsSection, { opacity: fadeAnim }]}>
            {permission === null ? (
              // A11: permission status hasn't resolved yet — show a subtle
              // spinner row so the CTA area isn't empty during cold start.
              <View style={styles.permissionPending} testID="arkit-permission-loading">
                <ActivityIndicator size="small" color="#4C8CFF" />
                <Text style={styles.permissionPendingText}>Checking camera access…</Text>
              </View>
            ) : permission?.status === 'denied' ? (
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={handleOpenSettings}
              >
                <Ionicons name="settings-outline" size={20} color="#fff" />
                <Text style={styles.settingsButtonText}>Open Settings</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.permissionButton, isRequesting && styles.permissionButtonDisabled]}
                onPress={handleRequestPermission}
                disabled={isRequesting}
              >
                {isRequesting ? (
                  <Animated.View style={styles.loadingIndicator}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.permissionButtonText}>Requesting...</Text>
                  </Animated.View>
                ) : (
                  <>
                    <Ionicons name="camera" size={20} color="#fff" />
                    <Text style={styles.permissionButtonText}>Enable Camera Access</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity 
              style={styles.skipButton}
              onPress={() => router.replace('/(tabs)')}
            >
              <Text style={styles.skipButtonText}>Not now</Text>
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
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F5F7FF',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 36,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#9AACD1',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  featuresSection: {
    marginBottom: 24,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#0F2339',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  featureIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(76, 140, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 14,
    color: '#9AACD1',
    lineHeight: 20,
  },
  privacySection: {
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.3)',
    padding: 20,
    marginBottom: 24,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  privacyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#34C759',
    marginLeft: 12,
  },
  privacyPoints: {
    gap: 12,
  },
  privacyPoint: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  privacyPointText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: '#9AACD1',
    lineHeight: 20,
  },
  actionsSection: {
    gap: 12,
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  permissionButtonDisabled: {
    backgroundColor: '#2F4B66',
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  loadingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsButton: {
    backgroundColor: '#4C8CFF',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  settingsButtonText: {
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
  permissionPending: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  permissionPendingText: {
    color: '#9AACD1',
    fontSize: 14,
    fontWeight: '500',
  },
});
