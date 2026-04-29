import React, { useCallback } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TodayFqiCard } from '@/components/form-home/TodayFqiCard';
import { WeeklyTrendChart } from '@/components/form-home/WeeklyTrendChart';
import { FaultHeatmapThumb } from '@/components/form-home/FaultHeatmapThumb';
import { StartSessionCta } from '@/components/form-home/StartSessionCta';
import { NutritionFormCorrelationCard } from '@/components/form-home/NutritionFormCorrelationCard';
import { RecoveryFormCorrelationCard } from '@/components/form-home/RecoveryFormCorrelationCard';
import { FormHomeSkeleton } from '@/components/form-home/FormHomeSkeleton';
import { useFormHomeData } from '@/hooks/use-form-home-data';
import { useNutritionFormInsights } from '@/hooks/use-nutrition-form-insights';

/**
 * Form home tab (issue #470).
 *
 * Composition only — all data/math/render logic lives in the dedicated
 * hooks + components. This screen stays cheap so it can be loaded as
 * soon as the user opens the tab bar.
 */
export default function FormHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const formHome = useFormHomeData();
  const insights = useNutritionFormInsights();

  const handleTodayPress = useCallback(() => {
    if (formHome.data.lastSessionId) {
      router.push(
        `/(modals)/workout-insights?sessionId=${formHome.data.lastSessionId}`,
      );
    }
  }, [router, formHome.data.lastSessionId]);

  const handleFaultHeatmapPress = useCallback(() => {
    router.push('/(modals)/fault-heatmap');
  }, [router]);

  const onRefresh = useCallback(async () => {
    await Promise.all([formHome.refresh(), insights.refresh()]);
  }, [formHome, insights]);

  const refreshing = formHome.loading || insights.loading;

  // A6: render skeleton placeholders on the first load (loading + no cache
  // hit yet) so the surface doesn't reflow when real data arrives. We
  // detect first-load by loading=true AND all data buckets empty.
  const isFirstLoadEmpty =
    formHome.data.trend.length === 0 &&
    formHome.data.faultCells.length === 0 &&
    formHome.data.lastSessionId === null &&
    formHome.data.todaySetCount === 0 &&
    formHome.data.todayBestFqi === null &&
    formHome.data.todayAvgFqi === null;
  const showSkeleton = formHome.loading && isFirstLoadEmpty && !formHome.error;

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#4C8CFF"
          />
        }
      >
        <Text style={styles.heading}>Form</Text>
        <Text style={styles.subheading}>
          Your daily form quality, weekly trend, and nutrition/recovery correlations.
        </Text>

        {formHome.error ? (
          <View style={styles.errorBanner} testID="form-home-error">
            <Text style={styles.errorText}>
              Could not load form data: {formHome.error.message}
            </Text>
            <TouchableOpacity
              onPress={() => {
                void formHome.refresh();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading form data"
              accessibilityHint="Double-tap to reload your form metrics"
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {showSkeleton ? (
          <FormHomeSkeleton />
        ) : (
          <>
            <TodayFqiCard
              bestFqi={formHome.data.todayBestFqi}
              avgFqi={formHome.data.todayAvgFqi}
              setCount={formHome.data.todaySetCount}
              loading={formHome.loading}
              onPress={formHome.data.lastSessionId ? handleTodayPress : undefined}
            />

            <WeeklyTrendChart
              data={formHome.data.trend}
              p90={formHome.data.p90}
              allTimeAvg={formHome.data.allTimeAvg}
            />

            <FaultHeatmapThumb
              cells={formHome.data.faultCells}
              days={formHome.data.faultDays.length > 0 ? formHome.data.faultDays : ['-', '-', '-', '-', '-', '-', '-']}
              onPress={handleFaultHeatmapPress}
            />

            <StartSessionCta />

            <NutritionFormCorrelationCard
              data={insights.nutrition}
              loading={insights.loading}
            />

            <RecoveryFormCorrelationCard
              data={insights.recovery}
              loading={insights.loading}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  heading: {
    color: '#F5F7FF',
    fontSize: 26,
    fontWeight: '700',
  },
  subheading: {
    color: '#97A3C2',
    fontSize: 14,
    marginBottom: 4,
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 92, 92, 0.18)',
    borderColor: '#FF5C5C',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    color: '#F5F7FF',
    fontSize: 13,
    flex: 1,
  },
  retryButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  retryText: {
    color: '#4C8CFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
