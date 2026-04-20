/**
 * FaultExplanationChip
 *
 * Compact chip that displays a detected fault name and, on tap, opens a
 * modal rationale card built from the `fault-explainability` service.
 *
 * Usage:
 *   <FaultExplanationChip
 *     faultId="hips_rise_first"
 *     faultDisplayName="Hips Rise First"
 *     severity={2}
 *     repId={`${setId}:${rep.repNumber}`}
 *     repContext={rep}
 *     workoutId="deadlift"
 *   />
 */
import React, { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useFaultExplanations } from '@/hooks/use-fault-explanations';
import type { RepContext, FaultSeverity } from '@/lib/types/workout-definitions';
import type { FaultExplanation } from '@/lib/services/fault-explainability';

// =============================================================================
// Props
// =============================================================================

export interface FaultExplanationChipProps {
  faultId: string;
  faultDisplayName: string;
  severity: FaultSeverity;
  repId: string;
  repContext: RepContext;
  workoutId: string;
  /** Optional override so hosts can share a single hook instance. */
  getExplanation?: (
    repId: string,
    faultId: string,
    rep: RepContext,
    workoutId: string,
  ) => FaultExplanation;
  testID?: string;
}

// =============================================================================
// Internal helpers
// =============================================================================

function severityTone(severity: FaultSeverity): { bg: string; fg: string } {
  switch (severity) {
    case 3:
      return { bg: '#FF3B3020', fg: '#FF3B30' };
    case 2:
      return { bg: '#FF950020', fg: '#FF9500' };
    default:
      return { bg: '#4C8CFF20', fg: '#4C8CFF' };
  }
}

// =============================================================================
// Component
// =============================================================================

export function FaultExplanationChip({
  faultId,
  faultDisplayName,
  severity,
  repId,
  repContext,
  workoutId,
  getExplanation,
  testID = 'fault-explanation-chip',
}: FaultExplanationChipProps) {
  const [isOpen, setOpen] = useState(false);
  const fallbackHook = useFaultExplanations();
  const resolve = getExplanation ?? fallbackHook.getExplanation;
  const tone = severityTone(severity);

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  // Compute lazily when the modal is opened so closed chips stay cheap.
  const explanation: FaultExplanation | null = isOpen
    ? resolve(repId, faultId, repContext, workoutId)
    : null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${faultDisplayName}, tap to see why`}
        accessibilityHint="Opens a card explaining this form fault"
        onPress={open}
        testID={testID}
        style={[styles.chip, { backgroundColor: tone.bg }]}
      >
        <Ionicons name="alert-circle" size={14} color={tone.fg} />
        <Text style={[styles.chipText, { color: tone.fg }]} numberOfLines={1}>
          {faultDisplayName}
        </Text>
        <Ionicons name="chevron-forward" size={12} color={tone.fg} />
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable
          style={styles.backdrop}
          onPress={close}
          testID={`${testID}-backdrop`}
        >
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <View style={[styles.badge, { backgroundColor: tone.bg }]}>
                <Text style={[styles.badgeText, { color: tone.fg }]}>
                  Rep {explanation?.repNumber ?? repContext.repNumber} •{' '}
                  {severityLabel(severity)}
                </Text>
              </View>
              <Pressable
                onPress={close}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
                testID={`${testID}-close`}
              >
                <Ionicons name="close" size={22} color="#8E8E93" />
              </Pressable>
            </View>

            {explanation ? (
              <ScrollView style={styles.body}>
                <Text style={styles.title}>{explanation.title}</Text>
                <Text style={styles.rationale}>{explanation.rationale}</Text>

                <View style={styles.cueBox}>
                  <Ionicons name="fitness" size={16} color="#4C8CFF" />
                  <Text style={styles.cueText}>{explanation.cue}</Text>
                </View>

                {Object.keys(explanation.metrics).length > 0 ? (
                  <View style={styles.metrics} testID={`${testID}-metrics`}>
                    <Text style={styles.metricsHeader}>Details</Text>
                    {Object.entries(explanation.metrics).map(([k, v]) => (
                      <View key={k} style={styles.metricRow}>
                        <Text style={styles.metricLabel}>
                          {humanizeMetricKey(k)}
                        </Text>
                        <Text style={styles.metricValue}>
                          {formatMetric(k, v)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function severityLabel(sev: FaultSeverity): string {
  if (sev === 3) return 'major';
  if (sev === 2) return 'moderate';
  return 'minor';
}

function humanizeMetricKey(k: string): string {
  // `peakHipDeg` -> `Peak hip`
  const withoutDeg = k.replace(/Deg$|Ms$/g, '');
  const spaced = withoutDeg.replace(/([A-Z])/g, ' $1').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatMetric(key: string, value: number): string {
  if (key.endsWith('Ms')) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  if (!Number.isFinite(value)) return '-';
  return `${Math.round(value * 10) / 10}°`;
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    maxWidth: 220,
  },
  chipText: {
    fontSize: 12,
    fontFamily: 'Lexend_500Medium',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: '#0F2339',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Lexend_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  body: {
    maxHeight: 400,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Lexend_700Bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  rationale: {
    fontSize: 14,
    fontFamily: 'Lexend_400Regular',
    color: '#D1D5DB',
    lineHeight: 20,
    marginBottom: 12,
  },
  cueBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#4C8CFF15',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  cueText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: '#4C8CFF',
    lineHeight: 18,
  },
  metrics: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1B2E4A',
    paddingTop: 12,
  },
  metricsHeader: {
    fontSize: 11,
    fontFamily: 'Lexend_700Bold',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  metricLabel: {
    fontSize: 12,
    fontFamily: 'Lexend_400Regular',
    color: '#8E8E93',
  },
  metricValue: {
    fontSize: 12,
    fontFamily: 'Lexend_500Medium',
    color: '#FFFFFF',
  },
});

export default FaultExplanationChip;
