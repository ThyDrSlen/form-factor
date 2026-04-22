/**
 * Form Tracking Debrief
 *
 * Full-screen scrollable recap of a completed form-tracking session. Expects
 * the following route params (all strings because they come from the URL):
 *   exerciseName    — e.g. "Squat"
 *   durationSeconds — numeric string, e.g. "245"
 *   reps            — JSON-encoded RepSummary[]
 *
 * Renders: header -> session highlight pair -> rep-by-rep breakdown -> pinned
 * "Ask coach" CTA. scan-arkit.tsx is intentionally untouched; wiring the live
 * tracker to navigate here is a follow-up.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  RepBreakdownList,
  type RepSummary,
} from '@/components/form-tracking/RepBreakdownList';
import { SessionHighlightCard } from '@/components/form-tracking/SessionHighlightCard';
import { AskCoachCTA } from '@/components/form-tracking/AskCoachCTA';
import AutoDebriefCard from '@/components/form-tracking/AutoDebriefCard';
import { FqiExplainerModal } from '@/components/form-tracking/FqiExplainerModal';
import { SessionCompareToLastCard } from '@/components/form-tracking/SessionCompareToLastCard';
import { resolveExerciseKey } from '@/lib/services/form-session-history-lookup';
import { useAutoDebrief } from '@/hooks/use-auto-debrief';
import { useSessionComparisonQuery } from '@/hooks/use-session-comparison';
import { supabase } from '@/lib/supabase';
import { isCoachPipelineV2Enabled } from '@/lib/services/coach-pipeline-v2-flag';

function safeParseReps(raw: string | undefined): RepSummary[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (rep): rep is RepSummary =>
          rep != null &&
          typeof rep === 'object' &&
          typeof (rep as { index: unknown }).index === 'number' &&
          typeof (rep as { fqi: unknown }).fqi === 'number' &&
          Array.isArray((rep as { faults: unknown }).faults),
      )
      .map((rep) => ({
        index: rep.index,
        fqi: rep.fqi,
        faults: rep.faults.filter((f): f is string => typeof f === 'string'),
      }));
  } catch {
    return [];
  }
}

function coerceDuration(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function computeAverageFqi(reps: RepSummary[]): number | null {
  if (reps.length === 0) return null;
  const total = reps.reduce((acc, rep) => acc + rep.fqi, 0);
  return total / reps.length;
}

function pickBestAndWorst(reps: RepSummary[]): {
  best?: RepSummary;
  worst?: RepSummary;
} {
  if (reps.length === 0) return {};
  const sorted = [...reps].sort((a, b) => b.fqi - a.fqi);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (sorted.length === 1 || best.index === worst.index) {
    return { best };
  }
  return { best, worst };
}

export default function FormTrackingDebriefScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    // Resolve the current user lazily via supabase.auth.getSession() rather
    // than via AuthContext so this screen stays test-friendly (AuthContext
    // pulls expo-linking at import time, which the existing debrief test
    // suite's module graph doesn't set up). supabase itself is already
    // globally mocked in tests so this is a no-op there.
    //
    // We additionally subscribe to onAuthStateChange so the comparison query
    // re-fires when the auth session resolves or changes after mount.
    // Without this, a debrief opened before getSession() settles would latch
    // onto the initial `null` userId and never re-query once auth is ready.
    let cancelled = false;
    const applyUserId = (next: string | null) => {
      if (cancelled) return;
      setUserId((prev) => (prev === next ? prev : next));
    };

    void supabase.auth
      .getSession()
      .then(({ data }) => applyUserId(data.session?.user.id ?? null))
      .catch(() => applyUserId(null));

    // Guard the call in case a stripped-down test mock omits the listener.
    const subscription = supabase.auth.onAuthStateChange?.((_event, session) => {
      applyUserId(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      subscription?.data?.subscription?.unsubscribe?.();
    };
  }, []);
  const params = useLocalSearchParams<{
    exerciseName?: string;
    durationSeconds?: string;
    reps?: string;
    /**
     * Optional: when passed, the debrief hydrates a "Compare to last
     * session" card by calling the session-comparison aggregator. Recap
     * routes fired from the legacy in-session path omit this param and
     * the card simply does not render.
     */
    sessionId?: string;
  }>();

  const exerciseName = params.exerciseName?.trim() ? params.exerciseName : 'Session recap';
  const durationSeconds = coerceDuration(params.durationSeconds);
  const reps = useMemo(() => safeParseReps(params.reps), [params.reps]);
  const averageFqi = useMemo(() => computeAverageFqi(reps), [reps]);
  const { best, worst } = useMemo(() => pickBestAndWorst(reps), [reps]);
  const topFault = worst?.faults[0] ?? null;
  const routeSessionId = useMemo(() => {
    const raw = params.sessionId;
    if (!raw || typeof raw !== 'string') return null;
    return raw.trim() || null;
  }, [params.sessionId]);
  const comparisonExerciseId = useMemo(
    () => resolveExerciseKey(exerciseName),
    [exerciseName],
  );
  const {
    comparison,
    loading: comparisonLoading,
    error: comparisonError,
    reload: reloadComparison,
  } = useSessionComparisonQuery({
    currentSessionId: routeSessionId,
    exerciseId: comparisonExerciseId,
    userId,
  });
  const handleOpenComparison = useCallback(() => {
    if (!comparison?.priorSessionId || !comparisonExerciseId || !routeSessionId) return;
    const qs = new URLSearchParams({
      sessionId: routeSessionId,
      exerciseId: comparisonExerciseId,
      priorSessionId: comparison.priorSessionId,
    }).toString();
    router.push(`/(modals)/form-comparison?${qs}` as `/${string}`);
    // Depend on the whole `comparison` object, not a projected field, so the
    // callback always closes over the freshest shape (new priorSessionId,
    // swapped exercise, etc.) and can't be stranded on a stale snapshot
    // when the comparison reloads mid-screen.
  }, [router, comparison, comparisonExerciseId, routeSessionId]);

  // Pipeline v2: synthesize a stable sessionId from the recap payload so the
  // auto-debrief hook can dedupe via AsyncStorage. We derive from exercise
  // name + rep count + first-rep fqi (deterministic; no UUID dep).
  const pipelineV2 = isCoachPipelineV2Enabled();
  const sessionId = useMemo(() => {
    if (!pipelineV2 || reps.length === 0) return null;
    return `debrief:${exerciseName}:${reps.length}:${Math.round((reps[0]?.fqi ?? 0) * 100)}`;
  }, [pipelineV2, exerciseName, reps]);

  const buildInput = useCallback(async () => {
    // form-tracking-debrief never fires session_finished directly, but we
    // still provide a valid builder for the hook contract. Returning null
    // is a safe no-op when the modal is viewed without a session event.
    return null;
  }, []);

  const autoDebrief = useAutoDebrief({
    buildInput,
    sessionId: pipelineV2 ? sessionId : null,
  });

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const [explainerVisible, setExplainerVisible] = useState(false);
  const handleOpenExplainer = useCallback(() => setExplainerVisible(true), []);
  const handleCloseExplainer = useCallback(() => setExplainerVisible(false), []);
  const explainerExerciseId = useMemo(
    () => resolveExerciseKey(exerciseName) ?? undefined,
    [exerciseName],
  );

  const hasReps = reps.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} testID="form-tracking-debrief">
      <View style={styles.topBar}>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close debrief"
          style={styles.closeButton}
          testID="form-tracking-debrief-close"
        >
          <Ionicons name="close" size={24} color="#F5F7FF" />
        </Pressable>
        <Text style={styles.topBarTitle}>Session debrief</Text>
        <View style={styles.closeButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header} testID="form-tracking-debrief-header">
          <Text style={styles.exerciseName} testID="form-tracking-debrief-exercise">
            {exerciseName}
          </Text>
          <View style={styles.statRow}>
            <Stat
              testID="form-tracking-debrief-duration"
              label="Duration"
              value={formatDuration(durationSeconds)}
            />
            <Stat
              testID="form-tracking-debrief-rep-count"
              label="Reps"
              value={String(reps.length)}
            />
            <Stat
              testID="form-tracking-debrief-average-fqi"
              label="Avg FQI"
              value={averageFqi != null ? String(Math.round(averageFqi)) : '–'}
            />
          </View>
          {averageFqi != null ? (
            <Pressable
              onPress={handleOpenExplainer}
              accessibilityRole="button"
              accessibilityLabel="What does this score mean?"
              accessibilityHint="Tap to learn what this score means"
              style={({ pressed }) => [styles.explainerChip, pressed && styles.explainerChipPressed]}
              testID="form-tracking-debrief-fqi-explainer-chip"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="information-circle-outline" size={14} color="#9AACD1" />
              <Text style={styles.explainerChipText}>What does this score mean?</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.sectionGap}>
          <Text style={styles.sectionTitle}>Highlights</Text>
          <SessionHighlightCard best={best} worst={worst} />
        </View>

        <View style={styles.sectionGap}>
          <Text style={styles.sectionTitle}>Rep breakdown</Text>
          {hasReps ? (
            <RepBreakdownList reps={reps} />
          ) : (
            <View style={styles.emptyState} testID="form-tracking-debrief-empty">
              <Ionicons name="information-circle-outline" size={28} color="#9AACD1" />
              <Text style={styles.emptyTitle}>No reps recorded yet</Text>
              <Text style={styles.emptyBody}>
                Start a live tracking set to see your breakdown.
              </Text>
            </View>
          )}
        </View>

        {comparisonLoading || comparisonError || comparison?.priorSessionId ? (
          <View style={styles.sectionGap} testID="form-tracking-debrief-compare-section">
            <Text style={styles.sectionTitle}>Progress</Text>
            <SessionCompareToLastCard
              comparison={comparison}
              loading={comparisonLoading}
              error={comparisonError}
              onRetry={reloadComparison}
              onPress={comparison?.priorSessionId ? handleOpenComparison : undefined}
              testID="form-tracking-debrief-compare-card"
            />
          </View>
        ) : null}

        {pipelineV2 ? (
          <View style={styles.sectionGap} testID="form-tracking-debrief-auto-section">
            <Text style={styles.sectionTitle}>Coach debrief</Text>
            <AutoDebriefCard
              loading={autoDebrief.loading}
              error={autoDebrief.error}
              data={autoDebrief.data}
              onRetry={autoDebrief.retry}
              // Reps in the URL params indicate the user just finished a
              // session (recap route), so we want the friendly "preparing
              // your feedback…" copy in the empty grace window — NOT the
              // cold "No debrief yet" history placeholder.
              awaitingResult={hasReps}
            />
          </View>
        ) : null}

        <View style={styles.footerSpacer} />
      </ScrollView>

      <AskCoachCTA
        exerciseName={exerciseName}
        repCount={reps.length}
        averageFqi={averageFqi}
        topFault={topFault}
      />

      <FqiExplainerModal
        visible={explainerVisible}
        onDismiss={handleCloseExplainer}
        exerciseId={explainerExerciseId}
        testID="form-tracking-debrief-fqi-explainer"
      />
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#C9D7F4',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  header: {
    backgroundColor: '#0F2339',
    borderRadius: 20,
    padding: 18,
    gap: 16,
    marginBottom: 20,
  },
  exerciseName: {
    color: '#F5F7FF',
    fontSize: 24,
    fontWeight: '700',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    color: '#F5F7FF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  statLabel: {
    color: '#9AACD1',
    fontSize: 12,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  explainerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(154, 172, 209, 0.3)',
    backgroundColor: 'rgba(154, 172, 209, 0.06)',
  },
  explainerChipPressed: {
    backgroundColor: 'rgba(154, 172, 209, 0.16)',
  },
  explainerChipText: {
    color: '#9AACD1',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  sectionGap: {
    marginBottom: 20,
    gap: 10,
  },
  sectionTitle: {
    color: '#C9D7F4',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 24,
    backgroundColor: '#0F2339',
    borderRadius: 18,
  },
  emptyTitle: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyBody: {
    color: '#9AACD1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 260,
  },
  footerSpacer: {
    height: 24,
  },
});
