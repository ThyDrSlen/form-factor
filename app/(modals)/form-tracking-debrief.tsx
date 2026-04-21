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

import React, { useCallback, useMemo } from 'react';
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
import { useAutoDebrief } from '@/hooks/use-auto-debrief';
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
  const params = useLocalSearchParams<{
    exerciseName?: string;
    durationSeconds?: string;
    reps?: string;
  }>();

  const exerciseName = params.exerciseName?.trim() ? params.exerciseName : 'Session recap';
  const durationSeconds = coerceDuration(params.durationSeconds);
  const reps = useMemo(() => safeParseReps(params.reps), [params.reps]);
  const averageFqi = useMemo(() => computeAverageFqi(reps), [reps]);
  const { best, worst } = useMemo(() => pickBestAndWorst(reps), [reps]);
  const topFault = worst?.faults[0] ?? null;

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
              <Text style={styles.emptyTitle}>No reps recorded</Text>
              <Text style={styles.emptyBody}>
                Finish a live tracking set to see your rep-by-rep breakdown here.
              </Text>
            </View>
          )}
        </View>

        {pipelineV2 ? (
          <View style={styles.sectionGap} testID="form-tracking-debrief-auto-section">
            <Text style={styles.sectionTitle}>Coach debrief</Text>
            <AutoDebriefCard
              loading={autoDebrief.loading}
              error={autoDebrief.error}
              data={autoDebrief.data}
              onRetry={autoDebrief.retry}
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
