/**
 * ProgressionPlanModal
 *
 * Post-session modal that shows the lifter:
 *   - Estimated 1RM for the selected exercise
 *   - PR chips for the most recent set (1RM / 3RM / 5RM / volume)
 *   - A Gemma-generated progressive overload plan (via coach-service)
 *   - A suggested working weight for the next session with an Accept CTA
 *
 * Launched via `router.push({ pathname: '/(modals)/progression-plan', params })`
 * with at minimum `exercise` as a param; `userId` is read from AuthContext.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import {
  getExerciseHistorySummary,
  type ExerciseHistorySummary,
} from '@/lib/services/exercise-history-service';
import { isProgressionPlanEnabled } from '@/lib/services/progression-flags';
import {
  generateProgressionPlan,
  type ProgressionPlan,
} from '@/lib/services/progression-planner';
import { suggestWeight, type WeightSuggestion } from '@/lib/services/weight-suggester';
import type { PrResult } from '@/lib/services/pr-detector-overload';
import { ProgressionPlanView } from '@/components/ProgressionPlanView';

const BG = '#050E1F';
const PANEL = '#0E1A2E';
const ACCENT = '#4C8CFF';
const TEXT_PRIMARY = '#F8F9FF';
const TEXT_SECONDARY = '#8E9BAD';
const SUCCESS = '#3CC8A9';

function prCategoryLabel(category: PrResult['category']): string {
  switch (category) {
    case 'one_rep_max':
      return '1RM';
    case 'three_rep_max':
      return '3RM';
    case 'five_rep_max':
      return '5RM';
    case 'volume':
    default:
      return 'Volume';
  }
}

export default function ProgressionPlanModal() {
  const router = useRouter();
  const { user } = useAuth();
  const { show: showToast } = useToast();
  const params = useLocalSearchParams<{ exercise?: string; horizonWeeks?: string }>();
  const exercise = typeof params.exercise === 'string' && params.exercise.length > 0
    ? params.exercise
    : 'Bench Press';
  const horizonWeeks = useMemo(() => {
    const raw = Number.parseInt(params.horizonWeeks ?? '', 10);
    if (!Number.isFinite(raw) || raw <= 0) return 3;
    return Math.min(12, Math.max(1, raw));
  }, [params.horizonWeeks]);

  const [summary, setSummary] = useState<ExerciseHistorySummary | null>(null);
  const [suggestion, setSuggestion] = useState<WeightSuggestion | null>(null);
  const [plan, setPlan] = useState<ProgressionPlan | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [planLoading, setPlanLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedWeight, setAcceptedWeight] = useState<number | null>(null);

  // EXPO_PUBLIC_PROGRESSION_PLAN gate (#475). When off, the modal renders a
  // lightweight disabled-state — keeps deep links from crashing the bundler
  // and doesn't touch the coach-service / local-db while the feature is dark.
  const planEnabled = isProgressionPlanEnabled();

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const userId = user?.id ?? 'local-user';
      const result = await getExerciseHistorySummary({ userId, exerciseNameOrId: exercise });
      setSummary(result);
      const suggestion = suggestWeight({
        history: result.sets.map((s) => ({
          weight: s.weight,
          reps: s.reps,
          date: s.date,
        })),
      });
      setSuggestion(suggestion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history.');
    } finally {
      setLoading(false);
    }
  }, [exercise, user?.id]);

  const loadPlan = useCallback(
    async (history: ExerciseHistorySummary) => {
      setPlanLoading(true);
      try {
        const userId = user?.id ?? 'local-user';
        const result = await generateProgressionPlan({
          userId,
          exercise,
          summary: history,
          horizonWeeks,
        });
        setPlan(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Coach is temporarily unavailable.';
        showToast(message, { type: 'error' });
      } finally {
        setPlanLoading(false);
      }
    },
    [exercise, horizonWeeks, showToast, user?.id],
  );

  useEffect(() => {
    if (!planEnabled) {
      setLoading(false);
      return;
    }
    loadSummary();
  }, [loadSummary, planEnabled]);

  useEffect(() => {
    if (!planEnabled) return;
    if (summary && summary.sets.length > 0) {
      loadPlan(summary);
    }
  }, [summary, loadPlan, planEnabled]);

  const triggeredPrs = useMemo(
    () => (summary?.prData ?? []).filter((p) => p.isPr),
    [summary],
  );

  const handleAcceptWeight = useCallback(() => {
    if (!suggestion || suggestion.suggestedWeight <= 0) return;
    setAcceptedWeight(suggestion.suggestedWeight);
    showToast(
      `Logged target of ${suggestion.suggestedWeight} for your next ${exercise} session.`,
      { type: 'success' },
    );
  }, [exercise, showToast, suggestion]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel="Close progression plan"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={24} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {exercise}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      {!planEnabled ? (
        <View
          style={styles.loadingPanel}
          accessibilityRole="summary"
          testID="progression-plan-disabled"
        >
          <Ionicons name="construct" size={40} color={TEXT_SECONDARY} />
          <Text style={styles.loadingText}>
            Progression planner is turned off. Enable it with
            EXPO_PUBLIC_PROGRESSION_PLAN=on to preview.
          </Text>
        </View>
      ) : loading ? (
        <View
          style={styles.loadingPanel}
          accessibilityRole="alert"
          accessibilityLabel="Analyzing your history"
          testID="progression-plan-loading"
        >
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.loadingText}>Analyzing your history…</Text>
        </View>
      ) : error ? (
        <View style={styles.errorPanel}>
          <Ionicons name="alert-circle" size={40} color="#EF4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={loadSummary}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statsCard}>
            <Text style={styles.sectionLabel}>Estimated 1RM</Text>
            <Text style={styles.statsValue}>
              {summary?.estimatedOneRepMax ? `${summary.estimatedOneRepMax}` : '—'}
            </Text>
            <Text style={styles.sectionSub}>
              {summary?.lastSession
                ? `Last set ${summary.lastSession.weight} × ${summary.lastSession.reps} on ${summary.lastSession.date}`
                : 'No sets logged yet for this exercise.'}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>PR summary</Text>
          {triggeredPrs.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardBody}>No new PRs in this window — good time to drive overload.</Text>
            </View>
          ) : (
            <View style={styles.chipRow}>
              {triggeredPrs.map((pr) => (
                <View key={pr.category} style={styles.chip}>
                  <Ionicons name="trophy" size={14} color={SUCCESS} />
                  <Text style={styles.chipText}>{prCategoryLabel(pr.category)}</Text>
                  <Text style={styles.chipValue}>{Math.round(pr.current)}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>Suggested next weight</Text>
          <View style={styles.suggestionCard}>
            <Text style={styles.suggestionValue}>
              {suggestion?.suggestedWeight ? suggestion.suggestedWeight : '—'}
            </Text>
            <Text style={styles.suggestionReason}>
              {suggestion?.reasoning ?? 'No suggestion yet.'}
            </Text>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (!suggestion || suggestion.suggestedWeight <= 0) && styles.primaryButtonDisabled,
              ]}
              disabled={!suggestion || suggestion.suggestedWeight <= 0}
              onPress={handleAcceptWeight}
              accessibilityLabel="Accept suggested weight for the next session"
            >
              <Text style={styles.primaryButtonText}>
                {acceptedWeight !== null
                  ? `Accepted ${acceptedWeight}`
                  : 'Accept weight for next session'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Progression plan ({horizonWeeks} weeks)</Text>
          <View style={styles.card}>
            {planLoading ? (
              <View style={styles.planLoading}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={styles.loadingText}>Asking the coach…</Text>
              </View>
            ) : plan ? (
              <ProgressionPlanView
                source={plan.text}
                textColor={TEXT_PRIMARY}
                mutedColor={TEXT_SECONDARY}
                accentColor={ACCENT}
              />
            ) : (
              <Text style={styles.cardBody}>
                The coach service is unavailable — your suggested weight above still applies.
              </Text>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  statsCard: {
    backgroundColor: PANEL,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  statsValue: {
    fontSize: 40,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 8,
  },
  sectionSub: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    marginTop: 8,
  },
  card: {
    backgroundColor: PANEL,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  cardBody: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(60,200,169,0.12)',
  },
  chipText: {
    fontSize: 12,
    color: SUCCESS,
    fontWeight: '600',
  },
  chipValue: {
    fontSize: 12,
    color: TEXT_PRIMARY,
    fontWeight: '600',
  },
  suggestionCard: {
    backgroundColor: PANEL,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  suggestionValue: {
    fontSize: 34,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  suggestionReason: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    marginBottom: 16,
    marginTop: 6,
  },
  primaryButton: {
    backgroundColor: ACCENT,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    color: TEXT_PRIMARY,
    fontWeight: '600',
    fontSize: 15,
  },
  loadingPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: TEXT_SECONDARY,
    fontSize: 14,
  },
  errorPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  errorText: {
    color: TEXT_SECONDARY,
    textAlign: 'center',
  },
  planText: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    lineHeight: 22,
  },
  planLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
