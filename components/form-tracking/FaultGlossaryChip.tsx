import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFaultGlossary } from '@/hooks/use-fault-glossary';

export interface FaultGlossaryChipProps {
  exerciseId: string;
  faultId: string;
  /** Tapped → open the detail view. No-op if not provided. */
  onPress?: (entry: {
    exerciseId: string;
    faultId: string;
    displayName: string;
  }) => void;
  testID?: string;
}

/**
 * A compact chip showing a fault's display name + a "learn more" affordance.
 * Tap opens the glossary detail (callers wire the navigation).
 *
 * Intentionally named `FaultGlossaryChip` — PR #478 adds a differently-
 * scoped `FaultExplanationChip`. Names are separate on purpose.
 */
export function FaultGlossaryChip({
  exerciseId,
  faultId,
  onPress,
  testID,
}: FaultGlossaryChipProps) {
  const entry = useFaultGlossary(exerciseId, faultId);

  const label = entry?.displayName ?? prettifyFaultId(faultId);
  const interactive = Boolean(entry && onPress);

  const content = (
    <View style={styles.chip} testID={testID ?? 'fault-glossary-chip'}>
      <Ionicons name="alert-circle" size={12} color="#F59E0B" />
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      {entry ? (
        <Ionicons name="chevron-forward" size={12} color="#8B97B3" />
      ) : (
        <Text style={styles.missing} testID={`${testID ?? 'fault-glossary-chip'}-missing`}>
          (no entry)
        </Text>
      )}
    </View>
  );

  if (!interactive) return content;

  return (
    <TouchableOpacity
      onPress={() =>
        onPress?.({
          exerciseId,
          faultId,
          displayName: entry!.displayName,
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Learn more about ${label}`}
      testID={`${testID ?? 'fault-glossary-chip'}-button`}
    >
      {content}
    </TouchableOpacity>
  );
}

function prettifyFaultId(faultId: string): string {
  return faultId
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#2A1F0A',
    borderRadius: 999,
    maxWidth: 220,
  },
  label: {
    color: '#FCD34D',
    fontSize: 11,
    fontWeight: '500',
    flexShrink: 1,
  },
  missing: {
    color: '#8B97B3',
    fontSize: 10,
  },
});

export default FaultGlossaryChip;
