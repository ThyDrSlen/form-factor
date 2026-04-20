/**
 * VoiceCommandFeedback (#469)
 *
 * Small overlay pill shown in the scan tab when voice control is active.
 * Surfaces the current voice state (idle / listening / recognized /
 * unrecognized) with minimal chrome — the intent is to confirm the
 * system heard the user without distracting from the set.
 *
 * Behavior:
 *   - Not rendered when `useVoiceControlStore.enabled` is false.
 *   - Not rendered on 'idle' state.
 *   - Auto-fades after 2-4s on 'recognized'/'unrecognized' states.
 *   - Haptic medium impact on 'recognized'.
 *   - accessibilityLiveRegion="polite" so VoiceOver announces updates
 *     without interrupting.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useVoiceControlStore } from '@/lib/stores/voice-control-store';
import {
  useVoiceCommandFeedback,
  type VoiceFeedbackDisplayState,
} from '@/hooks/useVoiceCommandFeedback';
import { voiceSessionManager } from '@/lib/services/voice-session-manager';
import type { ClassifiedIntent } from '@/lib/services/voice-intent-classifier';

export interface VoiceCommandFeedbackProps {
  /**
   * The latest classified intent from the voice subsystem. When the
   * parent has no classifier wired up yet (overnight stub), pass null —
   * the component shows listening-only UI.
   */
  latestIntent?: ClassifiedIntent | null;
  /** Optional override for tests. */
  manager?: typeof voiceSessionManager;
}

const AUTO_DISMISS_MS_HIGH_CONF = 2000;
const AUTO_DISMISS_MS_LOW_CONF = 4000;

export function VoiceCommandFeedback({
  latestIntent = null,
  manager = voiceSessionManager,
}: VoiceCommandFeedbackProps) {
  const enabled = useVoiceControlStore((s) => s.enabled);
  const display = useVoiceCommandFeedback({ manager, latestIntent });
  const [autoDismissed, setAutoDismissed] = useState(false);

  // Haptic on recognition
  useEffect(() => {
    if (display.kind === 'recognized') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [display.kind]);

  // Auto-dismiss timer
  useEffect(() => {
    if (display.kind !== 'recognized' && display.kind !== 'unrecognized') {
      setAutoDismissed(false);
      return;
    }
    const duration =
      (display.confidence ?? 0) >= 0.85 ? AUTO_DISMISS_MS_HIGH_CONF : AUTO_DISMISS_MS_LOW_CONF;
    const timer = setTimeout(() => {
      setAutoDismissed(true);
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [display.kind, display.confidence]);

  // Reset auto-dismiss when display state changes
  useEffect(() => {
    setAutoDismissed(false);
  }, [display.kind, display.text]);

  if (!enabled) return null;
  if (display.kind === 'idle') return null;
  if (autoDismissed) return null;

  return (
    <View
      style={[styles.pill, pillStyleFor(display)]}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={labelFor(display)}
      testID="voice-command-feedback"
    >
      <Text style={styles.labelText} testID="voice-feedback-label">
        {labelFor(display)}
      </Text>
      {display.text ? (
        <Text style={styles.transcriptText} testID="voice-feedback-transcript">
          {display.text}
        </Text>
      ) : null}
    </View>
  );
}

function labelFor(state: VoiceFeedbackDisplayState): string {
  switch (state.kind) {
    case 'listening':
      return 'Listening…';
    case 'recognized':
      return 'Got it';
    case 'unrecognized':
      return "Didn't catch that";
    default:
      return '';
  }
}

function pillStyleFor(state: VoiceFeedbackDisplayState) {
  switch (state.kind) {
    case 'recognized':
      return styles.pillRecognized;
    case 'unrecognized':
      return styles.pillUnrecognized;
    case 'listening':
      return styles.pillListening;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 120,
  },
  pillListening: {
    backgroundColor: 'rgba(76, 140, 255, 0.9)',
  },
  pillRecognized: {
    backgroundColor: 'rgba(60, 200, 169, 0.95)',
  },
  pillUnrecognized: {
    backgroundColor: 'rgba(255, 184, 76, 0.95)',
  },
  labelText: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '600',
  },
  transcriptText: {
    color: '#F5F7FF',
    fontSize: 12,
    marginTop: 2,
  },
});
