/**
 * SetActionSheet Component
 *
 * Bottom sheet for set actions: change type, copy, delete.
 */

import React, { useMemo, forwardRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import type { SetType } from '@/lib/types/workout-session';

interface SetActionSheetProps {
  currentSetType: SetType;
  onChangeSetType: (type: SetType) => void;
  onCopyOnce: () => void;
  onCopyMultiple: (count: number) => void;
  onDelete: () => void;
  onClose: () => void;
}

const SET_TYPES: { value: SetType; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'warmup', label: 'Warm up' },
  { value: 'dropset', label: 'Drop set' },
];

const COPY_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

const SetActionSheet = forwardRef<BottomSheet, SetActionSheetProps>(
  ({ currentSetType, onChangeSetType, onCopyOnce, onCopyMultiple, onDelete, onClose }, ref) => {
    const [showCopyPicker, setShowCopyPicker] = useState(false);
    const snapPoints = useMemo(() => ['45%'], []);

    return (
      <BottomSheet
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={() => {
          setShowCopyPicker(false);
          onClose();
        }}
        backgroundStyle={{ backgroundColor: colors.background }}
        handleIndicatorStyle={{ backgroundColor: colors.textSecondary }}
      >
        <BottomSheetView style={styles.sheetContainer}>
          {/* Close button */}
          <View style={{ alignItems: 'flex-end', marginBottom: 8 }}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Set Type */}
          <View style={styles.sheetSection}>
            <Text style={styles.sheetTitle}>Set type</Text>
            <View style={styles.segmentedControl}>
              {SET_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[
                    styles.segmentButton,
                    currentSetType === t.value && styles.segmentButtonActive,
                  ]}
                  onPress={() => onChangeSetType(t.value)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      currentSetType === t.value && styles.segmentTextActive,
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Copy */}
          <View style={styles.sheetSection}>
            <Text style={styles.sheetTitle}>Copy</Text>
            {showCopyPicker ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {COPY_COUNTS.map((n) => (
                  <TouchableOpacity
                    key={n}
                    style={[styles.copyButton, { minWidth: 44 }]}
                    onPress={() => {
                      onCopyMultiple(n);
                      setShowCopyPicker(false);
                    }}
                  >
                    <Text style={styles.copyButtonText}>{n}×</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.copyButton, { minWidth: 44 }]}
                  onPress={() => setShowCopyPicker(false)}
                >
                  <Text style={[styles.copyButtonText, { color: colors.textSecondary }]}>Back</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.copyRow}>
                <TouchableOpacity style={styles.copyButton} onPress={onCopyOnce}>
                  <Ionicons name="copy-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.copyButtonText}>Once</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={() => setShowCopyPicker(true)}
                >
                  <Ionicons name="copy-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.copyButtonText}>Multiple times</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

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

SetActionSheet.displayName = 'SetActionSheet';
export default SetActionSheet;
