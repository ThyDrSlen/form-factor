/**
 * ExerciseActionSheet Component
 *
 * Bottom sheet for exercise-level actions: copy, delete.
 */

import React, { useMemo, forwardRef } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';

interface ExerciseActionSheetProps {
  exerciseName: string;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const ExerciseActionSheet = forwardRef<BottomSheet, ExerciseActionSheetProps>(
  ({ exerciseName, onCopy, onDelete, onClose }, ref) => {
    const snapPoints = useMemo(() => ['30%'], []);

    return (
      <BottomSheet
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={onClose}
        backgroundStyle={{ backgroundColor: colors.background }}
        handleIndicatorStyle={{ backgroundColor: colors.textSecondary }}
      >
        <BottomSheetView style={styles.sheetContainer}>
          <View style={{ alignItems: 'flex-end', marginBottom: 8 }}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text
            style={[styles.sheetTitle, { fontSize: 16, fontFamily: 'Lexend_700Bold', color: colors.textPrimary, marginBottom: 16 }]}
          >
            {exerciseName}
          </Text>

          {/* Copy */}
          <TouchableOpacity
            style={[styles.deleteRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}
            onPress={onCopy}
          >
            <Text style={[styles.copyButtonText, { fontSize: 15 }]}>Copy exercise</Text>
            <Ionicons name="copy-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

          {/* Delete */}
          <TouchableOpacity style={styles.deleteRow} onPress={onDelete}>
            <Text style={styles.deleteText}>Delete</Text>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </TouchableOpacity>
        </BottomSheetView>
      </BottomSheet>
    );
  },
);

ExerciseActionSheet.displayName = 'ExerciseActionSheet';
export default ExerciseActionSheet;
