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
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Permissions from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/use-safe-back';
import { isIOS } from '@/lib/platform-utils';

interface FeatureCardProps {
  icon: string;
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
  const safeBack = useSafeBack();
  const insets = useSafeAreaInsets();
  const isiOS = isIOS();
  
  const [permissionStatus, setPermissionStatus] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');
  const [isRequesting, setIsRequesting] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));

  useEffect(() => {
    // Animate entrance
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
    
    // Check current permission status
    checkPermissionStatus();
  }, [fadeAnim, slideAnim]);

  const checkPermissionStatus = async () => {
    try {
      const { status } = await Permissions.getCameraPermissionsStatus();
      setPermissionStatus(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');
      
      // If already granted, redirect to usage onboarding
      if (status === 'granted') {
        router.replace('/(onboarding)/arkit-usage');
      }
    } catch (error) {
      console.error('Error checking camera permission:', error);
    }
  };

  const handleRequestPermission = async () => {
    if (isRequesting) return;
    
    setIsRequesting(true);
    try {
      const { status } = await Permissions.requestCameraPermissions();
      const newStatus = status === 'granted' ? 'granted' : 'denied';
      setPermissionStatus(newStatus);
      
      if (status === 'granted') {
        // Success - move to usage onboarding
        router.replace('/(onboarding)/arkit-usage');
      } else {
        // Permission denied - show helpful message
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
    } catch (error) {
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

  const features = [
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
            <View style={styles.progressContainer}>
              <View style={styles.progressDot} />
              <View style={[styles.progressDot, styles.progressDotInactive]} />
            </View>
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
                <Text style={styles.privacyPointText}>Video is analyzed in real-time, never stored</Text>
              </View>
              <View style={styles.privacyPoint}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.privacyPointText}>No cloud upload of your footage</Text>
              </View>
              <View style={styles.privacyPoint}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.privacyPointText}>You control when camera is active</Text>
              </View>
              <View style={styles.privacyPoint}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.privacyPointText}>All processing happens on your device</Text>
              </View>
            </View>
          </Animated.View>

          {/* Action Buttons */}
          <Animated.View style={[styles.actionsSection, { opacity: fadeAnim }]}>
            {permissionStatus === 'denied' ? (
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
});
