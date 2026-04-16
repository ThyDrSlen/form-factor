/**
 * AutoDebriefCard
 *
 * Post-session card that renders the auto-authored Gemma/OpenAI debrief.
 * Four visual states, in priority order:
 *   1. loading  -> skeleton shimmer lines
 *   2. error    -> error summary + "Try again" CTA
 *   3. data     -> shaped brief + provider icon badge
 *   4. empty    -> collapsed "No debrief yet" placeholder
 *
 * Intentionally stateless: drives from props so the owning screen (this
 * PR does NOT mount the card — #456 wires the debrief screen) can decide
 * when to render it.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AutoDebriefResult, CoachProvider } from '@/lib/services/coach-auto-debrief';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AutoDebriefCardProps {
  loading: boolean;
  error: string | null;
  data: AutoDebriefResult | null;
  onRetry?: () => void;
  /**
   * Optional testID prefix so consumers can target sub-elements without
   * the card hardcoding its own name into the tree.
   */
  testIDPrefix?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerLabel(p: CoachProvider): string {
  switch (p) {
    case 'gemma':
      return 'Gemma';
    case 'openai':
    default:
      return 'OpenAI';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AutoDebriefCard({
  loading,
  error,
  data,
  onRetry,
  testIDPrefix = 'auto-debrief',
}: AutoDebriefCardProps) {
  if (loading) {
    return (
      <View
        testID={`${testIDPrefix}-loading`}
        accessibilityRole="alert"
        accessibilityLabel="Coach is preparing your session debrief"
        style={styles.card}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Session debrief</Text>
          <ActivityIndicator size="small" />
        </View>
        <View style={[styles.skeleton, { width: '80%' }]} />
        <View style={[styles.skeleton, { width: '95%' }]} />
        <View style={[styles.skeleton, { width: '70%' }]} />
      </View>
    );
  }

  if (error) {
    return (
      <View
        testID={`${testIDPrefix}-error`}
        accessibilityRole="alert"
        accessibilityLabel={`Failed to load debrief: ${error}`}
        style={[styles.card, styles.errorCard]}
      >
        <Text style={styles.title}>Session debrief</Text>
        <Text style={styles.errorMessage}>Couldn’t load your debrief. {error}</Text>
        {onRetry ? (
          <TouchableOpacity
            testID={`${testIDPrefix}-retry`}
            accessibilityRole="button"
            accessibilityLabel="Retry loading the debrief"
            onPress={onRetry}
            style={styles.retryButton}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (!data) {
    return (
      <View testID={`${testIDPrefix}-empty`} style={styles.card}>
        <Text style={styles.title}>Session debrief</Text>
        <Text style={styles.empty}>No debrief yet. Finish a session to generate one.</Text>
      </View>
    );
  }

  return (
    <View
      testID={`${testIDPrefix}-result`}
      accessibilityRole="summary"
      accessibilityLabel={`Coach debrief from ${providerLabel(data.provider)}`}
      style={styles.card}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Session debrief</Text>
        <View style={styles.providerBadge} testID={`${testIDPrefix}-provider`}>
          <Text style={styles.providerBadgeText}>{providerLabel(data.provider)}</Text>
        </View>
      </View>
      <Text style={styles.brief} testID={`${testIDPrefix}-brief`}>
        {data.brief}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles — minimal, keeps this PR invisible-pipe. Rehomed to the shared
// debrief styles module once #456 lands its screen + tokens.
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    gap: 8,
  },
  errorCard: {
    backgroundColor: '#3F1D1D',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '700',
  },
  empty: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  skeleton: {
    height: 12,
    borderRadius: 4,
    backgroundColor: '#374151',
    marginTop: 8,
  },
  brief: {
    color: '#E5E7EB',
    fontSize: 14,
    lineHeight: 22,
  },
  providerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#374151',
    borderRadius: 8,
  },
  providerBadgeText: {
    color: '#F9FAFB',
    fontSize: 12,
    fontWeight: '600',
  },
  errorMessage: {
    color: '#FCA5A5',
    fontSize: 14,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#2563EB',
    borderRadius: 8,
  },
  retryLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
