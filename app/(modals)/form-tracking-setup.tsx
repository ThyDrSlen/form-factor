/**
 * Form Tracking Setup Wizard
 *
 * Four-step full-screen modal that prepares a first-time user for the live
 * form-tracking screen. Steps:
 *   1. Intro      — explain what form tracking does and the privacy stance.
 *   2. Permission — request camera access (undetermined / denied / granted).
 *   3. Posture    — show a static framing placeholder.
 *   4. Ready      — confirm and enter the Scan tab via router.push.
 *
 * This route deliberately does NOT touch app/(tabs)/scan-arkit.tsx. Integration
 * (gating scan-arkit behind the wizard for first-time users) is a follow-up.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';

import { useFirstSessionCheck } from '@/hooks/use-first-session-check';
import { useToast } from '@/contexts/ToastContext';
import { openSystemSettings } from '@/lib/utils/open-external';

type WizardStep = 'intro' | 'permission' | 'posture' | 'ready';
const STEP_ORDER: WizardStep[] = ['intro', 'permission', 'posture', 'ready'];

const STEP_LABELS: Record<WizardStep, string> = {
  intro: 'Welcome',
  permission: 'Camera',
  posture: 'Framing',
  ready: 'Ready',
};

type PermissionState = 'undetermined' | 'granted' | 'denied';

function toPermissionState(
  status: string | null | undefined,
  granted: boolean | undefined,
): PermissionState {
  if (granted) return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export default function FormTrackingSetupScreen() {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [stepIndex, setStepIndex] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const { markSeen } = useFirstSessionCheck();
  const [permission, requestPermission] = useCameraPermissions();

  const step = STEP_ORDER[stepIndex];

  const permissionState: PermissionState = useMemo(
    () => toPermissionState(permission?.status, permission?.granted),
    [permission?.status, permission?.granted],
  );

  const goNext = useCallback(() => {
    setStepIndex((current) => Math.min(current + 1, STEP_ORDER.length - 1));
  }, []);

  const goBack = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleRequestPermission = useCallback(async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const response = await requestPermission();
      if (response.granted) {
        goNext();
      }
    } finally {
      setRequesting(false);
    }
  }, [requestPermission, requesting, goNext]);

  const handleOpenSettings = useCallback(() => {
    void openSystemSettings({
      onFallback: () => {
        showToast("Couldn't open Settings — enable Camera access from the Settings app.", {
          type: 'error',
        });
      },
    });
  }, [showToast]);

  const handleStart = useCallback(async () => {
    await markSeen();
    router.push('/(tabs)/scan-arkit');
  }, [markSeen, router]);

  return (
    <SafeAreaView style={styles.safeArea} testID="form-tracking-setup">
      <View style={styles.header}>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close setup"
          style={styles.closeButton}
          testID="form-tracking-setup-close"
        >
          <Ionicons name="close" size={24} color="#F5F7FF" />
        </Pressable>
        <Text style={styles.stepLabel} testID="form-tracking-setup-step-label">
          {`Step ${stepIndex + 1} of ${STEP_ORDER.length} — ${STEP_LABELS[step]}`}
        </Text>
        <View style={styles.closeButton} />
      </View>

      <View style={styles.progressRow} testID="form-tracking-setup-progress">
        {STEP_ORDER.map((key, i) => (
          <View
            key={key}
            style={[
              styles.progressDot,
              i === stepIndex && styles.progressDotActive,
              i < stepIndex && styles.progressDotCompleted,
            ]}
          />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID={`form-tracking-setup-step-${step}`}
      >
        {step === 'intro' ? (
          <IntroStep />
        ) : step === 'permission' ? (
          <PermissionStep
            permissionState={permissionState}
            requesting={requesting}
            onRequest={handleRequestPermission}
            onOpenSettings={handleOpenSettings}
          />
        ) : step === 'posture' ? (
          <PostureStep />
        ) : (
          <ReadyStep />
        )}
      </ScrollView>

      <View style={styles.footer}>
        {stepIndex > 0 ? (
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.secondaryButton}
            testID="form-tracking-setup-back"
          >
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
        ) : (
          <View style={styles.secondaryButtonPlaceholder} />
        )}

        {step === 'ready' ? (
          <Pressable
            onPress={handleStart}
            accessibilityRole="button"
            accessibilityLabel="Start form tracking"
            style={styles.primaryButton}
            testID="form-tracking-setup-start"
          >
            <Text style={styles.primaryButtonText}>Start</Text>
            <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
          </Pressable>
        ) : step === 'permission' && permissionState !== 'granted' ? (
          <View style={styles.primaryButtonPlaceholder} />
        ) : (
          <Pressable
            onPress={goNext}
            accessibilityRole="button"
            accessibilityLabel="Next"
            style={styles.primaryButton}
            testID="form-tracking-setup-next"
          >
            <Text style={styles.primaryButtonText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function IntroStep() {
  return (
    <View style={styles.stepBody}>
      <View style={styles.iconBadge}>
        <Ionicons name="videocam-outline" size={48} color="#4C8CFF" />
      </View>
      <Text style={styles.stepTitle}>Form tracking scores your reps</Text>
      <Text style={styles.stepSubtitle}>
        We analyze your movement on-device to give you real-time form feedback.
        No video leaves your device.
      </Text>
      <View style={styles.bulletList}>
        <Bullet text="Real-time rep counting and FQI scoring" />
        <Bullet text="Private by default — video never uploads" />
        <Bullet text="Works best with good light and your full body in frame" />
      </View>
    </View>
  );
}

function PermissionStep({
  permissionState,
  requesting,
  onRequest,
  onOpenSettings,
}: {
  permissionState: PermissionState;
  requesting: boolean;
  onRequest: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <View style={styles.stepBody}>
      <View style={styles.iconBadge}>
        <Ionicons name="camera-outline" size={48} color="#4C8CFF" />
      </View>
      <Text style={styles.stepTitle}>Camera access</Text>
      <Text style={styles.stepSubtitle}>
        Form tracking needs your camera so we can see your movement. Frames are
        processed on-device.
      </Text>

      {permissionState === 'granted' ? (
        <View
          style={[styles.statusCard, styles.statusGranted]}
          testID="form-tracking-setup-permission-granted"
        >
          <Ionicons name="checkmark-circle" size={22} color="#34C759" />
          <Text style={[styles.statusText, { color: '#34C759' }]}>
            Camera access granted — you&apos;re ready for the next step.
          </Text>
        </View>
      ) : permissionState === 'denied' ? (
        <View style={styles.permissionActions} testID="form-tracking-setup-permission-denied">
          <View style={[styles.statusCard, styles.statusDenied]}>
            <Ionicons name="close-circle" size={22} color="#FF4B4B" />
            <View style={styles.statusTextColumn}>
              <Text style={[styles.statusText, styles.statusTextDenied]}>
                Camera access is blocked
              </Text>
              <Text style={styles.statusSubtext}>
                Form tracking needs camera access. You can grant it in
                Settings, then come back to finish setup.
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Open Settings to grant camera access"
            accessibilityHint="Opens the iOS Settings app for this app so you can enable the camera permission"
            style={styles.primaryButton}
            testID="form-tracking-setup-open-settings"
          >
            <Ionicons name="settings-outline" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </Pressable>
          <Pressable
            onPress={onRequest}
            accessibilityRole="button"
            accessibilityLabel="Try requesting camera access again"
            style={styles.secondaryInlineButton}
            testID="form-tracking-setup-retry-permission"
          >
            <Ionicons name="refresh-outline" size={16} color="#C9D7F4" />
            <Text style={styles.secondaryInlineButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <View
          style={styles.permissionActions}
          testID="form-tracking-setup-permission-undetermined"
        >
          <View style={[styles.statusCard, styles.statusNeutral]}>
            <Ionicons name="alert-circle-outline" size={22} color="#9AACD1" />
            <Text style={styles.statusText}>
              We haven&apos;t asked for camera access yet.
            </Text>
          </View>
          <Pressable
            onPress={onRequest}
            accessibilityRole="button"
            accessibilityLabel="Enable camera"
            style={[styles.primaryButton, requesting && styles.primaryButtonDisabled]}
            disabled={requesting}
            testID="form-tracking-setup-request-permission"
          >
            <Ionicons name="camera" size={18} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>
              {requesting ? 'Requesting…' : 'Enable camera'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function PostureStep() {
  return (
    <View style={styles.stepBody}>
      {/* TODO(#449): swap this placeholder for the FramingGuide component landed in PR #449. */}
      <View style={styles.postureIllustration} testID="form-tracking-setup-posture-illustration">
        <View style={styles.postureFrameOuter}>
          <View style={styles.postureFrameInner}>
            <Ionicons name="body-outline" size={96} color="#4C8CFF" />
          </View>
          <Text style={styles.postureDistance}>3–4 ft back</Text>
        </View>
      </View>
      <Text style={styles.stepTitle}>Set up your angle</Text>
      <Text style={styles.stepSubtitle}>
        Prop your phone 3–4 feet back so your whole body fits in the frame with
        a bit of room on each side.
      </Text>
      <View style={styles.bulletList}>
        <Bullet text="Portrait orientation works best" />
        <Bullet text="Keep the camera at chest height" />
        <Bullet text="Make sure your feet and head are visible" />
      </View>
    </View>
  );
}

function ReadyStep() {
  return (
    <View style={styles.stepBody}>
      <View style={[styles.iconBadge, { backgroundColor: 'rgba(52, 199, 89, 0.12)' }]}>
        <Ionicons name="checkmark-circle-outline" size={56} color="#34C759" />
      </View>
      <Text style={styles.stepTitle}>You&apos;re ready</Text>
      <Text style={styles.stepSubtitle}>
        When you&apos;re in frame, tap Start to jump into live form tracking.
      </Text>
      <View style={styles.readyCard}>
        <Text style={styles.readyCardTitle}>Quick tip</Text>
        <Text style={styles.readyCardBody}>
          Your first few reps set a baseline. Move at your normal pace and don&apos;t
          rush the setup frame.
        </Text>
      </View>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  stepLabel: {
    flex: 1,
    color: '#C9D7F4',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 18,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1B2E4A',
  },
  progressDotActive: {
    width: 28,
    borderRadius: 4,
    backgroundColor: '#4C8CFF',
  },
  progressDotCompleted: {
    backgroundColor: '#4C8CFF',
    opacity: 0.5,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    flexGrow: 1,
  },
  stepBody: {
    flex: 1,
    alignItems: 'center',
    gap: 16,
  },
  iconBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(76, 140, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    color: '#F5F7FF',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  stepSubtitle: {
    color: '#9AACD1',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  bulletList: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4C8CFF',
    marginTop: 8,
  },
  bulletText: {
    color: '#C9D7F4',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    alignSelf: 'stretch',
  },
  statusGranted: {
    backgroundColor: 'rgba(52, 199, 89, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.4)',
  },
  statusDenied: {
    backgroundColor: 'rgba(255, 75, 75, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 75, 0.4)',
  },
  statusNeutral: {
    backgroundColor: '#0F2339',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  statusText: {
    flex: 1,
    color: '#C9D7F4',
    fontSize: 14,
    lineHeight: 20,
  },
  statusTextColumn: {
    flex: 1,
    gap: 4,
  },
  statusTextDenied: {
    color: '#FF8A8A',
    fontWeight: '700',
    fontSize: 14,
  },
  statusSubtext: {
    color: '#C9D7F4',
    fontSize: 13,
    lineHeight: 18,
  },
  secondaryInlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignSelf: 'center',
  },
  secondaryInlineButtonText: {
    color: '#C9D7F4',
    fontSize: 14,
    fontWeight: '600',
  },
  permissionActions: {
    alignSelf: 'stretch',
    gap: 12,
  },
  postureIllustration: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 12,
  },
  postureFrameOuter: {
    alignItems: 'center',
    gap: 8,
  },
  postureFrameInner: {
    width: 180,
    height: 240,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#4C8CFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 140, 255, 0.06)',
  },
  postureDistance: {
    color: '#9AACD1',
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  readyCard: {
    alignSelf: 'stretch',
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#0F2339',
    gap: 4,
  },
  readyCardTitle: {
    color: '#4C8CFF',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  readyCardBody: {
    color: '#C9D7F4',
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4C8CFF',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 14,
    minWidth: 140,
  },
  primaryButtonDisabled: {
    backgroundColor: '#2F4B66',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButtonPlaceholder: {
    minWidth: 140,
  },
  secondaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#0F2339',
  },
  secondaryButtonText: {
    color: '#C9D7F4',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButtonPlaceholder: {
    width: 90,
  },
});
