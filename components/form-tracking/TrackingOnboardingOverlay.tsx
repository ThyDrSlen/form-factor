/**
 * TrackingOnboardingOverlay
 *
 * First-use, in-session onboarding panel shown on top of the ARKit
 * scan overlay. Explains in plain terms:
 *   - What body tracking does
 *   - How to position the camera for best results
 *   - How to interpret the color-coded FQI + cues
 *
 * Persists the dismissal once via AsyncStorage so returning users do
 * not see it again. The storage key is exported for consumers/tests.
 *
 * This component is self-contained: it reads + writes AsyncStorage on
 * its own via an effect. Callers only need to mount it; it returns
 * null automatically once dismissed (or on hydration failures).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, AnimatePresence } from 'moti';

export const FORM_TRACKING_ONBOARDING_DISMISSED_KEY =
  'formTrackingOnboardingDismissedV1';

export interface TrackingOnboardingOverlayProps {
  /**
   * Force the overlay visible (bypassing AsyncStorage). Useful for a
   * "Show onboarding again" settings action.
   */
  forceVisible?: boolean;
  /**
   * Called after the user dismisses the overlay.
   */
  onDismissed?: () => void;
  /** Optional style override (typically safe-area padding). */
  style?: StyleProp<ViewStyle>;
  /** Optional testID for component tests. */
  testID?: string;
}

type Status = 'hydrating' | 'hidden' | 'visible';

const STEPS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'videocam-outline',
    title: 'Camera setup',
    body: 'Place your phone 6-10 ft away at roughly waist height so your whole body stays in frame.',
  },
  {
    icon: 'body-outline',
    title: 'What we track',
    body: 'We detect your joints in real time to measure reps, range of motion, and tempo.',
  },
  {
    icon: 'speedometer-outline',
    title: 'Reading the FQI',
    body: 'The ring shows your live Form Quality Index — green is great, yellow is okay, red means focus on the cue.',
  },
  {
    icon: 'alert-circle-outline',
    title: 'Color-coded cues',
    body: 'Red = fix now · Orange = next rep · Yellow = coaching tip.',
  },
];

export default function TrackingOnboardingOverlay({
  forceVisible = false,
  onDismissed,
  style,
  testID,
}: TrackingOnboardingOverlayProps) {
  const [status, setStatus] = useState<Status>(forceVisible ? 'visible' : 'hydrating');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (forceVisible) {
      setStatus('visible');
      return;
    }

    (async () => {
      try {
        const value = await AsyncStorage.getItem(FORM_TRACKING_ONBOARDING_DISMISSED_KEY);
        if (cancelled) return;
        setStatus(value === 'true' ? 'hidden' : 'visible');
      } catch {
        // On hydration failure, default to hidden so we never block the
        // camera view forever.
        if (!cancelled) setStatus('hidden');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [forceVisible]);

  const dismiss = useCallback(async () => {
    setStatus('hidden');
    onDismissed?.();
    try {
      await AsyncStorage.setItem(FORM_TRACKING_ONBOARDING_DISMISSED_KEY, 'true');
    } catch {
      // Swallow — dismissal still applies for this session.
    }
  }, [onDismissed]);

  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), []);

  return (
    <AnimatePresence>
      {status === 'visible' ? (
        <MotiView
          key="tracking-onboarding"
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: 12 }}
          transition={{ type: 'timing', duration: 260 }}
          style={[styles.container, style]}
          accessible
          accessibilityRole="summary"
          accessibilityLabel="Form tracking onboarding"
          testID={testID ?? 'tracking-onboarding'}
        >
          <View style={styles.header}>
            <View style={styles.headerIconBubble}>
              <Ionicons name="information-outline" size={16} color="#0B0F1A" />
            </View>
            <Text style={styles.title}>Get the most out of form tracking</Text>
            <TouchableOpacity
              onPress={toggleCollapse}
              accessibilityRole="button"
              accessibilityLabel={collapsed ? 'Expand onboarding' : 'Collapse onboarding'}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="tracking-onboarding-collapse"
            >
              <Ionicons
                name={collapsed ? 'chevron-down' : 'chevron-up'}
                size={18}
                color="#F5F7FF"
              />
            </TouchableOpacity>
          </View>

          {!collapsed ? (
            <>
              <View style={styles.steps}>
                {STEPS.map((step) => (
                  <View key={step.title} style={styles.step}>
                    <View style={styles.stepIconBubble}>
                      <Ionicons name={step.icon} size={16} color="#4C8CFF" />
                    </View>
                    <View style={styles.stepBody}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepText}>{step.body}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={styles.dismissButton}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel="Got it, don't show again"
                testID="tracking-onboarding-dismiss"
              >
                <Text style={styles.dismissText}>Got it</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </MotiView>
      ) : null}
    </AnimatePresence>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(10, 20, 38, 0.96)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.38)',
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFC244',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  steps: {
    gap: 10,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(76, 140, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBody: {
    flex: 1,
  },
  stepTitle: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  stepText: {
    color: '#BCCFE8',
    fontSize: 12,
    lineHeight: 17,
  },
  dismissButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#4C8CFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  dismissText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
