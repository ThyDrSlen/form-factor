/**
 * RestTimerSheet Component
 *
 * Bottom sheet showing the rest timer countdown with skip, +15s, +30s buttons
 * and a "next up" preview.
 */

import React, { useEffect, useMemo, useState, forwardRef } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { computeRemainingSeconds, formatRestTime } from '@/lib/services/rest-timer';

interface RestTimerSheetProps {
  onClose: () => void;
}

const RestTimerSheet = forwardRef<BottomSheet, RestTimerSheetProps>(({ onClose }, ref) => {
  const snapPoints = useMemo(() => ['50%'], []);
  const restTimer = useSessionRunner((s) => s.restTimer);
  const skipRest = useSessionRunner((s) => s.skipRest);
  const extendRest = useSessionRunner((s) => s.extendRest);
  const exercises = useSessionRunner((s) => s.exercises);
  const sets = useSessionRunner((s) => s.sets);

  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!restTimer) {
      setRemaining(0);
      return;
    }

    const update = () => {
      const r = computeRemainingSeconds(restTimer.startedAt, restTimer.targetSeconds);
      setRemaining(r);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [restTimer]);

  // Find next set info
  let nextUpText = '';
  if (restTimer) {
    for (const ex of exercises) {
      const exSets = sets[ex.id] ?? [];
      const completedSetIdx = exSets.findIndex((s) => s.id === restTimer.setId);
      if (completedSetIdx >= 0 && completedSetIdx < exSets.length - 1) {
        nextUpText = `${ex.exercise?.name ?? 'Exercise'} - Set ${completedSetIdx + 2}`;
        break;
      }
      // If last set in this exercise, check next exercise
      if (completedSetIdx === exSets.length - 1) {
        const exIdx = exercises.indexOf(ex);
        if (exIdx < exercises.length - 1) {
          const nextEx = exercises[exIdx + 1];
          nextUpText = `${nextEx.exercise?.name ?? 'Exercise'} - Set 1`;
          break;
        }
      }
    }
  }

  const handleSkip = async () => {
    await skipRest();
    onClose();
  };

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
        <View style={styles.restTimerContainer}>
          {/* Countdown */}
          <Text style={styles.restTimerDisplay}>
            {remaining > 0 ? formatRestTime(remaining) : '0:00'}
          </Text>
          <Text style={styles.restTimerLabel}>
            {remaining > 0 ? 'Rest Time' : 'Rest Complete'}
          </Text>

          {/* Extend buttons */}
          <View style={styles.restTimerButtons}>
            <TouchableOpacity
              style={styles.restTimerBtn}
              onPress={() => extendRest(15)}
            >
              <Text style={styles.restTimerBtnText}>+15s</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.restTimerBtn}
              onPress={() => extendRest(30)}
            >
              <Text style={styles.restTimerBtnText}>+30s</Text>
            </TouchableOpacity>
          </View>

          {/* Skip button */}
          <TouchableOpacity style={styles.restTimerSkipBtn} onPress={handleSkip}>
            <Text style={styles.restTimerSkipText}>Skip</Text>
          </TouchableOpacity>

          {/* Next up */}
          {nextUpText ? (
            <View style={styles.nextUpContainer}>
              <Text style={styles.nextUpLabel}>Next up</Text>
              <Text style={styles.nextUpText}>{nextUpText}</Text>
            </View>
          ) : null}
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
});

RestTimerSheet.displayName = 'RestTimerSheet';
export default RestTimerSheet;
