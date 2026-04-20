/**
 * RepBreakdownList
 *
 * Scrollable rep-by-rep list for the post-session debrief. Each row shows the
 * rep index, FQI score with a color bucket (>=70 green, 40-69 amber, <40 red),
 * and up to two fault chips.
 *
 * TODO(#437): replace the local `RepSummary` shape with the canonical one from
 * the upcoming insights package. For now each route owns its shape so this
 * component can ship without blocking on that refactor.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type RepSummary = {
  index: number;
  fqi: number;
  faults: string[];
};

export type FqiBucket = 'good' | 'warn' | 'bad';

export function getFqiBucket(fqi: number): FqiBucket {
  if (fqi >= 70) return 'good';
  if (fqi >= 40) return 'warn';
  return 'bad';
}

interface RepBreakdownListProps {
  reps: RepSummary[];
  emptyLabel?: string;
}

const BUCKET_COLOR: Record<FqiBucket, string> = {
  good: '#34C759',
  warn: '#FFB020',
  bad: '#FF4B4B',
};

const BUCKET_LABEL: Record<FqiBucket, string> = {
  good: 'Good rep',
  warn: 'Needs attention',
  bad: 'Poor form',
};

export function RepBreakdownList({
  reps,
  emptyLabel = 'No reps recorded yet. Finish a set to see your rep-by-rep breakdown.',
}: RepBreakdownListProps) {
  const rows = useMemo(() => reps ?? [], [reps]);

  if (rows.length === 0) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel="No reps recorded"
        style={styles.emptyContainer}
        testID="rep-breakdown-empty"
      >
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="rep-breakdown-list">
      {rows.map((rep) => {
        const bucket = getFqiBucket(rep.fqi);
        const color = BUCKET_COLOR[bucket];
        const visibleFaults = rep.faults.slice(0, 2);
        return (
          <View
            key={`rep-${rep.index}`}
            style={styles.row}
            accessibilityRole="summary"
            accessibilityLabel={`Rep ${rep.index}, FQI ${Math.round(rep.fqi)}, ${BUCKET_LABEL[bucket]}`}
            testID={`rep-breakdown-row-${rep.index}`}
          >
            <View style={styles.indexPill}>
              <Text style={styles.indexText}>{rep.index}</Text>
            </View>
            <View style={styles.meta}>
              <View style={styles.scoreRow}>
                <View
                  style={[styles.scoreDot, { backgroundColor: color }]}
                  testID={`rep-breakdown-dot-${rep.index}`}
                />
                <Text
                  style={[styles.scoreText, { color }]}
                  testID={`rep-breakdown-score-${rep.index}`}
                >
                  FQI {Math.round(rep.fqi)}
                </Text>
                <Text style={styles.bucketLabel}>{BUCKET_LABEL[bucket]}</Text>
              </View>
              {visibleFaults.length > 0 ? (
                <View style={styles.faultRow} testID={`rep-breakdown-faults-${rep.index}`}>
                  {visibleFaults.map((fault) => (
                    <View key={fault} style={styles.faultChip}>
                      <Text style={styles.faultText}>{fault}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#0F2339',
    gap: 14,
  },
  indexPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(76, 140, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: {
    color: '#C9D7F4',
    fontWeight: '600',
    fontSize: 15,
  },
  meta: {
    flex: 1,
    gap: 6,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  scoreText: {
    fontWeight: '700',
    fontSize: 15,
  },
  bucketLabel: {
    color: '#9AACD1',
    fontSize: 13,
  },
  faultRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  faultChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 176, 32, 0.14)',
    borderRadius: 999,
  },
  faultText: {
    color: '#FFD18A',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#0F2339',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#9AACD1',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
