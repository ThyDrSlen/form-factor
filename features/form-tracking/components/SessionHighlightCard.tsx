/**
 * SessionHighlightCard
 *
 * Two-up highlight row for the debrief screen: the best rep (green) and the
 * rep that needs the most work (amber). Both inputs are optional so the host
 * can render partial state when there are not enough reps to pick a "worst".
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { RepSummary } from './RepBreakdownList';

interface SessionHighlightCardProps {
  best?: RepSummary;
  worst?: RepSummary;
}

export function SessionHighlightCard({ best, worst }: SessionHighlightCardProps) {
  return (
    <View style={styles.row} testID="session-highlight-row">
      <HighlightCard
        variant="best"
        rep={best}
        title="Best rep"
        iconName="trophy-outline"
        accentColor="#34C759"
        accentBackground="rgba(52, 199, 89, 0.12)"
        emptyCaption="Not enough reps yet."
        testID="session-highlight-best"
      />
      <HighlightCard
        variant="worst"
        rep={worst}
        title="Needs work"
        iconName="alert-circle-outline"
        accentColor="#FFB020"
        accentBackground="rgba(255, 176, 32, 0.12)"
        emptyCaption="No problem reps this session."
        testID="session-highlight-worst"
      />
    </View>
  );
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface HighlightCardProps {
  variant: 'best' | 'worst';
  rep: RepSummary | undefined;
  title: string;
  iconName: IoniconName;
  accentColor: string;
  accentBackground: string;
  emptyCaption: string;
  testID: string;
}

function HighlightCard({
  variant,
  rep,
  title,
  iconName,
  accentColor,
  accentBackground,
  emptyCaption,
  testID,
}: HighlightCardProps) {
  const hasRep = rep != null;
  const accessibilityLabel = hasRep
    ? variant === 'best'
      ? `Best rep ${rep.index}, FQI ${Math.round(rep.fqi)}`
      : `Needs work: rep ${rep.index}${rep.faults[0] ? `, top fault ${rep.faults[0]}` : ''}`
    : `${title}: ${emptyCaption}`;

  return (
    <View
      style={[styles.card, { backgroundColor: accentBackground, borderColor: accentColor }]}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <View style={styles.header}>
        <Ionicons name={iconName} size={18} color={accentColor} />
        <Text style={[styles.title, { color: accentColor }]}>{title}</Text>
      </View>

      {hasRep ? (
        <>
          <Text style={styles.repLabel} testID={`${testID}-rep-index`}>
            Rep {rep.index}
          </Text>
          {variant === 'best' ? (
            <Text style={styles.repMeta} testID={`${testID}-score`}>
              FQI {Math.round(rep.fqi)}
            </Text>
          ) : (
            <Text style={styles.repMeta} testID={`${testID}-fault`}>
              {rep.faults[0] ?? 'Form dip'}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.emptyText} testID={`${testID}-empty`}>
          {emptyCaption}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  repLabel: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '700',
  },
  repMeta: {
    color: '#C9D7F4',
    fontSize: 14,
  },
  emptyText: {
    color: '#9AACD1',
    fontSize: 13,
    lineHeight: 18,
  },
});
