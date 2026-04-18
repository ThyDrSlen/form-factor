/**
 * Progression Suggestion Badge
 *
 * Small pill rendered near the add-set / next-weight UI that displays the
 * output of `progression-suggester.suggestNextWeight`. Purely presentational;
 * all logic lives in the service.
 *
 * Issue #447 W3-C item #3.
 */

import React from 'react';
import { StyleSheet, Text, View, Platform, Pressable } from 'react-native';
import type { Suggestion } from '@/lib/services/progression-suggester';

export interface ProgressionSuggestionBadgeProps {
  suggestion: Suggestion | null;
  /** Optional tap handler — e.g. to apply the suggestion to the next set. */
  onPress?: () => void;
  /** Accessibility hint for the tap action. */
  accessibilityHint?: string;
}

const PALETTE: Record<Suggestion['rationale'], { bg: string; border: string; fg: string; icon: string }> = {
  increment: { bg: '#0E2A1E', border: '#3DC884', fg: '#B8F0CF', icon: '⬆' },
  maintain: { bg: '#1A223A', border: '#4C8CFF', fg: '#CFE0FF', icon: '→' },
  deload: { bg: '#2A1A1A', border: '#F0B44A', fg: '#F5DFB6', icon: '⬇' },
};

export function ProgressionSuggestionBadge({
  suggestion,
  onPress,
  accessibilityHint,
}: ProgressionSuggestionBadgeProps): React.ReactElement | null {
  if (!suggestion) return null;
  const palette = PALETTE[suggestion.rationale];

  const content = (
    <View
      style={[styles.container, { backgroundColor: palette.bg, borderColor: palette.border }]}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={suggestion.reason}
      accessibilityHint={accessibilityHint}
      testID={`progression-badge-${suggestion.rationale}`}
    >
      <Text style={[styles.icon, { color: palette.fg }]}>{palette.icon}</Text>
      <Text style={[styles.reason, { color: palette.fg }]} numberOfLines={2}>
        {suggestion.reason}
      </Text>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed && Platform.OS !== 'web' ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    gap: 6,
    alignSelf: 'flex-start',
  },
  icon: {
    fontSize: 13,
    fontFamily: 'Lexend_700Bold',
  },
  reason: {
    fontSize: 12,
    fontFamily: 'Lexend_500Medium',
    flexShrink: 1,
  },
});

export default ProgressionSuggestionBadge;
