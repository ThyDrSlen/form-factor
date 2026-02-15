/**
 * ExerciseCard Component
 *
 * Displays an exercise within a workout session, including all its sets
 * and an "Add Set" button.
 */

import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import SetRow from './SetRow';
import type {
  WorkoutSessionExercise,
  WorkoutSessionSet,
  Exercise,
} from '@/lib/types/workout-session';

interface ExerciseCardProps {
  exercise: WorkoutSessionExercise & { exercise?: Exercise };
  sets: WorkoutSessionSet[];
  onAddSet: (sessionExerciseId: string) => void;
  onUpdateSet: (setId: string, fields: Partial<WorkoutSessionSet>) => void;
  onCompleteSet: (setId: string) => void;
  onSetMenuPress: (setId: string) => void;
  onExerciseMenuPress: (sessionExerciseId: string) => void;
  onNotesPress?: (setId: string) => void;
}

function ExerciseCard({
  exercise,
  sets,
  onAddSet,
  onUpdateSet,
  onCompleteSet,
  onSetMenuPress,
  onExerciseMenuPress,
  onNotesPress,
}: ExerciseCardProps) {
  const isTimed = exercise.exercise?.is_timed ?? false;
  const exerciseName = exercise.exercise?.name ?? 'Exercise';

  const handleAddSet = useCallback(() => {
    onAddSet(exercise.id);
  }, [exercise.id, onAddSet]);

  const handleExerciseMenu = useCallback(() => {
    onExerciseMenuPress(exercise.id);
  }, [exercise.id, onExerciseMenuPress]);

  return (
    <View style={styles.exerciseCard}>
      {/* Exercise header */}
      <View style={styles.exerciseHeader}>
        <Text style={styles.exerciseName}>{exerciseName}</Text>
        <TouchableOpacity
          onPress={handleExerciseMenu}
          style={styles.exerciseMenuBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Column headers */}
      <View style={styles.setRowHeader}>
        <View style={{ width: 40 }} />
        <View style={styles.setColumn}>
          <Text style={styles.setRowHeaderLabel}>Lb</Text>
        </View>
        <View style={styles.setColumn}>
          <Text style={styles.setRowHeaderLabel}>{isTimed ? 'Sec' : 'Reps'}</Text>
        </View>
        <View style={styles.setNotesColumn}>
          <Text style={styles.setRowHeaderLabel}>Notes</Text>
        </View>
        <View style={{ width: 62 }} />
      </View>

      {/* Set rows */}
      {sets.map((s, idx) => (
        <SetRow
          key={s.id}
          set={s}
          index={idx}
          isTimed={isTimed}
          onUpdateSet={onUpdateSet}
          onCompleteSet={onCompleteSet}
          onMenuPress={onSetMenuPress}
          onNotesPress={onNotesPress}
        />
      ))}

      {/* Add Set button */}
      <TouchableOpacity style={styles.addSetBtn} onPress={handleAddSet}>
        <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
        <Text style={styles.addSetText}>Add Set</Text>
      </TouchableOpacity>
    </View>
  );
}

export default React.memo(ExerciseCard);
