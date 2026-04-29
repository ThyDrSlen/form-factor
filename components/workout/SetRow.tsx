/**
 * SetRow Component
 *
 * Displays a single set within an exercise card with inline editing
 * for weight, reps/time, and notes. Includes a completion checkbox
 * that triggers the rest timer.
 */

import React, { useCallback } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import type { WorkoutSessionSet, SetType } from '@/lib/types/workout-session';

interface SetRowProps {
  set: WorkoutSessionSet;
  index: number;
  isTimed: boolean;
  onUpdateSet: (setId: string, fields: Partial<WorkoutSessionSet>) => void;
  onCompleteSet: (setId: string) => void;
  onMenuPress: (setId: string) => void;
  onNotesPress?: (setId: string) => void;
  /**
   * If the form-tracking rep detector observed a rep count for this set,
   * pass it here. When the user's manual `actual_reps` edit diverges by
   * more than one rep from the detector, we render a subtle warning
   * ("Detector counted N reps") under the Reps field. Optional — callers
   * that don't have a detector reading should leave this undefined and
   * the feature degrades gracefully.
   */
  detectedReps?: number;
}

const SET_TYPE_COLORS: Record<SetType, string> = {
  normal: colors.accent,
  warmup: colors.warmup,
  dropset: colors.dropset,
  amrap: colors.amrap,
  failure: colors.error,
  timed: colors.restActive,
};

function SetRow({
  set,
  index,
  isTimed,
  onUpdateSet,
  onCompleteSet,
  onMenuPress,
  onNotesPress,
  detectedReps,
}: SetRowProps) {
  const isCompleted = !!set.completed_at;
  const circleColor = SET_TYPE_COLORS[set.set_type] || colors.accent;

  // Show a divergence hint when the user has manually edited `actual_reps`
  // to a value that differs from the detector's observation by more than
  // one rep. The one-rep deadband swallows the off-by-one noise typical of
  // rep detectors and only surfaces meaningful mismatches.
  const detectorDivergence =
    !isTimed &&
    typeof detectedReps === 'number' &&
    Number.isFinite(detectedReps) &&
    typeof set.actual_reps === 'number' &&
    Number.isFinite(set.actual_reps) &&
    Math.abs(set.actual_reps - detectedReps) > 1
      ? detectedReps
      : null;

  const handleWeightChange = useCallback(
    (text: string) => {
      const val = text ? parseFloat(text) : null;
      onUpdateSet(set.id, { actual_weight: val });
    },
    [set.id, onUpdateSet],
  );

  const handleRepsChange = useCallback(
    (text: string) => {
      const val = text ? parseInt(text, 10) : null;
      if (isTimed) {
        onUpdateSet(set.id, { actual_seconds: val });
      } else {
        onUpdateSet(set.id, { actual_reps: val });
      }
    },
    [set.id, isTimed, onUpdateSet],
  );

  const handleCheckbox = useCallback(() => {
    if (!isCompleted) {
      onCompleteSet(set.id);
    }
  }, [set.id, isCompleted, onCompleteSet]);

  return (
    <View style={[styles.setRow, isCompleted && styles.setRowCompleted]}>
      {/* Set number circle */}
      <View style={[styles.setNumberCircle, { backgroundColor: circleColor }]}>
        <Text style={styles.setNumberText}>{index + 1}</Text>
      </View>

      {/* Weight column */}
      <View style={styles.setColumn}>
        <Text style={styles.setColumnLabel}>Lb</Text>
        <TextInput
          style={styles.setInput}
          value={
            set.actual_weight != null
              ? String(set.actual_weight)
              : set.planned_weight != null
              ? String(set.planned_weight)
              : ''
          }
          onChangeText={handleWeightChange}
          keyboardType="numeric"
          placeholder="-"
          placeholderTextColor={colors.textSecondary}
          editable={!isCompleted}
          selectTextOnFocus
        />
      </View>

      {/* Reps or Time column */}
      <View style={styles.setColumn}>
        <Text style={styles.setColumnLabel}>{isTimed ? 'Sec' : 'Reps'}</Text>
        <TextInput
          style={styles.setInput}
          value={
            isTimed
              ? set.actual_seconds != null
                ? String(set.actual_seconds)
                : set.planned_seconds != null
                ? String(set.planned_seconds)
                : ''
              : set.actual_reps != null
              ? String(set.actual_reps)
              : set.planned_reps != null
              ? String(set.planned_reps)
              : ''
          }
          onChangeText={handleRepsChange}
          keyboardType="numeric"
          placeholder="-"
          placeholderTextColor={colors.textSecondary}
          editable={!isCompleted}
          selectTextOnFocus
        />
        {detectorDivergence != null ? (
          <Text
            style={detectorDivergenceStyle}
            numberOfLines={1}
            accessibilityLabel={`Detector counted ${detectorDivergence} reps`}
            testID="set-row-detector-divergence"
          >
            Detector: {detectorDivergence}
          </Text>
        ) : null}
      </View>

      {/* Notes column */}
      <View style={styles.setNotesColumn}>
        <Text style={styles.setColumnLabel}>Notes</Text>
        {onNotesPress ? (
          <TouchableOpacity
            onPress={() => onNotesPress(set.id)}
            style={{ flex: 1 }}
            activeOpacity={0.7}
          >
            <Text style={styles.setNotesText} numberOfLines={1}>
              {set.notes || '-'}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.setNotesText} numberOfLines={1}>
            {set.notes || '-'}
          </Text>
        )}
      </View>

      {/* Menu button */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onMenuPress(set.id)}
        style={{ padding: 4, marginLeft: 4 }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      {/* Completion checkbox */}
      <TouchableOpacity
        style={[styles.checkbox, isCompleted && styles.checkboxChecked]}
        onPress={handleCheckbox}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {isCompleted && <Ionicons name="checkmark" size={18} color="#fff" />}
      </TouchableOpacity>
    </View>
  );
}

const detectorDivergenceStyle = StyleSheet.create({
  hint: {
    fontFamily: 'Lexend_400Regular',
    fontSize: 10,
    color: colors.warmup,
    marginTop: 2,
  },
}).hint;

export default React.memo(SetRow);
