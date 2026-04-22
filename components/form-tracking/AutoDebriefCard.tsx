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

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AutoDebriefResult, CoachProvider } from '@/lib/services/coach-auto-debrief';

/**
 * Upper bound on raw error strings that reach the user-visible card. Error
 * copy from the coach pipeline can be verbose (stack traces, provider
 * payloads); we truncate to keep the card compact and avoid layout blowups.
 */
export const AUTO_DEBRIEF_ERROR_MAX_CHARS = 120;

function truncateError(raw: string, max: number = AUTO_DEBRIEF_ERROR_MAX_CHARS): string {
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Grace window for the "Coach is preparing your feedback…" empty copy.
 * After a session ends we may sit in the `data === null && !loading && !error`
 * window briefly (event bus fanout, buildInput async). During that grace we
 * want a friendly "we're on it" line rather than the cold "No debrief yet"
 * placeholder. After the window elapses, we fall back to the history copy.
 */
export const AUTO_DEBRIEF_EMPTY_GRACE_MS = 30_000;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AutoDebriefCardProps {
  loading: boolean;
  error: string | null;
  data: AutoDebriefResult | null;
  onRetry?: () => void;
  /**
   * Optional dismiss handler for the error state. When provided, the error
   * card renders an X button in the top-right that calls this callback.
   * Absent → no dismiss affordance (hosting screen opts in explicitly).
   */
  onDismissError?: () => void;
  /**
   * True when the parent considers the user "fresh off a session" — e.g.
   * the debrief screen was opened right after session end. Signals the card
   * to show the reassuring "Coach is preparing your feedback…" copy instead
   * of the cold "No debrief yet" placeholder for up to 30s.
   */
  awaitingResult?: boolean;
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
  onDismissError,
  awaitingResult = false,
  testIDPrefix = 'auto-debrief',
}: AutoDebriefCardProps) {
  // Track whether we are still within the awaiting-grace window. Starts true
  // when `awaitingResult` is first seen and flips to false after the grace
  // timeout — at which point the card falls back to the history empty copy.
  const [inGrace, setInGrace] = useState(awaitingResult);
  useEffect(() => {
    if (!awaitingResult) {
      setInGrace(false);
      return;
    }
    setInGrace(true);
    const handle = setTimeout(() => setInGrace(false), AUTO_DEBRIEF_EMPTY_GRACE_MS);
    return () => clearTimeout(handle);
  }, [awaitingResult]);

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
          <PulsingDot />
        </View>
        <View style={[styles.skeleton, { width: '80%' }]} />
        <View style={[styles.skeleton, { width: '95%' }]} />
        <View style={[styles.skeleton, { width: '70%' }]} />
      </View>
    );
  }

  if (error) {
    const displayedError = truncateError(error);
    return (
      <View
        testID={`${testIDPrefix}-error`}
        accessibilityRole="alert"
        accessibilityLabel={`Failed to load debrief: ${displayedError}`}
        style={[styles.card, styles.errorCard]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Session debrief</Text>
          {onDismissError ? (
            <TouchableOpacity
              testID={`${testIDPrefix}-dismiss-error`}
              accessibilityRole="button"
              accessibilityLabel="Dismiss debrief error"
              onPress={onDismissError}
              style={styles.dismissButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={16} color="#FCA5A5" />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.errorMessage}>Couldn’t load your debrief. {displayedError}</Text>
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
    if (inGrace) {
      return (
        <View
          testID={`${testIDPrefix}-preparing`}
          accessibilityRole="alert"
          accessibilityLabel="Coach is preparing your feedback"
          style={styles.card}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Session debrief</Text>
            <PulsingDot />
          </View>
          <Text style={styles.empty}>Coach is preparing your feedback…</Text>
        </View>
      );
    }
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
// Helpers
// ---------------------------------------------------------------------------

function PulsingDot() {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.pulsingDot, { opacity }]}
    />
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
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#60A5FA',
  },
  dismissButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(252, 165, 165, 0.12)',
  },
});
