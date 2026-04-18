import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import type {
  RepQualityTimeline,
  TimelineSegment,
} from '@/lib/services/rep-quality-timeline';
import RepQualityDot from './RepQualityDot';

export interface RepTimelineCardProps {
  timeline: RepQualityTimeline;
  /** Optional press handler invoked with the segment that was tapped. */
  onSelectSegment?: (segment: TimelineSegment) => void;
  /** Optional header title. Defaults to "Rep timeline". */
  title?: string;
  testID?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function segmentHint(segment: TimelineSegment): string | null {
  switch (segment.type) {
    case 'fault':
      return segment.faults && segment.faults.length > 0
        ? segment.faults.slice(0, 2).join(', ')
        : null;
    case 'tracking-loss':
      return 'tracking lost';
    case 'low-confidence':
      return 'low confidence';
    case 'high-confidence':
      return 'clean rep';
    case 'rep':
    default:
      return null;
  }
}

export default function RepTimelineCard({
  timeline,
  onSelectSegment,
  title = 'Rep timeline',
  testID,
}: RepTimelineCardProps) {
  const hasReps = timeline.summary.totalReps > 0;

  return (
    <View testID={testID} accessible accessibilityRole="summary" style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {hasReps ? (
          <Text style={styles.subtitle}>
            {timeline.summary.totalReps} reps
            {timeline.summary.avgFqi !== null ? ` · avg FQI ${timeline.summary.avgFqi}` : ''}
          </Text>
        ) : null}
      </View>

      {!hasReps ? (
        <Text style={styles.empty}>No reps recorded yet.</Text>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          {timeline.segments.map((segment, index) => {
            const hint = segmentHint(segment);
            const key = `${segment.type}-${segment.repIndex ?? 'x'}-${index}`;
            const body = (
              <View style={styles.row}>
                <RepQualityDot
                  fqi={segment.fqi ?? null}
                  size={10}
                  hasFaults={segment.type === 'fault'}
                  occluded={segment.type === 'tracking-loss'}
                />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{segment.message}</Text>
                  {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
                </View>
                <Text style={styles.rowTime}>{formatTime(segment.ts)}</Text>
              </View>
            );
            if (!onSelectSegment) {
              return (
                <View key={key} style={styles.rowWrapper}>
                  {body}
                </View>
              );
            }
            return (
              <TouchableOpacity
                key={key}
                accessibilityRole="button"
                accessibilityLabel={segment.message}
                onPress={() => onSelectSegment(segment)}
                style={styles.rowWrapper}
              >
                {body}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    backgroundColor: 'rgba(15, 35, 57, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(27, 46, 74, 0.6)',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  empty: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  scroll: {
    maxHeight: 320,
  },
  list: {
    gap: 8,
  },
  rowWrapper: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: '#E5E7EB',
    fontSize: 14,
  },
  rowHint: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },
  rowTime: {
    color: '#9CA3AF',
    fontSize: 12,
    marginLeft: 'auto',
  },
});
