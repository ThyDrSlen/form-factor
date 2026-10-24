import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { WeightTrendChart } from '@/features/health/components/WeightTrendChart';
import { useHealthKit } from '@/features/health/contexts/HealthKitContext';
import { useUnits } from '@/contexts/UnitsContext';
import { useWorkouts } from '@/features/workouts/contexts/WorkoutsContext';
import { useFood } from '@/features/nutrition/contexts/FoodContext';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { errorWithTs } from '@/lib/logger';
import { fetchHealthTrendData, type HealthTrendData } from '@/lib/services/healthkit/health-aggregation';
import { theme } from '@/styles/theme';
import { VO2TrendCard } from './VO2TrendCard';
import { summarizeWeightPeriods } from '@/lib/services/healthkit/weight-period-summary';

type TimeRange = 'daily' | 'weekly' | 'monthly';
type WeightRange = '7d' | '30d' | '180d';
const WEIGHT_RANGES: { value: WeightRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '180d', label: '180 days' },
];
const RANGES: { value: TimeRange; label: string }[] = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
];

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function MetricCard({ title, value, detail, icon }: {
  title: string;
  value: string;
  detail: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={20} color={theme.colors.accentText} />
      <Text style={styles.metricTitle}>{title}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.caption}>{detail}</Text>
    </View>
  );
}

function SyncProgressBanner({ syncProgress, isSyncing }: Pick<ReturnType<typeof useHealthKit>, 'syncProgress' | 'isSyncing'>) {
  if (!isSyncing && !syncProgress) return null;

  const phase = syncProgress?.phase;
  const message = phase === 'complete'
    ? 'Health history synced'
    : phase === 'error'
      ? 'Health history could not sync. Try importing again.'
      : phase === 'uploading'
        ? `Syncing ${syncProgress?.current ?? 0} of ${syncProgress?.total ?? 0} records…`
        : 'Reading health history…';

  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      {isSyncing ? (
        <ActivityIndicator size="small" color={theme.colors.accentText} />
      ) : (
        <Ionicons
          name={phase === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
          size={18}
          color={theme.colors.secondary}
        />
      )}
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

export function HealthTrendsView() {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('weekly');
  const [weightRange, setWeightRange] = useState<WeightRange>('30d');
  const [showWeightDetails, setShowWeightDetails] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    userId: string;
    range: TimeRange;
    data: HealthTrendData;
  } | null>(null);
  const [isLoadingTrends, setIsLoadingTrends] = useState(true);
  const [trendError, setTrendError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const {
    stepsToday,
    stepHistory,
    latestHeartRate,
    recordedWeightHistory = [],
    recordedVO2History = [],
    isAvailable,
    isLoading: isLoadingHealth,
    error: healthError,
    lastUpdatedAt,
    isSyncing,
    syncProgress,
    hasSyncedBefore,
    syncAllHistoricalData,
  } = useHealthKit();
  const { workouts, loading: loadingWorkouts, error: workoutError } = useWorkouts();
  const { foods, loading: loadingFoods, error: foodError } = useFood();
  const { user } = useAuth();
  const { weightUnit, toggleWeightUnit, convertWeight, getWeightLabel } = useUnits();
  const userId = user?.id;

  // Refresh this presentation on focus and after health updates without blocking the weight chart.
  useFocusEffect(useCallback(() => {
    if (!userId) {
      setSnapshot(null);
      setIsLoadingTrends(false);
      return;
    }
    let active = true;
    setIsLoadingTrends(true);
    setTrendError(false);
    // Weight history must not shrink when the activity summary switches to Today.
    void fetchHealthTrendData(userId, 180)
      .then((data) => {
        if (active) setSnapshot({ userId, range: selectedRange, data });
      })
      .catch((error) => {
        errorWithTs('[HealthTrends] Failed to load trend data', error);
        if (active) setTrendError(true);
      })
      .finally(() => {
        if (active) setIsLoadingTrends(false);
      });
    return () => { active = false; };
  }, [userId, selectedRange, hasSyncedBefore, lastUpdatedAt, isSyncing, retryKey]));

  const trendData = snapshot?.userId === userId && snapshot?.range === selectedRange
    ? snapshot.data
    : null;
  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setHours(0, 0, 0, 0);
  if (selectedRange === 'weekly') {
    periodStart.setDate(periodStart.getDate() - ((periodStart.getDay() + 6) % 7));
  } else if (selectedRange === 'monthly') {
    periodStart.setDate(1);
  }
  const todayKey = formatDateKey(now);
  const periodKey = formatDateKey(periodStart);
  const today = trendData?.daily.find((day) => day.date === todayKey);
  const aggregate = selectedRange === 'weekly'
    ? trendData?.weekly.find((period) => period.period === periodKey)
    : trendData?.monthly.find((period) => period.period === periodKey);

  // Missing synced step dates are zero-filled upstream; do not present an all-empty period as measured zero.
  const steps = selectedRange === 'daily'
    ? stepsToday ?? (today?.steps != null && today.steps > 0 ? today.steps : null)
    : aggregate?.avgSteps != null && aggregate.avgSteps > 0 ? aggregate.avgSteps : null;
  const latestHeartRateIsToday = latestHeartRate?.timestamp != null
    && formatDateKey(new Date(latestHeartRate.timestamp)) === todayKey;
  const heartRate = selectedRange === 'daily'
    ? today?.heartRateBpm ?? (latestHeartRateIsToday ? latestHeartRate?.bpm : null)
    : aggregate?.avgHeartRate;

  // These contexts contain logged entries, not the completed workout-session ledger.
  const inPeriod = (date: string) => {
    const entryDate = new Date(date);
    return entryDate >= periodStart && entryDate <= now;
  };
  const workoutCount = (loadingWorkouts || workoutError) && workouts.length === 0
    ? null
    : workouts.filter((entry) => inPeriod(entry.date)).length;
  const calories = (loadingFoods || foodError) && foods.length === 0
    ? null
    : foods.filter((entry) => inPeriod(entry.date))
      .reduce((sum, entry) => sum + (entry.calories ?? 0), 0);

  const weightSeries = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Number.parseInt(weightRange, 10) - 1));
    // Saved summaries and legacy history can repeat a stale weight. Only native
    // observations retain the actual measurement instant and explicit provenance.
    return recordedWeightHistory.filter((point) => point.provenance === 'observed'
      && Number.isFinite(point.date) && Number.isFinite(point.value) && point.value > 0
      && point.date >= start.getTime() && point.date <= end.getTime())
      .map((point) => ({ ...point, value: convertWeight(point.value), unit: getWeightLabel() }))
      .sort((a, b) => a.date - b.date);
  }, [recordedWeightHistory, weightRange, convertWeight, getWeightLabel]);
  const weightWindowLabel = weightRange === '7d' ? 'Past 7 days' : weightRange === '30d' ? 'Past 30 days' : 'Past 180 days';
  const weightSummary = summarizeWeightPeriods(recordedWeightHistory, Number.parseInt(weightRange, 10), now);
  const summaryDelta = weightSummary.delta == null ? null
    : weightSummary.unit === 'kg' ? convertWeight(weightSummary.delta) : weightSummary.delta;
  const summaryUnit = weightSummary.unit === 'kg' ? getWeightLabel() : weightSummary.unit;

  const activityPeriodLabel = selectedRange === 'daily' ? 'Today' : selectedRange === 'weekly' ? 'This week · Monday to today' : 'This month · month to date';

  // Both history sources can zero-fill absent days. Only positive history values
  // are known readings; an explicit current-day total can legitimately be zero.
  const stepDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (6 - index));
    const key = formatDateKey(date);
    const live = stepHistory.find((point) => Number.isFinite(point.date)
      && new Date(point.date).toISOString().slice(0, 10) === key && Number.isFinite(point.value) && point.value > 0);
    const saved = trendData?.daily.find((day) => day.date === key)?.steps;
    const value = key === todayKey && stepsToday != null && Number.isFinite(stepsToday) && stepsToday >= 0
      ? stepsToday : live?.value ?? (saved != null && Number.isFinite(saved) && saved > 0 ? saved : null);
    return { key, label: date.toLocaleDateString('en-US', { weekday: 'short' }), value };
  });
  const maxSteps = Math.max(1, ...stepDays.map((day) => day.value ?? 0));

  const handleImportHistory = () => {
    Alert.alert(
      'Import health history',
      'Import up to one year of available HealthKit steps and weight data for your trends.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import history', onPress: () => { void syncAllHistoricalData(365); } },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Body weight</Text>
          <Text style={styles.caption}>{weightWindowLabel}</Text>
        </View>
        <View style={styles.unitToggle}>
          {(['lbs', 'kg'] as const).map((unit) => (
            <Pressable
              key={unit}
              accessibilityRole="button"
              accessibilityLabel={`Weight in ${unit === 'lbs' ? 'pounds' : 'kilograms'}`}
              accessibilityState={{ selected: weightUnit === unit }}
              onPress={() => { if (weightUnit !== unit) toggleWeightUnit(); }}
              style={({ pressed }) => [styles.unitButton, weightUnit === unit && styles.unitButtonActive, pressed && styles.pressed]}
            >
              <Text style={[styles.unitButtonText, weightUnit === unit && styles.unitButtonTextActive]}>{unit}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.timeRangeContainer} accessibilityRole="tablist" accessibilityLabel="Weight history range">
        {WEIGHT_RANGES.map(({ value, label }) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: weightRange === value }}
            onPress={() => setWeightRange(value)}
            style={({ pressed }) => [styles.timeRangeButton, weightRange === value && styles.timeRangeButtonActive, pressed && styles.pressed]}
          >
            <Text style={[styles.timeRangeText, weightRange === value && styles.timeRangeTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {weightSeries.length > 0 ? (
        <View style={styles.chartFrame}>
          <WeightTrendChart data={weightSeries} period={weightRange} weightUnit={getWeightLabel()} showPredictions={false} />
        </View>
      ) : (
        <View style={styles.emptyCard}>
          {isLoadingHealth ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Ionicons name="scale-outline" size={28} color={theme.colors.muted} />
          )}
          <Text style={styles.emptyTitle}>{isLoadingHealth ? 'Loading weight history…' : 'No weight history available'}</Text>
          <Text style={styles.emptyText}>
            {isLoadingHealth
              ? 'Loading your available weight readings.'
              : healthError
                ? 'Measured weight history could not be updated. Saved summaries are not counted as measurements.'
                : 'No weight readings are available in this range. One reading is enough to display; a trend needs readings on two days. Check Body Mass read access in Health if you expect more history.'}
          </Text>
          {!isLoadingHealth && weightRange !== '180d' ? (
            <Pressable accessibilityRole="button" onPress={() => setWeightRange('180d')} style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}>
              <Text style={styles.syncButtonText}>Show 180 days</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={styles.stepsCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Completed {weightSummary.days}-day weight periods</Text>
        <Text style={summaryDelta == null ? styles.comparisonUnavailable : styles.comparisonResult}>
          {summaryDelta == null
            ? 'Comparison unavailable: need at least 3 recorded days in each period and matching units and source labels.'
            : `Recorded-day mean change: ${summaryDelta > 0 ? '+' : ''}${summaryDelta.toFixed(1)} ${summaryUnit}`}
        </Text>
        <Text style={styles.caption}>Uneven coverage can affect this comparison. Device source is unknown.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Weight comparison details"
          accessibilityState={{ expanded: showWeightDetails }}
          onPress={() => setShowWeightDetails((shown) => !shown)}
          style={({ pressed }) => [styles.detailsButton, pressed && styles.pressed]}
        >
          <Text style={styles.syncButtonText}>{showWeightDetails ? 'Hide comparison details' : 'Comparison details'}</Text>
          <Ionicons name={showWeightDetails ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.accentText} />
        </Pressable>
        {showWeightDetails ? (
          <View style={styles.comparisonDetails}>
            {([['Previous', weightSummary.previous], ['Recent', weightSummary.current]] as const).map(([label, period]) => (
              <Text key={label} style={styles.caption}>
                {label}: {period.start}–{period.end} · {period.recordedDays}/{weightSummary.days} recorded days · {period.samples} readings
              </Text>
            ))}
            <Text style={styles.caption}>Each recorded day has equal weight. Missing days are not imputed; today is excluded. Uneven coverage can affect this descriptive comparison.</Text>
            <Text style={styles.caption}>Originating HealthKit device source is unknown. Matching generic HealthKit labels do not prove the same device or measurement method.</Text>
          </View>
        ) : null}
      </View>

      <VO2TrendCard data={recordedVO2History} now={now.getTime()} />

      <View style={styles.stepsCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Steps · past 7 days</Text>
        <View style={styles.stepBars}>
          {stepDays.map((day) => (
            <View key={day.key} style={styles.stepColumn} accessible
              accessibilityLabel={`${day.key}: ${day.value == null ? 'no step reading available' : `${Math.round(day.value).toLocaleString()} steps`}`}>
              <Text style={styles.caption}>{day.value == null ? '—' : Math.round(day.value).toLocaleString()}</Text>
              <View style={styles.stepTrack}>
                {day.value != null ? <View style={[styles.stepBar, { height: (day.value / maxSteps) * 80 }]} /> : null}
              </View>
              <Text style={styles.caption}>{day.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.caption}>
          {stepDays.some((day) => day.value != null)
            ? 'Available daily totals · today is still in progress. — means no confirmed reading; history zeros may be missing data.'
            : 'No step history available yet. Shared Health steps or imported history will appear here.'}
        </Text>
      </View>

      <View testID="activity-summary" style={styles.activitySummary}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeading}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Activity & nutrition</Text>
            <Text style={styles.caption}>{activityPeriodLabel}</Text>
          </View>
          {isLoadingTrends ? <ActivityIndicator size="small" color={theme.colors.accentText} accessibilityLabel="Updating activity history" /> : null}
        </View>
        <View style={styles.timeRangeContainer} accessibilityRole="tablist" accessibilityLabel="Activity summary range">
          {RANGES.map(({ value, label }) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedRange === value }}
              onPress={() => setSelectedRange(value)}
              style={({ pressed }) => [styles.timeRangeButton, selectedRange === value && styles.timeRangeButtonActive, pressed && styles.pressed]}
            >
              <Text style={[styles.timeRangeText, selectedRange === value && styles.timeRangeTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.metricsGrid}>
          <MetricCard
            title={selectedRange === 'daily' ? 'Steps' : 'Synced steps / day'}
            value={steps == null ? '—' : Math.round(steps).toLocaleString()}
            detail={steps == null
              ? isLoadingTrends || isLoadingHealth ? 'Loading history…' : 'No reading available'
              : selectedRange === 'daily' ? 'Today’s activity' : 'Period average'}
            icon="footsteps-outline"
          />
          <MetricCard
            title={selectedRange === 'daily' ? 'Heart rate' : 'Average heart rate'}
            value={heartRate == null ? '—' : Math.round(heartRate).toLocaleString()}
            detail={heartRate == null
              ? isLoadingTrends || isLoadingHealth ? 'Loading history…' : 'No reading available'
              : 'bpm'}
            icon="heart-outline"
          />
          <MetricCard
            title="Workout entries"
            value={workoutCount == null ? '—' : workoutCount.toLocaleString()}
            detail={workoutCount == null
              ? loadingWorkouts ? 'Loading history…' : 'History unavailable'
              : 'Logged in this period'}
            icon="barbell-outline"
          />
          <MetricCard
            title="Food energy"
            value={calories == null ? '—' : Math.round(calories).toLocaleString()}
            detail={calories == null
              ? loadingFoods ? 'Loading history…' : 'History unavailable'
              : 'kcal logged · not burned'}
            icon="nutrition-outline"
          />
        </View>
      </View>

      {trendError ? (
        <Pressable accessibilityRole="button" onPress={() => setRetryKey((key) => key + 1)} style={({ pressed }) => [styles.notice, pressed && styles.pressed]}>
          <Ionicons name="refresh-outline" size={18} color={theme.colors.accentText} />
          <Text style={styles.noticeText}>Activity history could not update. Tap to retry.</Text>
        </Pressable>
      ) : null}
      {healthError || workoutError || foodError ? (
        <Text style={styles.sourceNote}>Some history could not update. Available saved entries are shown.</Text>
      ) : null}
      <SyncProgressBanner syncProgress={syncProgress} isSyncing={isSyncing} />
      {isAvailable && userId && !isSyncing ? (
        <Pressable accessibilityRole="button" onPress={handleImportHistory} style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}>
          <Ionicons name="cloud-download-outline" size={18} color={theme.colors.accentText} />
          <Text style={styles.syncButtonText}>{hasSyncedBefore ? 'Update health history' : 'Import health history'}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
        </Pressable>
      ) : null}
      <Text style={styles.sourceNote}>
        From your health history and logged workouts and food. Missing readings are shown as —. Synced step averages include missing days as zero; an all-zero synced period is shown as unavailable. Weight dots use actual HealthKit recordings only. Saved summaries and carried-forward values are excluded; device source details are not supplied by the current bridge.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  timeRangeContainer: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: theme.radius.button,
    backgroundColor: theme.colors.surface,
    marginBottom: 4,
  },
  timeRangeButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 6,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  timeRangeButtonActive: { backgroundColor: theme.colors.elevated },
  timeRangeText: { fontFamily: theme.font.medium, fontSize: 12, color: theme.colors.secondary },
  timeRangeTextActive: { color: theme.colors.text },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionHeading: { flex: 1, gap: 4 },
  sectionTitle: { fontFamily: theme.font.medium, fontSize: 17, lineHeight: 24, color: theme.colors.text },
  caption: { fontFamily: theme.font.regular, fontSize: 12, lineHeight: 19, color: theme.colors.secondary },
  unitToggle: { flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: 12, padding: 3 },
  unitButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 9 },
  unitButtonActive: { backgroundColor: theme.colors.elevated },
  unitButtonText: { fontFamily: theme.font.medium, fontSize: 12, color: theme.colors.secondary },
  unitButtonTextActive: { color: theme.colors.accentText },
  chartFrame: { width: '100%' },
  emptyCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.card,
    padding: 28,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyTitle: { fontFamily: theme.font.medium, fontSize: 16, color: theme.colors.text, textAlign: 'center' },
  emptyText: { fontFamily: theme.font.regular, fontSize: 13, lineHeight: 21, color: theme.colors.secondary, textAlign: 'center' },
  stepsCard: { padding: 16, gap: 12, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface },
  comparisonResult: { fontFamily: theme.font.medium, fontSize: 20, lineHeight: 28, color: theme.colors.text, fontVariant: ['tabular-nums'] },
  comparisonUnavailable: { fontFamily: theme.font.regular, fontSize: 13, lineHeight: 21, color: theme.colors.secondary },
  comparisonDetails: { gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, paddingTop: 12 },
  detailsButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10 },
  pressed: { opacity: 0.65 },
  stepBars: { flexDirection: 'row', gap: 4 },
  stepColumn: { flex: 1, alignItems: 'center', gap: 6 },
  stepTrack: { height: 80, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  stepBar: { width: '65%', borderRadius: 4, backgroundColor: theme.colors.accentText },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  activitySummary: { gap: 16, paddingTop: 8 },
  metricCard: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 130,
    padding: 16,
    gap: 8,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  metricTitle: { fontFamily: theme.font.regular, fontSize: 12, lineHeight: 18, color: theme.colors.secondary },
  metricValue: { fontFamily: theme.font.medium, fontSize: 25, lineHeight: 34, color: theme.colors.text, fontVariant: ['tabular-nums'] },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, padding: 14, backgroundColor: theme.colors.surface, borderRadius: 12 },
  noticeText: { flex: 1, fontFamily: theme.font.regular, fontSize: 12, lineHeight: 19, color: theme.colors.secondary },
  syncButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  syncButtonText: { flex: 1, fontFamily: theme.font.medium, fontSize: 13, color: theme.colors.accentText },
  sourceNote: { fontFamily: theme.font.regular, fontSize: 11, lineHeight: 18, color: theme.colors.secondary },
});
