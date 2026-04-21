/**
 * VoiceControlBanner (#wave24-voice)
 *
 * Small status indicator that surfaces the current voice-control state
 * (listening / processing / hidden). Placement is the caller's choice —
 * the banner is flag-unaware but guards internally against being rendered
 * outside a mounted VoiceControlProvider (pipelineDisabled short-circuits).
 *
 * Visual language mirrors TrackingLossBanner: Moti fade-in, icon bubble +
 * body text, rounded pill. Muted blue when listening, amber when
 * processing (matches the VoiceCommandFeedback pill colors).
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, AnimatePresence } from 'moti';
import { useVoiceControl } from '@/contexts/VoiceControlContext';

export interface VoiceControlBannerProps {
  /** Extra style override (e.g. top inset for a screen header). */
  style?: StyleProp<ViewStyle>;
  /** Override the testID. */
  testID?: string;
}

type BannerKind = 'listening' | 'processing' | 'consent-required' | 'hidden';

function classifyBanner(state: ReturnType<typeof useVoiceControl>): BannerKind {
  if (state.pipelineDisabled) return 'hidden';
  if (state.consentRequired) return 'consent-required';
  // "processing" — we just classified an intent this tick but haven't reset.
  if (state.latestIntent && state.latestIntent.intent !== 'none') {
    return 'processing';
  }
  if (state.isListening) return 'listening';
  return 'hidden';
}

function iconFor(kind: BannerKind): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case 'listening':
      return 'mic';
    case 'processing':
      return 'sync';
    case 'consent-required':
      return 'lock-closed-outline';
    default:
      return 'mic-off';
  }
}

function labelFor(kind: BannerKind): string {
  switch (kind) {
    case 'listening':
      return 'Listening';
    case 'processing':
      return 'Processing';
    case 'consent-required':
      return 'Voice control off';
    default:
      return '';
  }
}

function subtitleFor(
  kind: BannerKind,
  state: ReturnType<typeof useVoiceControl>,
): string {
  if (kind === 'processing' && state.latestIntent) {
    return `Heard: ${state.latestIntent.normalized}`;
  }
  if (kind === 'listening') {
    return 'Say "hey form" followed by a command.';
  }
  if (kind === 'consent-required') {
    return 'Enable in settings to use hands-free control.';
  }
  return '';
}

export function VoiceControlBanner({ style, testID }: VoiceControlBannerProps) {
  const state = useVoiceControl();
  const kind = classifyBanner(state);
  const visible = kind !== 'hidden';

  return (
    <AnimatePresence>
      {visible ? (
        <MotiView
          key={`voice-banner-${kind}`}
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: -6 }}
          transition={{ type: 'timing', duration: 200 }}
          style={[styles.banner, bannerStyleFor(kind), style]}
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${labelFor(kind)}. ${subtitleFor(kind, state)}`}
          testID={testID ?? `voice-control-banner-${kind}`}
        >
          <View style={styles.iconBubble}>
            <Ionicons name={iconFor(kind)} size={16} color="#FFFFFF" />
          </View>
          <View style={styles.body}>
            <Text style={styles.title} accessibilityElementsHidden>
              {labelFor(kind)}
            </Text>
            <Text style={styles.subtitle} accessibilityElementsHidden>
              {subtitleFor(kind, state)}
            </Text>
          </View>
        </MotiView>
      ) : null}
    </AnimatePresence>
  );
}

function bannerStyleFor(kind: BannerKind): StyleProp<ViewStyle> {
  switch (kind) {
    case 'listening':
      return styles.bannerListening;
    case 'processing':
      return styles.bannerProcessing;
    case 'consent-required':
      return styles.bannerConsent;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bannerListening: {
    backgroundColor: 'rgba(76, 140, 255, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(76, 140, 255, 0.5)',
  },
  bannerProcessing: {
    backgroundColor: 'rgba(255, 184, 76, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 184, 76, 0.5)',
  },
  bannerConsent: {
    backgroundColor: 'rgba(30, 41, 64, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  iconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
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
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
});

export default VoiceControlBanner;
