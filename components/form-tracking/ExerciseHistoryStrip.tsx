/**
 * ExerciseHistoryStrip
 *
 * Horizontal strip of 3 chips rendered above the FQI gauge showing:
 *   1. Last session (sets x reps, top weight)
 *   2. Rolling 5-session avg FQI
 *   3. Personal best reps / volume
 *
 * Non-interactive. Renders null if the summary has no data, so a brand
 * new user never sees empty chips.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type AccessibilityRole } from 'react-native';
import type { ExerciseHistorySummary } from '@/lib/services/exercise-history';

interface ExerciseHistoryStripProps {
  summary: ExerciseHistorySummary;
  exerciseDisplayName?: string;
  testID?: string;
}

interface Chip {
  key: string;
  icon: string;
  label: string;
  value: string;
  a11y: string;
}

export function ExerciseHistoryStrip({
  summary,
  exerciseDisplayName,
  testID,
}: ExerciseHistoryStripProps) {
  const chips = useMemo(() => buildChips(summary, exerciseDisplayName), [summary, exerciseDisplayName]);
  if (chips.length === 0) return null;

  return (
    <View
      style={styles.container}
      testID={testID ?? 'exercise-history-strip'}
      accessibilityRole={'summary' as AccessibilityRole}
      accessibilityLabel={`Exercise history. ${chips.map((c) => c.a11y).join('. ')}`}
    >
      {chips.map((chip) => (
        <View key={chip.key} style={styles.chip} testID={`${testID ?? 'exercise-history-strip'}-${chip.key}`}>
          <Text style={styles.chipIcon}>{chip.icon}</Text>
          <View style={styles.chipText}>
            <Text style={styles.chipLabel}>{chip.label}</Text>
            <Text style={styles.chipValue} numberOfLines={1}>
              {chip.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function buildChips(summary: ExerciseHistorySummary, exerciseDisplayName?: string): Chip[] {
  const chips: Chip[] = [];
  const { lastSession, last5SessionsAvgFqi, maxReps, maxVolume } = summary;

  if (lastSession) {
    const weightPart =
      lastSession.topWeightLb != null ? ` @ ${formatWeight(lastSession.topWeightLb)}` : '';
    const value = `${lastSession.sets}×${lastSession.totalReps}${weightPart}`;
    const daysAgo = formatRelativeDays(lastSession.endedAt);
    chips.push({
      key: 'last-session',
      icon: '•',
      label: daysAgo ? `Last · ${daysAgo}` : 'Last session',
      value,
      a11y: `Last session ${daysAgo ?? ''} ${lastSession.sets} sets ${lastSession.totalReps} reps${weightPart}`.trim(),
    });
  }

  if (last5SessionsAvgFqi != null) {
    chips.push({
      key: 'avg-fqi',
      icon: '◆',
      label: 'Avg FQI',
      value: `${Math.round(last5SessionsAvgFqi)}`,
      a11y: `Average form quality index over last 5 sessions: ${Math.round(last5SessionsAvgFqi)}`,
    });
  }

  if (maxReps != null || maxVolume != null) {
    const pieces: string[] = [];
    if (maxReps != null) pieces.push(`${maxReps} reps`);
    if (maxVolume != null) pieces.push(`${formatVolume(maxVolume)}`);
    chips.push({
      key: 'personal-best',
      icon: '★',
      label: exerciseDisplayName ? `${exerciseDisplayName} PR` : 'Personal best',
      value: pieces.join(' · '),
      a11y: `Personal best ${pieces.join(' and ')}`,
    });
  }

  return chips;
}

function formatWeight(lb: number): string {
  if (!Number.isFinite(lb)) return '';
  return `${Math.round(lb)} lb`;
}

function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value >= 1000) return `${Math.round(value / 100) / 10}k lb`;
  return `${Math.round(value)} lb`;
}

function formatRelativeDays(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) return 'just now';
  const days = Math.floor(deltaMs / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(12, 18, 36, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  chipIcon: {
    color: '#6FA4FF',
    fontSize: 12,
  },
  chipText: {
    flexDirection: 'column',
  },
  chipLabel: {
    color: 'rgba(220, 228, 245, 0.7)',
    fontSize: 10,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  chipValue: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default ExerciseHistoryStrip;
