import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FaultHeatmapThumb, type FaultCell } from '@/components/form-home/FaultHeatmapThumb';
import {
  loadFaultHeatmapData,
  type FaultHeatmapSnapshot,
} from '@/lib/services/fault-heatmap-data-loader';
import {
  explainDrill,
  type DrillFaultInput,
  type ExplainDrillResult,
} from '@/lib/services/coach-drill-explainer';
import { usePersistentFaultSummary } from '@/hooks/use-persistent-fault-summary';

interface HeatmapDataState {
  cells: FaultCell[];
  days: string[];
  loading: boolean;
  error: Error | null;
  lastSessionId: string | null;
}

type DrillCardState =
  | { status: 'loading' }
  | { status: 'ready'; explanation: string; provider: string }
  | { status: 'error'; message: string };

function fallbackDays(now: Date): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }
  return days;
}

/**
 * Build a minimal drill-request payload for a single persistent fault.
 * The drill fields are generic placeholders — we don't have a concrete
 * drill attached to the fault here; the model just needs something to
 * anchor the explanation around the fault itself. Keeps the prompt
 * well-formed without pretending we've selected a specific exercise.
 */
function buildDrillPayloadForFault(fault: DrillFaultInput) {
  return {
    drillTitle: 'Targeted form drill',
    drillCategory: 'technique',
    drillWhy: `Address persistent ${fault.displayName ?? fault.code} over the last 7 days.`,
    exerciseId: 'form-tracking',
    faults: [fault],
  };
}

/**
 * Internal hook that binds `loadFaultHeatmapData` to the modal. Kept
 * module-local so the modal owns its lifecycle — if another surface
 * later wants this data, it should pull from `use-persistent-fault-summary`
 * instead, which layers aggregation + gating on top.
 */
function useHeatmapData(): HeatmapDataState & { refresh: () => void } {
  const [state, setState] = useState<HeatmapDataState>(() => ({
    cells: [],
    days: fallbackDays(new Date()),
    loading: true,
    error: null,
    lastSessionId: null,
  }));

  const run = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const snapshot: FaultHeatmapSnapshot = await loadFaultHeatmapData();
      setState({
        cells: snapshot.cells,
        days: snapshot.days,
        loading: false,
        error: null,
        lastSessionId: snapshot.lastSessionId,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err : new Error('Fault heatmap load failed'),
      }));
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return { ...state, refresh: () => void run() };
}

/**
 * Full-screen fault heatmap modal (issue #470).
 *
 * Loads the real 7-day fault aggregation via `fault-heatmap-data-loader`.
 * The loader returns an empty snapshot (not an error) when the user
 * has no form-tracking reps in the horizon, so the empty-state copy
 * from `FaultHeatmapThumb` stays the natural fallback.
 *
 * When `EXPO_PUBLIC_FAULT_DRILL_GEMMA` is on AND the user has >=1
 * persistent fault, an "Ask Gemma for drills" CTA renders below the
 * heatmap. Tapping fans `coach-drill-explainer.explainDrill` out to
 * each top fault and expands an inline section with the returned
 * drill rationales.
 */
export default function FaultHeatmapModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cells, days, loading, error, refresh } = useHeatmapData();
  const {
    topFaults,
    enabled: drillFlagEnabled,
    loading: drillLoading,
  } = usePersistentFaultSummary();

  const [drillResults, setDrillResults] = useState<Record<string, DrillCardState>>({});
  const [drillFetchInFlight, setDrillFetchInFlight] = useState(false);

  const displayDays = useMemo(
    () => (days.length > 0 ? days : fallbackDays(new Date())),
    [days],
  );

  const handleAskGemma = useCallback(async () => {
    if (!drillFlagEnabled || topFaults.length === 0 || drillFetchInFlight) return;
    setDrillFetchInFlight(true);

    const seeded: Record<string, DrillCardState> = {};
    for (const fault of topFaults) seeded[fault.code] = { status: 'loading' };
    setDrillResults(seeded);

    const settled = await Promise.all(
      topFaults.map(async (fault): Promise<[string, DrillCardState]> => {
        try {
          const result: ExplainDrillResult = await explainDrill(buildDrillPayloadForFault(fault));
          if (result.error || !result.explanation) {
            return [fault.code, { status: 'error', message: result.error ?? 'Empty response' }];
          }
          return [
            fault.code,
            { status: 'ready', explanation: result.explanation, provider: result.provider },
          ];
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return [fault.code, { status: 'error', message }];
        }
      }),
    );

    setDrillResults(Object.fromEntries(settled));
    setDrillFetchInFlight(false);
  }, [drillFlagEnabled, topFaults, drillFetchInFlight]);

  const showDrillCta = drillFlagEnabled && !drillLoading && topFaults.length > 0;
  const hasAnyDrillResult = Object.keys(drillResults).length > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close fault heatmap"
          onPress={() => router.back()}
          style={styles.closeButton}
          testID="fault-heatmap-close"
        >
          <Ionicons name="close" size={22} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.title}>Fault heatmap</Text>
        <View style={styles.closeButton} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.centerBlock} testID="fault-heatmap-loading">
            <ActivityIndicator color="#4C8CFF" />
            <Text style={styles.loadingLabel}>Loading your faults…</Text>
          </View>
        ) : error ? (
          <View style={styles.centerBlock} testID="fault-heatmap-error">
            <Text style={styles.errorLabel}>Couldn’t load your faults.</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry loading fault heatmap"
              onPress={refresh}
              style={styles.retryButton}
              testID="fault-heatmap-retry"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FaultHeatmapThumb cells={cells} days={displayDays} />
        )}

        {showDrillCta && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Ask Gemma for drills targeting your top faults"
            onPress={handleAskGemma}
            disabled={drillFetchInFlight}
            style={[styles.ctaButton, drillFetchInFlight && styles.ctaButtonBusy]}
            testID="fault-heatmap-ask-gemma"
          >
            {drillFetchInFlight ? (
              <ActivityIndicator color="#F5F7FF" />
            ) : (
              <>
                <Ionicons name="sparkles" size={16} color="#F5F7FF" />
                <Text style={styles.ctaText}>
                  {hasAnyDrillResult ? 'Ask Gemma again' : 'Ask Gemma for drills'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {hasAnyDrillResult && (
          <View style={styles.drillSheet} testID="fault-heatmap-drill-sheet">
            <Text style={styles.drillSheetTitle}>Drill rationales</Text>
            {topFaults.map((fault) => {
              const card = drillResults[fault.code];
              return (
                <View
                  key={fault.code}
                  style={styles.drillCard}
                  testID={`fault-heatmap-drill-${fault.code}`}
                >
                  <Text style={styles.drillCardTitle}>
                    {fault.displayName ?? fault.code} · {fault.count}×
                  </Text>
                  {!card || card.status === 'loading' ? (
                    <View style={styles.drillCardRow}>
                      <ActivityIndicator color="#4C8CFF" size="small" />
                      <Text style={styles.drillCardBody}>Finding a drill for you…</Text>
                    </View>
                  ) : card.status === 'error' ? (
                    <Text style={styles.drillCardError}>{card.message}</Text>
                  ) : (
                    <Text style={styles.drillCardBody}>{card.explanation}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.legendTitle}>How to read this</Text>
        <Text style={styles.legendBody}>
          Each row is one of your top three detected faults over the last
          seven days. Darker cells mean the fault fired more often on that
          day. Tap Start form session to work on your highest-fault pattern.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050E1F',
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#F5F7FF',
    fontSize: 17,
    fontWeight: '700',
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 40,
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 40,
  },
  loadingLabel: {
    color: '#97A3C2',
    fontSize: 13,
  },
  errorLabel: {
    color: '#FF6B6B',
    fontSize: 13,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4C8CFF',
  },
  retryText: {
    color: '#4C8CFF',
    fontSize: 13,
    fontWeight: '500',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#4C8CFF',
  },
  ctaButtonBusy: {
    opacity: 0.7,
  },
  ctaText: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '600',
  },
  drillSheet: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
  },
  drillSheetTitle: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  drillCard: {
    gap: 4,
    paddingVertical: 6,
  },
  drillCardTitle: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '600',
  },
  drillCardBody: {
    color: '#97A3C2',
    fontSize: 13,
    lineHeight: 18,
  },
  drillCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  drillCardError: {
    color: '#FF6B6B',
    fontSize: 12,
  },
  legendTitle: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '600',
  },
  legendBody: {
    color: '#97A3C2',
    fontSize: 13,
    lineHeight: 18,
  },
});
