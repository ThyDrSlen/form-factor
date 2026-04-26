/**
 * ExerciseSwapSheet
 *
 * Bottom sheet surfaced from the scan overlay when the user picks a
 * different detection mode mid-session. Asks whether to
 *   - Add the new exercise to the active session, or
 *   - Replace the current session_exercise.
 *
 * Implemented as a plain overlay Modal so it works on web + iOS
 * without BottomSheet state juggling.
 *
 * WAVE-35 FOLLOW-UP: wire the exercise-swap-explainer Gemma surface
 * so the sheet can render a 2-3 sentence plain-language explanation of
 * the swap below the action buttons. Example integration inside a
 * parent screen (wire from whoever mounts this sheet):
 *
 *   import { explainExerciseSwap } from '@/lib/services/exercise-swap-explainer';
 *
 *   // When `targetExerciseName` or `currentExerciseName` changes:
 *   const [swapCopy, setSwapCopy] = useState<string | null>(null);
 *   useEffect(() => {
 *     if (!visible || !currentExerciseName) return;
 *     let cancelled = false;
 *     explainExerciseSwap({
 *       fromExerciseId: currentExerciseName,
 *       toExerciseId: targetExerciseName,
 *       reason: 'variation',
 *     }).then((r) => { if (!cancelled) setSwapCopy(r.explanation); });
 *     return () => { cancelled = true; };
 *   }, [visible, currentExerciseName, targetExerciseName]);
 *
 * The service never throws (falls back to a generic string on any
 * Gemma failure) so the parent doesn't need error handling.
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

interface ExerciseSwapSheetProps {
  visible: boolean;
  targetExerciseName: string;
  currentExerciseName?: string | null;
  onDismiss: () => void;
  onConfirm: (action: 'append' | 'replace') => void;
  testID?: string;
}

export function ExerciseSwapSheet({
  visible,
  targetExerciseName,
  currentExerciseName,
  onDismiss,
  onConfirm,
  testID,
}: ExerciseSwapSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      testID={testID ?? 'exercise-swap-sheet'}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" />
      <View
        style={styles.sheet}
        accessibilityRole={'menu' as AccessibilityRole}
        accessibilityLabel={`Swap exercise to ${targetExerciseName}`}
      >
        <View style={styles.handle} />
        <Text style={styles.title}>Swap to {targetExerciseName}</Text>
        {currentExerciseName ? (
          <Text style={styles.subtitle}>Currently tracking {currentExerciseName}</Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
          onPress={() => onConfirm('append')}
          accessibilityRole="button"
          testID={`${testID ?? 'exercise-swap-sheet'}-add`}
        >
          <Text style={styles.btnPrimaryText}>Add to session</Text>
          <Text style={styles.btnSubText}>Keep {currentExerciseName ?? 'current'} and add a new block</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
          onPress={() => onConfirm('replace')}
          accessibilityRole="button"
          testID={`${testID ?? 'exercise-swap-sheet'}-replace`}
        >
          <Text style={styles.btnSecondaryText}>Replace current</Text>
          <Text style={styles.btnSubText}>Drop {currentExerciseName ?? 'the current exercise'} and switch</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
          onPress={onDismiss}
          accessibilityRole="button"
          testID={`${testID ?? 'exercise-swap-sheet'}-cancel`}
        >
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
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
  btnPrimary: {
    backgroundColor: '#4C8CFF',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: 'rgba(255, 110, 110, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 110, 110, 0.35)',
  },
  btnSecondaryText: {
    color: '#FF9E9E',
    fontSize: 15,
    fontWeight: '700',
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnGhostText: {
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

export default ExerciseSwapSheet;
