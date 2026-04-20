/**
 * TrackingLossBanner
 *
 * Mid-session tracking-loss banner shown at the top of the ARKit overlay
 * when confidence has been poor for >500ms. Gives actionable guidance
 * (lighting, position, occlusion) and fades in/out via Moti.
 *
 * Pure presentational component — it does NOT subscribe to tracking
 * state. Callers use `useTrackingLoss` and pass `visible` down.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, AnimatePresence } from 'moti';

export interface TrackingLossBannerProps {
  /** Whether the banner should be visible. */
  visible: boolean;
  /** Optional number of milliseconds the tracking has been lost. Rendered as "Nxs". */
  lostForMs?: number | null;
  /** Optional action label + handler ("Recalibrate", "Dismiss"). */
  onDismiss?: () => void;
  /** Optional extra style (e.g., top offset below the top bar). */
  style?: StyleProp<ViewStyle>;
  /** Optional testID for component tests. */
  testID?: string;
}

function formatLostForMs(ms: number | null | undefined): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 1) return null;
  return `${seconds}s`;
}

export default function TrackingLossBanner({
  visible,
  lostForMs,
  onDismiss,
  style,
  testID,
}: TrackingLossBannerProps) {
  const duration = formatLostForMs(lostForMs ?? null);

  return (
    <AnimatePresence>
      {visible ? (
        <MotiView
          key="tracking-loss-banner"
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: -8 }}
          transition={{ type: 'timing', duration: 220 }}
          style={[styles.banner, style]}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={
            duration
              ? `Tracking signal lost for ${duration}. Check lighting and step fully into the camera frame.`
              : 'Tracking signal lost. Check lighting and step fully into the camera frame.'
          }
          testID={testID ?? 'tracking-loss-banner'}
        >
          <View style={styles.iconBubble}>
            <Ionicons name="warning-outline" size={18} color="#FFFFFF" />
          </View>
          <View style={styles.body}>
            <Text style={styles.title} accessibilityElementsHidden>
              Tracking signal lost
              {duration ? `  \u00B7  ${duration}` : ''}
            </Text>
            <Text style={styles.subtitle} accessibilityElementsHidden>
              Step fully into frame and check lighting.
            </Text>
          </View>
          {onDismiss ? (
            <TouchableOpacity
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss tracking loss banner"
              style={styles.closeButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="tracking-loss-banner-dismiss"
            >
              <Ionicons name="close" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
        </MotiView>
      ) : null}
    </AnimatePresence>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(180, 30, 30, 0.94)',
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  body: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: '#FFE0DC',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  closeButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
});
