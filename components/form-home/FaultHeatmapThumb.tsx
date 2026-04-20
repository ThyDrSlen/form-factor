import React, { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export interface FaultCell {
  /** Day label (e.g. "Mon", "4/11"). */
  dayLabel: string;
  /** Fault identifier ("knees_in", "butt_wink"). */
  faultId: string;
  /** How many times the fault fired on that day. */
  count: number;
}

export interface FaultHeatmapThumbProps {
  /** Raw cells. The component picks the top 3 fault IDs by total count. */
  cells: FaultCell[];
  /** 7 day labels in the order you want them rendered (earliest -> today). */
  days: string[];
  onPress?: () => void;
}

const HEAT_STEPS = [
  'rgba(76, 140, 255, 0.00)',
  'rgba(255, 92, 92, 0.25)',
  'rgba(255, 92, 92, 0.45)',
  'rgba(255, 92, 92, 0.65)',
  'rgba(255, 92, 92, 0.85)',
];

function bucket(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  const ratio = count / max;
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.55) return 3;
  if (ratio >= 0.3) return 2;
  return 1;
}

function titleizeFaultId(id: string): string {
  return id.replace(/_/g, ' ');
}

export function FaultHeatmapThumb({ cells, days, onPress }: FaultHeatmapThumbProps) {
  const { topFaults, matrix, maxCount } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of cells) {
      totals.set(c.faultId, (totals.get(c.faultId) ?? 0) + c.count);
    }
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    let max = 0;
    const lookup = new Map<string, number>();
    for (const c of cells) {
      if (!top.includes(c.faultId)) continue;
      const key = `${c.faultId}::${c.dayLabel}`;
      lookup.set(key, c.count);
      if (c.count > max) max = c.count;
    }
    return { topFaults: top, matrix: lookup, maxCount: max };
  }, [cells]);

  const isEmpty = cells.length === 0 || topFaults.length === 0;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Fault heatmap, tap to expand"
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.85}
      style={styles.card}
      testID="fault-heatmap-thumb"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Top faults (7d)</Text>
        {onPress && <Text style={styles.expandLabel}>Expand</Text>}
      </View>

      {isEmpty ? (
        <Text style={styles.emptyText} testID="fault-heatmap-empty">
          No faults detected — or no sessions logged in the last 7 days.
        </Text>
      ) : (
        <View style={styles.grid}>
          <View style={styles.daysRow}>
            <View style={styles.rowLabelSpacer} />
            {days.map((day) => (
              <Text key={day} style={styles.dayLabel}>
                {day}
              </Text>
            ))}
          </View>
          {topFaults.map((faultId) => (
            <View key={faultId} style={styles.faultRow}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {titleizeFaultId(faultId)}
              </Text>
              {days.map((day) => {
                const key = `${faultId}::${day}`;
                const count = matrix.get(key) ?? 0;
                const step = bucket(count, maxCount);
                return (
                  <View
                    key={day}
                    testID={`fault-cell-${faultId}-${day}`}
                    style={[styles.cell, { backgroundColor: HEAT_STEPS[step] }]}
                  />
                );
              })}
            </View>
          ))}
        </View>
      )}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#F5F7FF',
    fontSize: 16,
    fontWeight: '600',
  },
  expandLabel: {
    color: '#4C8CFF',
    fontSize: 12,
    fontWeight: '500',
  },
  grid: {
    gap: 6,
  },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowLabelSpacer: {
    width: 84,
  },
  rowLabel: {
    color: '#97A3C2',
    fontSize: 11,
    width: 84,
  },
  dayLabel: {
    color: '#6781A6',
    fontSize: 10,
    flexGrow: 1,
    textAlign: 'center',
  },
  faultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cell: {
    flexGrow: 1,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 92, 92, 0.08)',
  },
  emptyText: {
    color: '#97A3C2',
    fontSize: 13,
  },
});
