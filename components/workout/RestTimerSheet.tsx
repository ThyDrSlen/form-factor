/**
 * RestTimerSheet Component
 *
 * Bottom sheet shown while resting between sets. Displays the countdown,
 * extend buttons, a deliberate SetReady CTA (primary), a quiet Skip
 * affordance (secondary), and a RestActiveRecoveryPanel with breathing
 * + mobility + reflection content tailored to the just-completed set.
 */

import React, { useEffect, useMemo, useState, forwardRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { computeRemainingSeconds, formatRestTime } from '@/lib/services/rest-timer';
import { useBetweenSetsCoach } from '@/hooks/use-between-sets-coach';
import RestActiveRecoveryPanel from './RestActiveRecoveryPanel';
import SetReadyButton from './SetReadyButton';

interface RestTimerSheetProps {
  onClose: () => void;
}

const RestTimerSheet = forwardRef<BottomSheet, RestTimerSheetProps>(({ onClose }, ref) => {
  const snapPoints = useMemo(() => ['85%'], []);
  const restTimer = useSessionRunner((s) => s.restTimer);
  const skipRest = useSessionRunner((s) => s.skipRest);
  const extendRest = useSessionRunner((s) => s.extendRest);
  const exercises = useSessionRunner((s) => s.exercises);
  const sets = useSessionRunner((s) => s.sets);

  const { recommendation, refresh } = useBetweenSetsCoach();
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

  let nextUpText = '';
  if (restTimer) {
    for (const ex of exercises) {
      const exSets = sets[ex.id] ?? [];
      const completedSetIdx = exSets.findIndex((s) => s.id === restTimer.setId);
      if (completedSetIdx >= 0 && completedSetIdx < exSets.length - 1) {
        nextUpText = `${ex.exercise?.name ?? 'Exercise'} - Set ${completedSetIdx + 2}`;
        break;
      }
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

  const handleReady = async () => {
    await skipRest();
    onClose();
  };

  const handleSkip = async () => {
    await skipRest();
    onClose();
  };

  const restComplete = remaining <= 0;

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
      <BottomSheetScrollView contentContainerStyle={sheetStyles.scrollContent}>
        <View style={styles.restTimerContainer} testID="rest-timer-sheet">
          <Text style={styles.restTimerDisplay} testID="rest-timer-display">
            {remaining > 0 ? formatRestTime(remaining) : '0:00'}
          </Text>
          <Text style={styles.restTimerLabel}>
            {remaining > 0 ? 'Rest Time' : 'Rest Complete'}
          </Text>

          <View style={styles.restTimerButtons}>
            <TouchableOpacity
              style={styles.restTimerBtn}
              onPress={() => extendRest(15)}
              testID="rest-timer-extend-15"
            >
              <Text style={styles.restTimerBtnText}>+15s</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.restTimerBtn}
              onPress={() => extendRest(30)}
              testID="rest-timer-extend-30"
            >
              <Text style={styles.restTimerBtnText}>+30s</Text>
            </TouchableOpacity>
          </View>

          <View style={sheetStyles.primaryActionRow}>
            <SetReadyButton onReady={handleReady} restComplete={restComplete} />
          </View>

          <TouchableOpacity
            style={sheetStyles.skipLinkButton}
            onPress={handleSkip}
            testID="rest-timer-skip"
          >
            <Text style={sheetStyles.skipLinkText}>Skip rest</Text>
          </TouchableOpacity>

          {nextUpText ? (
            <View style={styles.nextUpContainer}>
              <Text style={styles.nextUpLabel}>Next up</Text>
              <Text style={styles.nextUpText}>{nextUpText}</Text>
            </View>
          ) : null}
        </View>

        <View style={sheetStyles.panelContainer}>
          <RestActiveRecoveryPanel recommendation={recommendation} onRefresh={refresh} />
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

const sheetStyles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 16,
  },
  primaryActionRow: {
    marginTop: 12,
    width: '100%',
  },
  skipLinkButton: {
    marginTop: 8,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  skipLinkText: {
    fontFamily: 'Lexend_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  panelContainer: {
    marginTop: 4,
  },
});

RestTimerSheet.displayName = 'RestTimerSheet';
export default RestTimerSheet;
