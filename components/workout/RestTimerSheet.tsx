/**
 * RestTimerSheet Component
 *
 * Bottom sheet shown while resting between sets. Displays the countdown,
 * extend buttons, a deliberate SetReady CTA (primary), a quiet Skip
 * affordance (secondary), and a RestActiveRecoveryPanel with breathing
 * + mobility + reflection content tailored to the just-completed set.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { sessionStyles as styles, colors } from '@/styles/workout-session.styles';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { computeRemainingSeconds, formatRestTime } from '@/lib/services/rest-timer';
import { useBetweenSetsCoach } from '@/hooks/use-between-sets-coach';
import { useKeepAwakeSmart } from '@/lib/a11y/useKeepAwakeSmart';
import RestActiveRecoveryPanel from './RestActiveRecoveryPanel';
import SetReadyButton from './SetReadyButton';

/**
 * Best-effort lazy import for the haptic bus. Wrapped in try/catch + delayed
 * require() so that unit tests that don't exercise haptics can stub react-
 * native without pulling in the full bus graph.
 */
function emitRestDoneHaptic(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bus = require('@/lib/haptics/haptic-bus') as {
      hapticBus?: { emit: (event: string) => void };
    };
    bus?.hapticBus?.emit('rest.done');
  } catch {
    /* haptic bus not available in this environment — safe to skip */
  }
}

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
  const haptedForTimerRef = useRef<string | null>(null);
  // Signal that the user has already confirmed the dismissal via the Alert
  // (or the timer hit 0). Without this gate the confirm Alert would
  // re-prompt indefinitely when the sheet's `onClose` fires after a snap-
  // back animation.
  const dismissConfirmedRef = useRef(false);
  // Mirror `remaining` into a ref so the `onClose` handler can read the
  // latest value without re-creating the callback on every tick.
  const remainingRef = useRef(0);
  useEffect(() => {
    remainingRef.current = remaining;
  }, [remaining]);

  useEffect(() => {
    if (!restTimer) {
      setRemaining(0);
      haptedForTimerRef.current = null;
      return;
    }

    const timerKey = `${restTimer.startedAt}-${restTimer.targetSeconds}`;

    const update = () => {
      const r = computeRemainingSeconds(restTimer.startedAt, restTimer.targetSeconds);
      setRemaining((prev) => {
        if (prev !== 0 && r === 0 && haptedForTimerRef.current !== timerKey) {
          haptedForTimerRef.current = timerKey;
          emitRestDoneHaptic();
        }
        return r;
      });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [restTimer]);

  useKeepAwakeSmart('rest-long', remaining > 60);

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
    dismissConfirmedRef.current = true;
    await skipRest();
    onClose();
  };

  const handleSkip = async () => {
    dismissConfirmedRef.current = true;
    await skipRest();
    onClose();
  };

  // Re-open the sheet (after a cancel from the confirm Alert) by snapping the
  // forwarded ref back to the only snap point. Safe when `ref` is a callback
  // ref or null — the optional chain handles both.
  const reopenSheet = useCallback(() => {
    if (typeof ref === 'function') return;
    ref?.current?.snapToIndex(0);
  }, [ref]);

  // Intercept the BottomSheet close callback: if the rest timer is still
  // running and the user dismissed it via a swipe (not the Ready / Skip
  // buttons, which gate on dismissConfirmedRef), confirm the intent before
  // actually clearing session state. Cancel snaps the sheet back open.
  const handleSheetClose = useCallback(() => {
    if (dismissConfirmedRef.current || remainingRef.current <= 0) {
      dismissConfirmedRef.current = false;
      onClose();
      return;
    }
    Alert.alert(
      'Dismiss rest timer?',
      'Your rest timer is still running. Dismiss anyway?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            // Sheet already animated closed — re-snap back so the user
            // doesn't lose an active rest countdown to an accidental swipe.
            reopenSheet();
          },
        },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: () => {
            dismissConfirmedRef.current = true;
            onClose();
          },
        },
      ],
      { cancelable: true, onDismiss: reopenSheet },
    );
  }, [onClose, reopenSheet]);

  const restComplete = remaining <= 0;

  return (
    <BottomSheet
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={handleSheetClose}
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
              accessibilityRole="button"
              accessibilityLabel="Add 15 seconds"
              accessibilityHint="Double tap to extend the rest timer by 15 seconds"
            >
              <Text style={styles.restTimerBtnText}>+15s</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.restTimerBtn}
              onPress={() => extendRest(30)}
              testID="rest-timer-extend-30"
              accessibilityRole="button"
              accessibilityLabel="Add 30 seconds"
              accessibilityHint="Double tap to extend the rest timer by 30 seconds"
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
            accessibilityRole="button"
            accessibilityLabel="Skip rest"
            accessibilityHint="Double tap to end the rest period and move to the next set"
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
