import React, { useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NutritionFormCorrelation } from '@/lib/services/form-nutrition-correlator';

export interface NutritionFormCorrelationCardProps {
  data: NutritionFormCorrelation | null;
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

export function NutritionFormCorrelationCard({
  data,
  loading,
}: NutritionFormCorrelationCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  const topInsight = useMemo(() => {
    if (!data) return null;
    // Rank by significance bucket (high > medium > low), tiebreak by |r|.
    const ranked = [...data.insights].sort((a, b) => {
      const sig = { high: 2, medium: 1, low: 0 } as const;
      const sa = sig[a.metric.significance];
      const sb = sig[b.metric.significance];
      if (sb !== sa) return sb - sa;
      return Math.abs(b.metric.r) - Math.abs(a.metric.r);
    });
    return ranked[0] ?? null;
  }, [data]);

  if (loading) {
    return (
      <View style={styles.card} testID="nutrition-correlation-loading">
        <Text style={styles.title}>Nutrition × form</Text>
        <Text style={styles.body}>Crunching your last sessions…</Text>
      </View>
    );
  }

  if (!data || data.sampleCount === 0 || !topInsight) {
    return (
      <View style={styles.card} testID="nutrition-correlation-empty">
        <Text style={styles.title}>Nutrition × form</Text>
        <Text style={styles.body}>
          Log a few workouts alongside your meals to unlock nutrition insights.
        </Text>
      </View>
    );
  }

  const chip = significanceChipStyle(topInsight.metric.significance);

  return (
    <>
      <View style={styles.card} testID="nutrition-correlation-card">
        <View style={styles.headerRow}>
          <Text style={styles.title}>Nutrition × form</Text>
          <View style={[styles.chip, { backgroundColor: chip.background }]}>
            <Text style={[styles.chipText, { color: chip.color }]}>
              {topInsight.metric.significance}
            </Text>
          </View>
        </View>
        <Text style={styles.insightTitle}>{topInsight.title}</Text>
        <Text style={styles.body}>{topInsight.description}</Text>
        <Text style={styles.meta}>
          n={topInsight.metric.sampleCount} • r={topInsight.metric.r.toFixed(2)}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Learn more about nutrition correlation"
          onPress={() => setDetailOpen(true)}
          style={styles.learnMore}
          testID="nutrition-correlation-learn-more"
        >
          <Text style={styles.learnMoreText}>Learn more</Text>
        </TouchableOpacity>
      </View>
      <Modal
        visible={detailOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setDetailOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nutrition × form detail</Text>
            <ScrollView style={styles.modalScroll}>
              {data.insights.map((insight) => (
                <View
                  key={insight.id}
                  style={styles.modalRow}
                  testID={`nutrition-correlation-detail-${insight.id}`}
                >
                  <Text style={styles.modalRowTitle}>{insight.title}</Text>
                  <Text style={styles.modalRowBody}>{insight.description}</Text>
                  <Text style={styles.modalRowMeta}>
                    n={insight.metric.sampleCount} • r={insight.metric.r.toFixed(2)} • R²={insight.metric.r2.toFixed(2)}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setDetailOpen(false)}
              style={styles.modalClose}
              testID="nutrition-correlation-detail-close"
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
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
    marginBottom: 4,
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
    marginTop: 6,
  },
  body: {
    color: '#97A3C2',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  meta: {
    color: '#6781A6',
    fontSize: 11,
    marginTop: 6,
  },
  learnMore: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  learnMoreText: {
    color: '#4C8CFF',
    fontSize: 13,
    fontWeight: '500',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 12, 24, 0.72)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#141B2D',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalRow: {
    marginBottom: 16,
  },
  modalRowTitle: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalRowBody: {
    color: '#97A3C2',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  modalRowMeta: {
    color: '#6781A6',
    fontSize: 11,
    marginTop: 4,
  },
  modalClose: {
    marginTop: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#F5F7FF',
    fontSize: 14,
    fontWeight: '500',
  },
});
