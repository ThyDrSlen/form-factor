import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFaultSynthesis } from '@/hooks/use-fault-synthesis';
import type {
  FaultFrequencyHint,
  FaultSynthesisSetContext,
} from '@/lib/services/fault-explainer';

export interface FaultSynthesisChipProps {
  exerciseId: string;
  faultIds: string[];
  setContext?: FaultSynthesisSetContext;
  recentHistory?: FaultFrequencyHint[];
  /**
   * Minimum confidence required to render. Defaults to 0.3 — above the
   * static fallback floor, below any real-model output so Gemma always
   * passes the gate.
   */
  minConfidence?: number;
  onPress?: (primaryFaultId: string | null) => void;
  testID?: string;
}

const DEFAULT_MIN_CONFIDENCE = 0.3;

/**
 * Synthesized root-cause chip that summarizes a cluster of co-occurring
 * form faults into a single line. Renders above the per-fault glossary
 * chips when the active explainer returns confidence above
 * `minConfidence`. Returns null below the gate so the existing per-fault
 * UI remains the source of truth.
 */
export function FaultSynthesisChip({
  exerciseId,
  faultIds,
  setContext,
  recentHistory,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
  onPress,
  testID,
}: FaultSynthesisChipProps) {
  const { output, status } = useFaultSynthesis({
    exerciseId,
    faultIds,
    setContext,
    recentHistory,
  });

  if (status !== 'ready' || !output) return null;
  if (!output.synthesizedExplanation) return null;
  if (output.confidence < minConfidence) return null;
  if (faultIds.length < 2) return null;

  const iconName =
    output.source === 'gemma-local' || output.source === 'gemma-cloud'
      ? 'sparkles'
      : 'git-merge';

  const content = (
    <View style={styles.chip} testID={testID ?? 'fault-synthesis-chip'}>
      <Ionicons name={iconName} size={13} color="#93C5FD" style={styles.icon} />
      <View style={styles.textBlock}>
        <Text style={styles.label} numberOfLines={3}>
          {output.synthesizedExplanation}
        </Text>
        {output.rootCauseHypothesis ? (
          <Text style={styles.hypothesis} numberOfLines={1}>
            Likely root cause: {output.rootCauseHypothesis}
          </Text>
        ) : null}
      </View>
      {onPress ? (
        <Ionicons name="chevron-forward" size={14} color="#93C5FD" />
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <TouchableOpacity
      onPress={() => onPress(output.primaryFaultId)}
      accessibilityRole="button"
      accessibilityLabel={`Root cause summary: ${output.synthesizedExplanation}`}
      testID={`${testID ?? 'fault-synthesis-chip'}-button`}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0F2540',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  icon: {
    marginTop: 2,
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  label: {
    color: '#E6EEFB',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  hypothesis: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});

export default FaultSynthesisChip;
