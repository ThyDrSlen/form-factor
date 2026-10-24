import React, { useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TodayFqiCard } from '@/features/form-tracking/components/home/TodayFqiCard';
import { WeeklyTrendChart } from '@/features/form-tracking/components/home/WeeklyTrendChart';
import { FaultHeatmapThumb } from '@/features/form-tracking/components/home/FaultHeatmapThumb';
import { StartSessionCta } from '@/features/form-tracking/components/home/StartSessionCta';
import { NutritionFormCorrelationCard } from '@/features/form-tracking/components/home/NutritionFormCorrelationCard';
import { RecoveryFormCorrelationCard } from '@/features/form-tracking/components/home/RecoveryFormCorrelationCard';
import { FormHomeSkeleton } from '@/features/form-tracking/components/home/FormHomeSkeleton';
import { useFormHomeData } from '@/features/form-tracking/hooks/use-form-home-data';
import { theme } from '@/styles/theme';
import { useNutritionFormInsights } from '@/features/form-tracking/hooks/use-nutrition-form-insights';

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

  const handleReviewPress = useCallback(() => {
    if (formHome.data.lastSessionId) {
      router.push(`/(modals)/workout-insights?sessionId=${encodeURIComponent(formHome.data.lastSessionId)}`);
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
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#4C8CFF"
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.heading} accessibilityRole="header">Form</Text>
          <Text style={styles.subheading}>Analyze your technique and review your progress.</Text>
        </View>

        <StartSessionCta />

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
            {formHome.data.lastSessionId ? (
              <Pressable
                onPress={handleReviewPress}
                accessibilityRole="button"
                accessibilityLabel="Review latest analysis"
                accessibilityHint="Opens form insights for your most recent session"
                style={styles.reviewRow}
                testID="form-home-review-latest"
              >
                <Ionicons name="analytics-outline" size={24} color={theme.colors.accentText} />
                <View style={styles.reviewCopy}>
                  <Text style={styles.reviewTitle}>Latest analysis</Text>
                  <Text style={styles.reviewSubtitle}>Review your form insights</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.secondary} />
              </Pressable>
            ) : !formHome.loading && !formHome.error ? (
              <Text style={styles.emptyReview}>Your latest analysis will appear here when available.</Text>
            ) : null}

            <Text style={styles.sectionLabel} accessibilityRole="header">TECHNIQUE PROGRESS</Text>
            <TodayFqiCard
              bestFqi={formHome.data.todayBestFqi}
              avgFqi={formHome.data.todayAvgFqi}
              setCount={formHome.data.todaySetCount}
              loading={formHome.loading}
              onPress={formHome.data.lastSessionId ? handleReviewPress : undefined}
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
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    padding: 24,
    gap: 18,
  },
  header: { gap: 6 },
  heading: { color: theme.colors.text, fontFamily: theme.font.bold, fontSize: 30, lineHeight: 38, letterSpacing: -0.8 },
  subheading: { color: theme.colors.secondary, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 22 },
  sectionLabel: { color: theme.colors.secondary, fontFamily: theme.font.medium, fontSize: 11, letterSpacing: 1.8, marginTop: 8 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    minHeight: 72,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  reviewCopy: { flex: 1, gap: 4 },
  reviewTitle: { color: theme.colors.text, fontFamily: theme.font.medium, fontSize: 15 },
  reviewSubtitle: { color: theme.colors.secondary, fontFamily: theme.font.regular, fontSize: 12, lineHeight: 18 },
  emptyReview: { color: theme.colors.secondary, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 20 },
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
