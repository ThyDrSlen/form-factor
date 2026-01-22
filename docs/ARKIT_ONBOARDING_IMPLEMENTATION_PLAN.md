# ARKit Camera Permission & Usage Onboarding - Implementation Plan

**Created:** 2026-01-21  
**Priority:** HIGH  
**Estimated Duration:** 2-3 days  
**Status:** Ready for Implementation

---

## Executive Summary

Implement visual onboarding for ARKit body tracking camera permissions and usage guidance. This fills a critical gap where the app currently lacks camera permission handling entirely (only has MediaLibrary/photos permissions).

### Files to Create
1. `app/(onboarding)/arkit-permissions.tsx` - Camera permission request screen
2. `app/(onboarding)/arkit-usage.tsx` - Usage tips and guidance screen  
3. Update `app/_layout.tsx` - Add ARKit onboarding to navigation logic

### Key Features
- Privacy-first camera permission messaging
- Feature introduction with visual context
- Setup tips (camera distance, angle, lighting)
- Exercise-specific guidance
- Troubleshooting common issues

---

## Phase 1: Camera Permission Screen (`arkit-permissions.tsx`)

### 1.1 Screen Structure

```
app/(onboarding)/
├── arkit-permissions.tsx    (NEW - Permission request)
├── arkit-usage.tsx         (NEW - Usage guidance)  
└── nutrition-goals.tsx     (Existing)
```

### 1.2 UI Components

**Header**
- Back button (navigates back to previous onboarding step or tabs)
- Title: "Camera Access"
- Progress indicator (Step 1 of 2)

**Hero Section**
- Animated camera icon/illustration
- Title: "See Your Form Like a Pro"
- Subtitle: "Real-time AI analysis of your exercise form"

**Feature Cards (3 cards with icons)**

1. **🔍 Real-Time Analysis**
   - Icon: eye-outline
   - Text: "AI detects your body position instantly"
   - Benefit: Catch form issues before they become habits

2. **📊 Rep Counting**
   - Icon: fitness-outline  
   - Text: "Automatic rep and set counting"
   - Benefit: Focus on your workout, not counting

3. **🎯 Form Feedback**
   - Icon: bulp-outline
   - Text: "Instant cues for depth, angle, and technique"
   - Benefit: Improve faster with personalized feedback

**Privacy Section** (Critical - addresses user concerns)
- Icon: shield-checkmark-outline
- Title: "Your Privacy Matters"
- Points:
  - ✅ Video is analyzed in real-time, never stored
  - ✅ No cloud upload of your footage
  - ✅ You control when camera is active
  - ✅ All processing happens on your device

**Permission Button**
- Large, prominent button: "Enable Camera Access"
- Loading state while requesting permission
- Success state with checkmark
- Fallback: "Allow in Settings" if denied

**Skip/Later Option**
- "Not now" button for users who want to explore first
- Note: "You can enable camera access later in Settings"

### 1.3 Permission Logic

```typescript
// Import camera permissions
import * as Permissions from 'expo-camera';

const requestCameraPermission = async () => {
  const { status } = await Permissions.requestCameraPermissions();
  return status === 'granted';
};

// Check permission status
const checkCameraPermission = async () => {
  const { status } = await Permissions.getCameraPermissionsStatus();
  return status;
};
```

### 1.4 Complete Screen Code

```typescript
import { Ionicons } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import {
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
  const safeBack = useSafeBack('/(tabs)');
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
```

---

## Phase 2: Usage Onboarding Screen (`arkit-usage.tsx`)

### 2.1 Screen Structure

**Header**
- Back button (navigates back to permissions)
- Title: "Get Started"
- Progress indicator (Step 2 of 2)

**Section 1: How It Works**
- Animated illustration or screenshot placeholder
- Title: "How Form Tracking Works"
- Steps:
  1. Position phone 3-6 feet away
  2. Make sure your whole body is visible
  3. Start your workout
  4. Get real-time form feedback

**Section 2: Setup Tips** (Grid layout)

**A. Camera Positioning**
- Icon:-aperture-outline or camera-outline
- Title: "Phone Position"
- Tips:
  - 📱 Place phone 3-6 feet away (arm's length)
  - 📐 Angle camera to see your full body
  - 🔒 Secure phone (tripod, stand, or propped up)
  - ☀️ Good lighting helps accuracy

**B. Exercise Setup**
- Icon: fitness-outline
- Title: "Exercise Setup"
- Tips:
  - 🎯 Stay within the camera frame
  - 🔄 Face the camera for best results
  - 📏 Keep full body visible
  - ⏱️ Wait for detection before starting

**Section 3: Supported Exercises**
- Title: "Supported Exercises"
- Grid of exercise icons with names:
  - 🏋️ Pull-ups
  - 💪 Push-ups  
  - 🦵 Squats
  - 🪑 And more coming soon...

**Section 4: Safety Tips**
- Icon: medical-outline
- Title: "Safety First"
- Warning cards:
  - ⚠️ Use mirrors for safety, don't rely solely on phone
  - ⚠️ Clear area of obstacles
  - ⚠️ Start with lighter weights
  - ⚠️ Listen to your body

**Section 5: Troubleshooting**
- Title: "Troubleshooting"
- Accordion or expandable sections:
  - "Camera not detecting me" → Move to better lighting, adjust position
  - "Form cues not showing" → Make sure full body is visible
  - "App running slow" → Close other apps, restart Form Factor
  - "Accuracy issues" → Ensure good lighting, try different angle

**Action Button**
- "Start Your First Workout"
- Navigates to ARKit scan screen: `/(tabs)/scan-arkit`
- Or "Skip to Dashboard" → `/(tabs)`

### 2.2 Complete Screen Code

```typescript
import { Ionicons } from '@expo/vector-icons';
import React, { useState, useRef } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/use-safe-back';
import { isIOS } from '@/lib/platform-utils';

interface TipCardProps {
  icon: string;
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
  const safeBack = useSafeBack();
  const insets = useSafeAreaInsets();
  const isiOS = isIOS();
  
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
  }, [fadeAnim, slideAnim]);

  const handleGetStarted = () => {
    router.replace('/(tabs)/scan-arkit');
  };

  const handleSkip = () => {
    router.replace('/(tabs)');
  };

  const setupTips = [
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
              Let's get you set up for successful form tracking with your camera.
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
                    Use mirrors for safety - don't rely solely on your phone
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
```

---

## Phase 3: Navigation Logic Updates

### 3.1 Update `app/_layout.tsx`

Add ARKit onboarding check to the navigation logic:

```typescript
// Add these imports
import { useARKitOnboarding } from '@/contexts/ARKitOnboardingContext';

// In the RootLayoutNav component, add state
const { hasCompletedARKitOnboarding, loading: arkitLoading } = useARKitOnboarding();

// Add to the useEffect navigation logic
useEffect(() => {
  // ... existing logic ...
  
  // Check ARKit onboarding
  if (user && goals && !hasCompletedARKitOnboarding && !inOnboardingGroup && !inModalsGroup) {
    logWithTs('[Layout] ARKit onboarding not completed, redirecting to permissions');
    router.replace('/(onboarding)/arkit-permissions');
    return;
  }
  
  // ... rest of existing logic ...
}, [user, loading, goalsLoading, goals, hasCompletedARKitOnboarding, arkitLoading, /* ... other deps */]);
```

### 3.2 Create ARKit Onboarding Context

```typescript
// contexts/ARKitOnboardingContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ARKIT_ONBOARDING_KEY = 'ff.arkitOnboardingCompleted';

interface ARKitOnboardingContextValue {
  hasCompletedARKitOnboarding: boolean;
  completeARKitOnboarding: () => Promise<void>;
  resetARKitOnboarding: () => Promise<void>;
}

const ARKitOnboardingContext = createContext<ARKitOnboardingContextValue | null>(null);

export function ARKitOnboardingProvider({ children }: { children: React.ReactNode }) {
  const [hasCompletedARKitOnboarding, setHasCompleted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if ARKit onboarding has been completed
    const checkOnboardingStatus = async () => {
      try {
        const status = await AsyncStorage.getItem(ARKIT_ONBOARDING_KEY);
        setHasCompleted(status === 'true');
      } catch (error) {
        console.error('Error checking ARKit onboarding status:', error);
      } finally {
        setLoading(false);
      }
    };

    checkOnboardingStatus();
  }, []);

  const completeARKitOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ARKIT_ONBOARDING_KEY, 'true');
      setHasCompleted(true);
    } catch (error) {
      console.error('Error completing ARKit onboarding:', error);
    }
  };

  const resetARKitOnboarding = async () => {
    try {
      await AsyncStorage.removeItem(ARKIT_ONBOARDING_KEY);
      setHasCompleted(false);
    } catch (error) {
      console.error('Error resetting ARKit onboarding:', error);
    }
  };

  return (
    <ARKitOnboardingContext.Provider 
      value={{ hasCompletedARKitOnboarding, completeARKitOnboarding, resetARKitOnboarding }}
    >
      {children}
    </ARKitOnboardingContext.Provider>
  );
}

export function useARKitOnboarding() {
  const context = useContext(ARKitOnboardingContext);
  if (!context) {
    throw new Error('useARKitOnboarding must be used within an ARKitOnboardingProvider');
  }
  return context;
}
```

### 3.3 Update `_layout.tsx` to Include Provider

Add the provider to the app wrapper:

```typescript
// In app/_layout.tsx, wrap the app with the provider
import { ARKitOnboardingProvider } from '../contexts/ARKitOnboardingContext';

// In RootLayoutNav return statement:
return (
  <ARKitOnboardingProvider>
    <HealthKitProvider>
      {/* existing providers */}
      <Slot />
    </HealthKitProvider>
  </ARKitOnboardingProvider>
);
```

---

## Phase 4: Integration with Existing ARKit Screen

### 4.1 Update `app/(tabs)/scan-arkit.tsx`

Add permission check and redirect if not completed:

```typescript
import { useARKitOnboarding } from '@/contexts/ARKitOnboardingContext';

export default function ScanARKitScreen() {
  // ... existing code ...
  
  const { hasCompletedARKitOnboarding } = useARKitOnboarding();
  const router = useRouter();
  
  // Check onboarding status on mount
  useEffect(() => {
    if (!hasCompletedARKitOnboarding) {
      // Redirect to onboarding if not completed
      router.replace('/(onboarding)/arkit-permissions');
      return;
    }
    
    // Check camera permissions
    checkCameraPermissions();
  }, [hasCompletedARKitOnboarding]);
  
  // ... rest of existing code ...
}
```

### 4.2 Complete Onboarding After First Session

In the ARKit screen, call `completeARKitOnboarding()` after the user successfully completes their first workout:

```typescript
// After successful workout completion
const handleWorkoutComplete = async () => {
  // ... existing completion logic ...
  
  // Mark onboarding as completed
  completeARKitOnboarding();
};
```

---

## Phase 5: Testing Plan

### 5.1 Manual Testing Checklist

**Permission Screen:**
- [ ] Screen displays correctly on iOS and Android
- [ ] All animations work smoothly
- [ ] Feature cards are informative
- [ ] Privacy section builds trust
- [ ] Permission request triggers system dialog
- [ ] Success state redirects to usage screen
- [ ] Denied state shows helpful fallback
- [ ] Skip button works correctly

**Usage Screen:**
- [ ] Screen displays correctly
- [ ] Setup tips are expandable/collapsible
- [ ] Exercise grid shows all exercises
- [ ] Safety tips are prominent
- [ ] Troubleshooting items are helpful
- [ ] "Start Workout" button navigates correctly
- [ ] "Skip to Dashboard" button works

**Navigation:**
- [ ] Back buttons work correctly
- [ ] Progress indicator shows correct step
- [ ] Permission denied users can access settings
- [ ] Completed onboarding doesn't show again
- [ ] Reset functionality works (for testing)

### 5.2 Edge Cases to Test

- Permission already granted → Should skip to usage screen
- Permission denied → Should show settings button
- Camera unavailable → Should handle gracefully
- First-time user flow → All screens show in order
- Returning user → Should go directly to scan screen
- Network issues → Shouldn't affect local permission flow

---

## Phase 6: Success Metrics

### 6.1 Quantitative Metrics

- **Permission Grant Rate:** Target 80%+ (industry average is 60-70%)
- **Onboarding Completion Rate:** Target 90%+ of users who start
- **Feature Adoption:** Track % of users who try ARKit after onboarding
- **Time to First Workout:** Target <2 minutes from app launch

### 6.2 Qualitative Metrics

- User feedback on onboarding clarity
- Support ticket reduction for "how to use camera" questions
- App store rating improvements
- User interviews on onboarding experience

---

## Dependencies & Requirements

### 6.1 Package Dependencies
- `expo-camera` - For camera permissions (verify in package.json)
- `@react-native-async-storage/async-storage` - Already installed

### 6.2 iOS Configuration
Verify `Info.plist` has:
```xml
<key>NSCameraUsageDescription</key>
<string>Form Factor needs camera access to analyze your exercise form in real-time. Video is processed locally and never stored.</string>
```

### 6.3 Android Configuration  
Verify `app.json` or `app.config.ts` has:
```typescript
{
  "android": {
    "permissions": ["CAMERA"]
  }
}
```

---

## Implementation Timeline

### Day 1: Permission Screen
- [ ] Create `arkit-permissions.tsx` 
- [ ] Implement camera permission logic
- [ ] Add animations and styling
- [ ] Test permission flow

### Day 2: Usage Screen  
- [ ] Create `arkit-usage.tsx`
- [ ] Implement setup tips and exercises
- [ ] Add safety and troubleshooting sections
- [ ] Test navigation between screens

### Day 3: Integration & Polish
- [ ] Create `ARKitOnboardingContext`
- [ ] Update `_layout.tsx` navigation logic
- [ ] Integrate with existing ARKit scan screen
- [ ] End-to-end testing
- [ ] Fix any bugs
- [ ] Documentation

---

## Files Created/Modified

### New Files
1. `app/(onboarding)/arkit-permissions.tsx` - Camera permission screen
2. `app/(onboarding)/arkit-usage.tsx` - Usage guidance screen
3. `contexts/ARKitOnboardingContext.tsx` - Onboarding state management

### Modified Files
1. `app/_layout.tsx` - Add navigation logic and context provider
2. `app/(tabs)/scan-arkit.tsx` - Add permission check and redirect
3. `app.config.ts` or `app.json` - Add camera permissions (if needed)

### Documentation
- Update `docs/ONBOARDING_ISSUES.md` - Mark ARKit items as in progress

---

## Risk Mitigation

### 6.1 Technical Risks
- **Camera permission API changes:** Test on both iOS and Android
- **Performance issues:** Optimize animations, test on older devices
- **Navigation edge cases:** Thorough testing of all paths

### 6.2 User Experience Risks
- **Permission fatigue:** Clear value proposition before asking
- **Too much information:** Keep tips concise and scannable
- **Safety concerns:** Prominent safety messaging

---

## Next Steps After Implementation

1. **A/B Testing:** Test different permission request flows
2. **Analytics:** Track completion rates and drop-off points
3. **Iterate:** Improve based on user feedback
4. **Expand:** Apply pattern to other permission flows (HealthKit, Notifications)

---

**Plan created:** 2026-01-21  
**Ready for:** Implementation  
**Estimated completion:** 2-3 days
