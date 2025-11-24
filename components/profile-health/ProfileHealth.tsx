import React, { useMemo } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useHealthKit } from '@/contexts/HealthKitContext';
import { useUnits } from '@/contexts/UnitsContext';
import { getHealthKitGuidance } from '@/components/health-kit/healthkit-guidance';
import type { HealthMetricPoint } from '@/lib/services/healthkit/health-metrics';

function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(undefined, options).format(value);
}

function toDayLabel(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(timestamp));
}

function computeDelta(data: HealthMetricPoint[]) {
  if (data.length < 2) return { delta: 0, label: '0%' };
  const first = data[0].value;
  const last = data[data.length - 1].value;
  if (first === 0 && last === 0) return { delta: 0, label: '0%' };
  if (first === 0) return { delta: 100, label: '+100%' };
  const delta = ((last - first) / Math.abs(first)) * 100;
  const rounded = Math.round(delta);
  return {
    delta,
    label: `${rounded >= 0 ? '+' : ''}${rounded}%`,
  };
}

function formatUpdatedAt(timestamp: number | null): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
  }
  return date.toLocaleDateString();
}

function buildLinePath(points: HealthMetricPoint[]): { line: string; area: string; dot?: { x: number; y: number } } {
  if (points.length === 0) {
    return { line: '', area: '' };
  }

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  // Ensure valid range
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  // Pad near-constant series to make subtle changes visible
  if (max - min < 0.001) {
    const mid = (max + min) / 2;
    const pad = Math.max(1, Math.abs(mid) * 0.01);
    min = mid - pad;
    max = mid + pad;
  }
  const range = max - min || 1;

  const normalized = points.map((point, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
    const valueRatio = Math.max(0, Math.min(1, (point.value - min) / range));
    const y = 55 - valueRatio * 40;
    return { x, y };
  });

  const line = normalized
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

  const area = `${line} L ${normalized[normalized.length - 1].x.toFixed(2)} 60 L ${normalized[0].x.toFixed(2)} 60 Z`;

  const dot = normalized[normalized.length - 1];
  return { line, area, dot };
}

function LineChart({ data, gradientId, stroke }: { data: HealthMetricPoint[]; gradientId: string; stroke: string }) {
  const { line, area, dot } = useMemo(() => buildLinePath(data), [data]);

  if (!line) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>No step data yet</Text>
      </View>
    );
  }

  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 60">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
          <Stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill={`url(#${gradientId})`} />
      <Path d={line} stroke={stroke} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {dot ? <Path d={`M ${dot.x} ${dot.y} m -1.8,0 a 1.8,1.8 0 1,0 3.6,0 a 1.8,1.8 0 1,0 -3.6,0`} fill={stroke} /> : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  chartEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartEmptyText: {
    fontSize: 12,
    color: '#6781A6',
  },
  loadingIndicator: {
    width: 72,
    height: 72,
  },
  cardBase: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    backgroundColor: '#0D2036',
  },
  card: {
    padding: 24,
  },
  metricCard: {
    padding: 20,
  },
  metricHeader: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  metricHeaderContent: {
    gap: 4,
  },
  metricTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6781A6',
  },
  metricHeadline: {
    fontSize: 24,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  metricSubtitle: {
    fontSize: 12,
    color: '#9AACD1',
  },
  metricDelta: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6781A6',
  },
  metricDeltaPositive: {
    color: '#3CC8A9',
  },
  chartArea: {
    height: 144,
  },
  metricLabels: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricLabel: {
    fontSize: 11,
    color: '#6781A6',
  },
  loadingCard: {
    marginTop: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#9AACD1',
  },
  guidanceHeadline: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  guidanceDescription: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: '#9AACD1',
  },
  primaryButton: {
    marginTop: 16,
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#4C8CFF',
    paddingVertical: 12,
  },
  primaryButtonText: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  settingsButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingsButtonText: {
    fontWeight: '600',
    color: '#4C8CFF',
  },
  footnote: {
    marginTop: 12,
    fontSize: 12,
    color: '#6781A6',
  },
  progressSection: {
    marginTop: 32,
    gap: 24,
  },
  progressTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  progressSubtitle: {
    fontSize: 12,
    color: '#6781A6',
  },
});

function BarChart({ data, color }: { data: HealthMetricPoint[]; color: string }) {
  const bars = useMemo(() => {
    if (!data.length) return [] as { x: number; y: number; h: number; w: number }[];
    const values = data.map((point) => point.value ?? 0);
    const max = Math.max(...values, 0.1);
    const gap = 4;
    const barWidth = Math.max(1, (100 - gap * (data.length + 1)) / data.length);

    return data.map((point, index) => {
      const height = max > 0 ? ((point.value ?? 0) / max) * 45 : 0;
      const h = Number.isFinite(height) ? Math.max(0, height) : 0;
      const x = gap + index * (barWidth + gap);
      const y = 55 - h;
      return { x, y, h, w: barWidth };
    });
  }, [data]);

  if (!bars.length) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>No weight entries</Text>
      </View>
    );
  }

  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 60">
      {bars.map((bar, index) => (
        <Rect
          key={`bar-${index}`}
          x={bar.x}
          y={bar.y}
          width={bar.w}
          height={bar.h}
          rx={2.4}
          fill={color}
          opacity={0.85}
        />
      ))}
    </Svg>
  );
}

interface MetricCardProps {
  title: string;
  headline: string;
  subtitle: string;
  deltaLabel: string;
  deltaPositive?: boolean;
  labels: string[];
  children: React.ReactNode;
}

function MetricCard({ title, headline, subtitle, deltaLabel, deltaPositive, labels, children }: MetricCardProps) {
  return (
    <View style={[styles.cardBase, styles.metricCard]}>
      <View style={styles.metricHeader}>
        <View style={styles.metricHeaderContent}>
          <Text style={styles.metricTitle}>{title}</Text>
          <Text style={styles.metricHeadline}>{headline}</Text>
          <Text style={styles.metricSubtitle}>{subtitle}</Text>
        </View>
        <Text style={[styles.metricDelta, deltaPositive && styles.metricDeltaPositive]}>{deltaLabel}</Text>
      </View>
      <View style={styles.chartArea}>{children}</View>
      <View style={styles.metricLabels}>
        {labels.map((label, index) => (
          <Text key={`${label}-${index}`} style={styles.metricLabel}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function formatWeightDelta(history: HealthMetricPoint[], convertWeight: (kg: number) => number, getWeightLabel: () => string): string {
  if (!history.length) return '—';
  const first = history[0].value;
  const last = history[history.length - 1].value;
  const diff = last - first;
  const convertedDiff = convertWeight(diff);
  if (Math.abs(convertedDiff) < (getWeightLabel() === 'lbs' ? 0.2 : 0.1)) return `0 ${getWeightLabel()}`;
  return `${convertedDiff > 0 ? '+' : ''}${convertedDiff.toFixed(1)} ${getWeightLabel()}`;
}

const NativeCircularProgressRef: { current: React.ComponentType<{ style?: unknown }> | null } = { current: null };

async function loadNativeCircularProgress() {
  if (Platform.OS !== 'ios' || NativeCircularProgressRef.current) {
    return NativeCircularProgressRef.current;
  }

  try {
    const module = await import('@/lib/shims/expo-ui-progress');
    NativeCircularProgressRef.current = module.CircularProgress as React.ComponentType<{ style?: unknown }>;
  } catch (error) {
    console.warn('[ProfileHealth] Failed to load @expo/ui/Progress', error);
    NativeCircularProgressRef.current = null;
  }

  return NativeCircularProgressRef.current;
}

const NativeCircularProgress: React.ComponentType<{ style?: unknown }> | null = Platform.OS === 'ios' ? NativeCircularProgressRef.current : null;

function SwiftUILoadingIndicator() {
  const [Component, setComponent] = React.useState<typeof NativeCircularProgress | null>(NativeCircularProgress);

  React.useEffect(() => {
    if (!Component && Platform.OS === 'ios') {
      loadNativeCircularProgress().then((loaded) => {
        if (loaded) {
          setComponent(() => loaded);
        }
      });
    }
  }, [Component]);

  if (!Component) {
    return <ActivityIndicator size="large" color="#4C8CFF" />;
  }

  return <Component style={styles.loadingIndicator} />;
}

export function ProfileHealth() {
  const {
    status,
    isLoading,
    stepHistory,
    weightHistory,
    weightHistory30Days,
    requestPermissions,
    stepsToday,
    bodyMassKg,
    dataSource,
    lastUpdatedAt,
  } = useHealthKit();
  const { convertWeight, getWeightLabel } = useUnits();

  const isIOS = Platform.OS === 'ios';
  const hasHealthKitRead = Boolean(status?.hasReadPermission);
  const hasSupabaseData = dataSource === 'supabase';
  const guidance = getHealthKitGuidance({ status, isLoading });

  if (!isIOS && !hasSupabaseData) {
    return null;
  }

  if (isLoading) {
    return (
      <View style={[styles.cardBase, styles.card, styles.loadingCard]}>
        <SwiftUILoadingIndicator />
        <Text style={styles.loadingText}>Loading health data…</Text>
      </View>
    );
  }

  if (isIOS && !hasHealthKitRead && !hasSupabaseData) {
    return (
      <View style={[styles.cardBase, styles.card]}>
        <Text style={styles.guidanceHeadline}>{guidance.headline}</Text>
        <Text style={styles.guidanceDescription}>{guidance.description}</Text>
        <TouchableOpacity
          onPress={requestPermissions}
          disabled={guidance.primaryDisabled}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>
            {isLoading ? 'Requesting…' : guidance.primaryCtaLabel}
          </Text>
        </TouchableOpacity>
        {guidance.showSettingsShortcut ? (
          <TouchableOpacity onPress={() => Linking.openSettings()} style={styles.settingsButton}>
            <Text style={styles.settingsButtonText}>Open iOS Settings</Text>
          </TouchableOpacity>
        ) : null}
        {guidance.footnote ? (
          <Text style={styles.footnote}>{guidance.footnote}</Text>
        ) : null}
      </View>
    );
  }

  const stepsLabels = stepHistory.length
    ? stepHistory.map((point) => toDayLabel(point.date))
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  // Use 30-day history for better trend visibility
  // Filter out zero values (days without measurements)
  const rawWeightData = weightHistory30Days.length > 0 ? weightHistory30Days : weightHistory;
  const weightDataToShow = rawWeightData.filter(point => point.value > 0);
  const weightLabels = weightDataToShow.length
    ? weightDataToShow.map((point) => toDayLabel(point.date))
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const stepsDelta = computeDelta(stepHistory);
  const weightDelta = computeDelta(weightDataToShow);

  const currentSteps = stepsToday ?? (stepHistory.length ? stepHistory[stepHistory.length - 1].value : null);
  const currentWeightKg =
    bodyMassKg?.kg ?? (weightHistory.length ? weightHistory[weightHistory.length - 1].value : null);
  const currentWeight = currentWeightKg ? convertWeight(currentWeightKg) : null;
  const stepsDeltaLabel = `${stepsDelta.delta >= 0 ? '+' : ''}${Math.round(stepsDelta.delta)}%`;
  // Removed unused local: weightDeltaLabel (lint)
  const weightChangeLabel = formatWeightDelta(weightDataToShow, convertWeight, getWeightLabel);
  const sourceLabel = dataSource === 'supabase' ? 'Synced from Supabase' : 'HealthKit Live';
  const updatedLabel = formatUpdatedAt(lastUpdatedAt);

  return (
    <View style={styles.progressSection}>
      <Text style={styles.progressTitle}>Progress</Text>
      {updatedLabel ? (
        <Text style={styles.progressSubtitle}>{sourceLabel} • {updatedLabel}</Text>
      ) : (
        <Text style={styles.progressSubtitle}>{sourceLabel}</Text>
      )}
      <MetricCard
        title="Step Trends"
        headline={`${formatNumber(currentSteps, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} steps`}
        subtitle={`Last 7 Days ${stepsDeltaLabel}`}
        deltaLabel={stepsDeltaLabel}
        deltaPositive={stepsDelta.delta > 0}
        labels={stepsLabels}
      >
        <LineChart data={stepHistory} gradientId="stepsGradient" stroke="#4C8CFF" />
      </MetricCard>

      <MetricCard
        title="Weight Tracking"
        headline={`${formatNumber(currentWeight, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} ${getWeightLabel()}`}
        subtitle={weightDataToShow.length > 0 ? `${weightDataToShow.length} Entries (30d)` : 'No entries yet'}
        deltaLabel={weightChangeLabel}
        deltaPositive={weightDelta.delta > 0}
        labels={weightLabels}
      >
        <BarChart data={weightDataToShow} color="#3CC8A9" />
      </MetricCard>
    </View>
  );
}
