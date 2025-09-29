import React, { useMemo } from 'react';
import { ActivityIndicator, Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
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
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const normalized = points.map((point, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
    const valueRatio = (point.value - min) / range;
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: '#6781A6' }}>No step data yet</Text>
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

function BarChart({ data, color }: { data: HealthMetricPoint[]; color: string }) {
  const bars = useMemo(() => {
    if (!data.length) return [] as Array<{ x: number; y: number; h: number; w: number }>;
    const values = data.map((point) => point.value);
    const max = Math.max(...values, 0.1);
    const gap = 4;
    const barWidth = (100 - gap * (data.length + 1)) / data.length;

    return data.map((point, index) => {
      const height = ((point.value ?? 0) / max) * 45;
      const h = Number.isFinite(height) ? height : 0;
      const x = gap + index * (barWidth + gap);
      const y = 55 - h;
      return { x, y, h, w: barWidth };
    });
  }, [data]);

  if (!bars.length) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: '#6781A6' }}>No weight entries</Text>
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
    <View style={{ borderRadius: 24, borderWidth: 1, borderColor: '#1B2E4A', backgroundColor: '#0D2036', padding: 20 }}>
      <View style={{ marginBottom: 16, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6781A6' }}>{title}</Text>
          <Text style={{ fontSize: 24, fontWeight: '600', color: '#F5F7FF' }}>{headline}</Text>
          <Text style={{ fontSize: 12, color: '#9AACD1' }}>{subtitle}</Text>
        </View>
        <Text style={{ fontSize: 14, fontWeight: '600', color: deltaPositive ? '#3CC8A9' : '#6781A6' }}>{deltaLabel}</Text>
      </View>
      <View style={{ height: 144 }}>{children}</View>
      <View style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
        {labels.map((label, index) => (
          <Text key={`${label}-${index}`} style={{ fontSize: 11, color: '#6781A6' }}>
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

const NativeCircularProgress: React.ComponentType<{ style?: unknown }> | null = (() => {
  if (Platform.OS !== 'ios') return null;
  try {
    const { CircularProgress } = require('@expo/ui/Progress');
    return CircularProgress as typeof CircularProgress;
  } catch (error) {
    console.warn('[ProfileHealth] Failed to load @expo/ui/Progress', error);
    return null;
  }
})();

function SwiftUILoadingIndicator() {
  if (!NativeCircularProgress) {
    return <ActivityIndicator size="large" color="#4C8CFF" />;
  }

  return <NativeCircularProgress style={{ width: 72, height: 72 }} />;
}

export function ProfileHealth() {
  const {
    status,
    isLoading,
    stepHistory,
    weightHistory,
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
      <View style={{ marginTop: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: '#1B2E4A', backgroundColor: '#0D2036', padding: 24 }}>
        <SwiftUILoadingIndicator />
        <Text style={{ marginTop: 16, fontSize: 14, color: '#9AACD1' }}>Loading health data…</Text>
      </View>
    );
  }

  if (isIOS && !hasHealthKitRead && !hasSupabaseData) {
    return (
      <View style={{ borderRadius: 24, borderWidth: 1, borderColor: '#1B2E4A', backgroundColor: '#0D2036', padding: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#F5F7FF' }}>{guidance.headline}</Text>
        <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 20, color: '#9AACD1' }}>{guidance.description}</Text>
        <TouchableOpacity
          onPress={requestPermissions}
          disabled={guidance.primaryDisabled}
          style={{ marginTop: 16, alignItems: 'center', borderRadius: 16, backgroundColor: '#4C8CFF', paddingVertical: 12 }}
        >
          <Text style={{ fontWeight: '600', color: '#FFFFFF' }}>
            {isLoading ? 'Requesting…' : guidance.primaryCtaLabel}
          </Text>
        </TouchableOpacity>
        {guidance.showSettingsShortcut ? (
          <TouchableOpacity onPress={() => Linking.openSettings()} style={{ marginTop: 12, alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ fontWeight: '600', color: '#4C8CFF' }}>Open iOS Settings</Text>
          </TouchableOpacity>
        ) : null}
        {guidance.footnote ? (
          <Text style={{ marginTop: 12, fontSize: 12, color: '#6781A6' }}>{guidance.footnote}</Text>
        ) : null}
      </View>
    );
  }

  const stepsLabels = stepHistory.length
    ? stepHistory.map((point) => toDayLabel(point.date))
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weightLabels = weightHistory.length
    ? weightHistory.map((point) => toDayLabel(point.date))
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const stepsDelta = computeDelta(stepHistory);
  const weightDelta = computeDelta(weightHistory);

  const currentSteps = stepsToday ?? (stepHistory.length ? stepHistory[stepHistory.length - 1].value : null);
  const currentWeightKg =
    bodyMassKg?.kg ?? (weightHistory.length ? weightHistory[weightHistory.length - 1].value : null);
  const currentWeight = currentWeightKg ? convertWeight(currentWeightKg) : null;
  const stepsDeltaLabel = `${stepsDelta.delta >= 0 ? '+' : ''}${Math.round(stepsDelta.delta)}%`;
  const weightDeltaLabel = `${weightDelta.delta >= 0 ? '+' : ''}${Math.round(weightDelta.delta)}%`;
  const weightChangeLabel = formatWeightDelta(weightHistory, convertWeight, getWeightLabel);
  const sourceLabel = dataSource === 'supabase' ? 'Synced from Supabase' : 'HealthKit Live';
  const updatedLabel = formatUpdatedAt(lastUpdatedAt);

  return (
    <View style={{ marginTop: 32, gap: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', color: '#F5F7FF' }}>Progress</Text>
      {updatedLabel ? (
        <Text style={{ fontSize: 12, color: '#6781A6' }}>{sourceLabel} • {updatedLabel}</Text>
      ) : (
        <Text style={{ fontSize: 12, color: '#6781A6' }}>{sourceLabel}</Text>
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
        subtitle={`Last 7 Days ${weightDeltaLabel}`}
        deltaLabel={weightChangeLabel}
        deltaPositive={weightDelta.delta > 0}
        labels={weightLabels}
      >
        <BarChart data={weightHistory} color="#3CC8A9" />
      </MetricCard>
    </View>
  );
}
