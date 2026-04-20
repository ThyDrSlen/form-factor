import React, { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  RecoveryFormCorrelation,
  RecoveryFormInsight,
} from '@/lib/services/form-recovery-correlator';

export interface RecoveryFormCorrelationCardProps {
  data: RecoveryFormCorrelation | null;
  loading?: boolean;
}

function significanceChipStyle(significance: 'low' | 'medium' | 'high') {
  switch (significance) {
    case 'high':
      return { background: 'rgba(60, 200, 169, 0.18)', color: '#3CC8A9' };
    case 'medium':
      return { background: 'rgba(255, 184, 76, 0.18)', color: '#FFB84C' };
    default:
      return { background: 'rgba(154, 172, 209, 0.18)', color: '#97A3C2' };
  }
}

function rankInsights(insights: RecoveryFormInsight[]): RecoveryFormInsight[] {
  const sig = { high: 2, medium: 1, low: 0 } as const;
  return [...insights].sort((a, b) => {
    const sa = sig[a.metric.significance];
    const sb = sig[b.metric.significance];
    if (sb !== sa) return sb - sa;
    return Math.abs(b.metric.r) - Math.abs(a.metric.r);
  });
}

export function RecoveryFormCorrelationCard({
  data,
  loading,
}: RecoveryFormCorrelationCardProps) {
  const ranked = useMemo(() => {
    if (!data) return [];
    return rankInsights(data.insights);
  }, [data]);

  if (loading) {
    return (
      <View style={styles.card} testID="recovery-correlation-loading">
        <Text style={styles.title}>Recovery × form</Text>
        <Text style={styles.body}>Crunching your sleep + HR history…</Text>
      </View>
    );
  }

  if (!data || data.sampleCount === 0 || ranked.length === 0) {
    return (
      <View style={styles.card} testID="recovery-correlation-empty">
        <Text style={styles.title}>Recovery × form</Text>
        <Text style={styles.body}>
          Log more sessions alongside your sleep + HR data to unlock recovery insights.
        </Text>
      </View>
    );
  }

  const top = ranked[0];
  const chip = significanceChipStyle(top.metric.significance);

  return (
    <View style={styles.card} testID="recovery-correlation-card">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Recovery × form</Text>
        <View style={[styles.chip, { backgroundColor: chip.background }]}>
          <Text style={[styles.chipText, { color: chip.color }]}>
            {top.metric.significance}
          </Text>
        </View>
      </View>
      <Text style={styles.insightTitle}>{top.title}</Text>
      <Text style={styles.body}>{top.description}</Text>
      <View style={styles.miniBarRow}>
        {ranked.map((insight) => (
          <View
            key={insight.id}
            style={styles.miniBarItem}
            testID={`recovery-correlation-bar-${insight.id}`}
          >
            <Text style={styles.miniBarLabel}>{insight.title.replace(' × form', '')}</Text>
            <View style={styles.miniBarTrack}>
              <View
                style={[
                  styles.miniBarFill,
                  {
                    width: (`${Math.min(100, Math.abs(insight.metric.r) * 100).toFixed(0)}%`) as `${number}%`,
                    backgroundColor:
                      insight.metric.r >= 0 ? '#3CC8A9' : '#FF7B7B',
                  },
                ]}
              />
            </View>
            <Text style={styles.miniBarMeta}>
              r={insight.metric.r.toFixed(2)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.meta}>n={data.sampleCount} sessions joined</Text>
    </View>
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
    marginBottom: 6,
  },
  title: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '600',
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  insightTitle: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  body: {
    color: '#97A3C2',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  miniBarRow: {
    marginTop: 12,
    gap: 8,
  },
  miniBarItem: {
    gap: 4,
  },
  miniBarLabel: {
    color: '#97A3C2',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  miniBarTrack: {
    height: 6,
    backgroundColor: 'rgba(154, 172, 209, 0.15)',
    borderRadius: 3,
  },
  miniBarFill: {
    height: 6,
    borderRadius: 3,
  },
  miniBarMeta: {
    color: '#6781A6',
    fontSize: 11,
  },
  meta: {
    color: '#6781A6',
    fontSize: 11,
    marginTop: 8,
  },
});
