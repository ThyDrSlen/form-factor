/**
 * VoiceMuteButton (wave-30 A16).
 *
 * Small pill in the top-right corner of the scan overlay that lets a user
 * mute coach voice cues without opening settings. Subtitle surfaces the
 * latest voice provider (e.g. "Coach • gemma") or the muted state
 * ("Coach • Muted") so the user can see at a glance where audio is
 * routed.
 *
 * Pure UI — the owning screen passes the current state and toggle.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface VoiceMuteButtonProps {
  /** True when coach voice cues are currently muted. */
  muted: boolean;
  /** Latest voice provider label (e.g. "gemma", "openai"). Null hides it. */
  provider?: string | null;
  /** Called when the user toggles the mute state. */
  onToggle: () => void;
  /** Optional testID. Defaults to `voice-mute-button`. */
  testID?: string;
  /** Visual style — 'overlay' floats in absolute position, 'inline' flows. */
  variant?: 'overlay' | 'inline';
}

export function VoiceMuteButton({
  muted,
  provider,
  onToggle,
  testID = 'voice-mute-button',
  variant = 'overlay',
}: VoiceMuteButtonProps) {
  const subtitle = muted ? 'Muted' : provider ?? 'Coach';
  const accessibilityLabel = muted
    ? 'Coach voice is muted. Tap to unmute.'
    : `Coach voice active${provider ? ` via ${provider}` : ''}. Tap to mute.`;

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityState={{ selected: muted }}
      accessibilityLabel={accessibilityLabel}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.base,
        variant === 'overlay' ? styles.overlay : styles.inline,
        muted ? styles.muted : styles.active,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <Ionicons
        name={muted ? 'volume-mute' : 'volume-high'}
        size={14}
        color={muted ? '#F4A261' : '#F5F7FF'}
      />
      <View style={styles.textCol}>
        <Text style={styles.topLabel}>Coach</Text>
        <Text
          style={[styles.subLabel, muted ? styles.subLabelMuted : null]}
          testID={`${testID}-subtitle`}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  overlay: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 140,
    backgroundColor: 'rgba(11, 24, 40, 0.85)',
  },
  inline: {
    backgroundColor: 'rgba(11, 24, 40, 0.65)',
  },
  active: {
    borderColor: 'rgba(76, 140, 255, 0.6)',
  },
  muted: {
    borderColor: 'rgba(244, 162, 97, 0.6)',
  },
  pressed: {
    opacity: 0.75,
  },
  textCol: {
    alignItems: 'flex-start',
  },
  topLabel: {
    color: '#C9D7F4',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  subLabel: {
    color: '#F5F7FF',
    fontSize: 11,
    fontWeight: '600',
  },
  subLabelMuted: {
    color: '#F4A261',
  },
});

export default VoiceMuteButton;
