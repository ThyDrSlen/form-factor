/**
 * ExitMidSessionSheet
 *
 * Triple-choice confirmation shown when the user tries to leave Analyze
 * mid-session (still tracking or past calibration). Prevents a silent
 * data-loss and gives the user a low-friction "save a note" escape hatch.
 *
 * Actions:
 *   - Discard (destructive, primary)
 *   - Save snapshot (secondary, preserves rep count + FQI + faults)
 *   - Cancel (tertiary, keeps tracking)
 *
 * Rendered as a plain Modal overlay so it works on web + iOS without
 * BottomSheet state juggling (matches ExerciseSwapSheet pattern).
 */
import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
} from 'react-native';

export interface ExitMidSessionSheetProps {
  visible: boolean;
  exerciseDisplayName?: string | null;
  repCount: number;
  currentFqi?: number | null;
  onDiscard: () => void;
  onSaveSnapshot: () => void;
  onCancel: () => void;
  testID?: string;
}

export function ExitMidSessionSheet({
  visible,
  exerciseDisplayName,
  repCount,
  currentFqi,
  onDiscard,
  onSaveSnapshot,
  onCancel,
  testID,
}: ExitMidSessionSheetProps) {
  const resolvedTestID = testID ?? 'exit-mid-session-sheet';
  const subtitle = buildSubtitle(repCount, currentFqi, exerciseDisplayName ?? null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID={resolvedTestID}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Dismiss exit prompt"
      />
      <View
        style={styles.sheet}
        accessibilityRole={'menu' as AccessibilityRole}
        accessibilityLabel="Discard session or save a snapshot"
      >
        <View style={styles.handle} />
        <Text style={styles.title}>Leave this session?</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnDiscard, pressed && styles.pressed]}
          onPress={onDiscard}
          accessibilityRole="button"
          accessibilityLabel="Discard session"
          testID={`${resolvedTestID}-discard`}
        >
          <Text style={styles.btnDiscardText}>Discard session</Text>
          <Text style={styles.btnSubText}>Exit without saving anything</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnSnapshot, pressed && styles.pressed]}
          onPress={onSaveSnapshot}
          accessibilityRole="button"
          accessibilityLabel="Save a snapshot"
          testID={`${resolvedTestID}-save-snapshot`}
        >
          <Text style={styles.btnSnapshotText}>Save snapshot</Text>
          <Text style={styles.btnSubText}>Keep a note with your rep count + form score</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnCancel, pressed && styles.pressed]}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          testID={`${resolvedTestID}-cancel`}
        >
          <Text style={styles.btnCancelText}>Keep tracking</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function buildSubtitle(
  repCount: number,
  currentFqi: number | null | undefined,
  exerciseDisplayName: string | null,
): string | null {
  const exercisePart = exerciseDisplayName ? exerciseDisplayName : null;
  const repsPart = repCount > 0 ? `${repCount} rep${repCount === 1 ? '' : 's'}` : null;
  const fqiPart =
    currentFqi != null && !Number.isNaN(currentFqi)
      ? `FQI ${Math.round(currentFqi)}`
      : null;
  const parts = [exercisePart, repsPart, fqiPart].filter((s): s is string => Boolean(s));
  return parts.length ? parts.join(' · ') : null;
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0D1530',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 36,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 12,
  },
  title: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(220, 228, 245, 0.7)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 10,
  },
  btnDiscard: {
    backgroundColor: 'rgba(255, 110, 110, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 110, 110, 0.45)',
  },
  btnDiscardText: {
    color: '#FF9E9E',
    fontSize: 15,
    fontWeight: '700',
  },
  btnSnapshot: {
    backgroundColor: '#4C8CFF',
  },
  btnSnapshotText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  btnCancel: {
    backgroundColor: 'transparent',
  },
  btnCancelText: {
    color: 'rgba(220, 228, 245, 0.7)',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  btnSubText: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 12,
    marginTop: 3,
  },
  pressed: {
    opacity: 0.75,
  },
});

export default ExitMidSessionSheet;
