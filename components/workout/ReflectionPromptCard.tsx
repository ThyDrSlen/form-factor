/**
 * ReflectionPromptCard Component
 *
 * Renders a single reflection prompt with its category tag. Visual
 * weight is intentionally light — the goal is a gentle nudge, not a
 * dense card.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/styles/workout-session.styles';
import type { ReflectionCategory, ReflectionPrompt } from '@/lib/services/between-sets-coach';

interface ReflectionPromptCardProps {
  prompt: ReflectionPrompt;
}

const CATEGORY_LABEL: Record<ReflectionCategory, string> = {
  form: 'Form',
  breathing: 'Breath',
  mindset: 'Focus',
  progress: 'Progress',
};

const CATEGORY_COLOR: Record<ReflectionCategory, string> = {
  form: colors.accent,
  breathing: colors.restActive,
  mindset: colors.warmup,
  progress: colors.success,
};

function ReflectionPromptCard({ prompt }: ReflectionPromptCardProps) {
  const tint = CATEGORY_COLOR[prompt.category];

  return (
    <View style={[styles.card, { borderLeftColor: tint }]} testID="reflection-prompt-card">
      <View style={styles.header}>
        <View style={[styles.tag, { borderColor: tint }]}>
          <Text style={[styles.tagText, { color: tint }]}>
            {CATEGORY_LABEL[prompt.category]}
          </Text>
        </View>
      </View>
      <Text style={styles.text} testID="reflection-prompt-text">
        {prompt.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardSurface,
    borderColor: colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
  },
  tag: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tagText: {
    fontFamily: 'Lexend_500Medium',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  text: {
    fontFamily: 'Lexend_500Medium',
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },
});

export default React.memo(ReflectionPromptCard);
