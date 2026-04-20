import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export interface TodayFqiCardProps {
  /** Best (max) FQI across today's sets. null if no session today. */
  bestFqi: number | null;
  /** Average FQI across today's reps. null if no session today. */
  avgFqi: number | null;
  /** Count of sets logged today. */
  setCount: number;
  /** When true, renders a spinner / shimmer. */
  loading?: boolean;
  /** Optional tap handler — usually opens the insights modal for today's session. */
  onPress?: () => void;
}

function colorForFqi(value: number | null): string {
  if (value === null) return '#6781A6';
  if (value >= 85) return '#3CC8A9';
  if (value >= 75) return '#FFB84C';
  return '#FF5C5C';
}

function labelForFqi(value: number | null): string {
  if (value === null) return 'No data';
  if (value >= 85) return 'Dialed in';
  if (value >= 75) return 'Solid';
  return 'Needs attention';
}

export function TodayFqiCard({
  bestFqi,
  avgFqi,
  setCount,
  loading,
  onPress,
}: TodayFqiCardProps) {
  const color = colorForFqi(bestFqi ?? avgFqi ?? null);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Today form quality"
      onPress={onPress}
      disabled={!onPress || loading}
      activeOpacity={0.85}
      style={styles.card}
      testID="today-fqi-card"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Today&apos;s form</Text>
        {loading && (
          <ActivityIndicator
            size="small"
            color="#4C8CFF"
            testID="today-fqi-card-spinner"
          />
        )}
      </View>
      {!loading && bestFqi === null && avgFqi === null ? (
        <Text style={styles.empty} testID="today-fqi-card-empty">
          No session logged yet today.
        </Text>
      ) : (
        <View style={styles.valueRow}>
          <View style={styles.valueBlock}>
            <Text style={styles.valueLabel}>Best</Text>
            <Text style={[styles.valueNumber, { color }]}>
              {bestFqi != null ? Math.round(bestFqi) : '—'}
            </Text>
          </View>
          <View style={styles.valueBlock}>
            <Text style={styles.valueLabel}>Avg</Text>
            <Text style={styles.valueNumber}>
              {avgFqi != null ? Math.round(avgFqi) : '—'}
            </Text>
          </View>
          <View style={styles.valueBlock}>
            <Text style={styles.valueLabel}>Sets</Text>
            <Text style={styles.valueNumber}>{setCount}</Text>
          </View>
        </View>
      )}
      <Text style={[styles.statusTag, { color }]}>
        {labelForFqi(bestFqi ?? avgFqi ?? null)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F2339',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '600',
  },
  valueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  valueBlock: {
    flexGrow: 1,
  },
  valueLabel: {
    color: '#97A3C2',
    fontSize: 11,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  valueNumber: {
    color: '#F5F7FF',
    fontSize: 26,
    fontWeight: '700',
  },
  statusTag: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  empty: {
    color: '#97A3C2',
    fontSize: 13,
    marginBottom: 8,
  },
});
