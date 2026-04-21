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

interface HeatmapDataState {
  cells: FaultCell[];
  days: string[];
  loading: boolean;
  error: Error | null;
  lastSessionId: string | null;
}

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
 */
export default function FaultHeatmapModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cells, days, loading, error, refresh } = useHeatmapData();

  const displayDays = useMemo(
    () => (days.length > 0 ? days : fallbackDays(new Date())),
    [days],
  );

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
