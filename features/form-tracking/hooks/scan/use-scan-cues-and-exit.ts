import { useCallback, useEffect, useMemo } from 'react';
import { getWorkoutByMode, getPhaseStaticCue } from '@/lib/workouts';
import { warnWithTs, logWithTs } from '@/lib/logger';
import { saveSessionSnapshot } from '@/lib/services/session-snapshot';
import { LayoutChangeEvent, Animated } from 'react-native';
import { BaseUploadMetrics } from '@/features/form-tracking/hooks/scan/scan-constants';
import type { ScanTrackingLifecycleCtx } from '@/features/form-tracking/hooks/scan/use-scan-tracking-lifecycle';

export function useScanCuesAndExit(ctx: ScanTrackingLifecycleCtx) {
  const {
    DEV, activeMetrics, activePhase, activePhaseRef, activeWorkoutDef, addWorkoutRepCue,
    audioFeedbackEnabled, baselineDebugEnabledRef, baselineDebugMetricsRef,
    cueHysteresisControllerRef, cueHysteresisLastTickRef, cueRotatorRef, detectionMode,
    fixturePlaybackEnabled, fixturePlaybackFramesProcessed, isTracking, jointAngles,
    lastSpokenCueRef, overlayLayout, pose, repCount, router, sessionFqiScoresRef, sessionIdRef,
    sessionStartRef, setIsExitMidSessionSheetVisible, speakCue, stablePrimaryCueRef,
    stopTracking, textOpacity,
  } = ctx;

  // ---------------------------------------------------------------------
  // Mid-session exit flow (#494)
  //
  // When the user taps the close button while tracking is live, we show
  // a three-choice Modal: Discard / Save snapshot / Cancel. This guards
  // against accidental loss of a session in progress — especially when
  // the app has been running ARKit for a while and we have rep/FQI data
  // that would otherwise vanish into the void on back-nav.
  // ---------------------------------------------------------------------
  const computeAverageFqi = useCallback((): number | null => {
    const scores = sessionFqiScoresRef.current;
    if (!scores.length) return null;
    const sum = scores.reduce((acc, v) => acc + v, 0);
    return sum / scores.length;
  }, [sessionFqiScoresRef]);

  const isMidSession = useCallback((): boolean => {
    if (!isTracking) return false;
    const initialPhase = getWorkoutByMode(detectionMode).initialPhase;
    return repCount > 0 || activePhaseRef.current !== initialPhase;
  }, [isTracking, detectionMode, repCount, activePhaseRef]);

  const handleCloseScan = useCallback(() => {
    if (isMidSession()) {
      setIsExitMidSessionSheetVisible(true);
      return;
    }
    router.replace('/(tabs)/form');
  }, [isMidSession, router, setIsExitMidSessionSheetVisible]);

  const handleExitDiscard = useCallback(async () => {
    setIsExitMidSessionSheetVisible(false);
    try {
      await stopTracking();
    } catch (error) {
      if (DEV) warnWithTs('[ScanARKit] stopTracking during discard failed', error);
    }
    router.replace('/(tabs)/form');
  }, [setIsExitMidSessionSheetVisible, router, stopTracking, DEV]);

  const handleExitSaveSnapshot = useCallback(async () => {
    setIsExitMidSessionSheetVisible(false);
    const avgFqi = computeAverageFqi();
    try {
      await saveSessionSnapshot({
        exerciseKey: detectionMode,
        repCount,
        currentFqi: avgFqi,
        startedAt: sessionStartRef.current,
        sessionId: sessionIdRef.current,
      });
    } catch (error) {
      if (DEV) warnWithTs('[ScanARKit] saveSessionSnapshot failed', error);
    }
    try {
      await stopTracking();
    } catch (error) {
      if (DEV) warnWithTs('[ScanARKit] stopTracking during save failed', error);
    }
    router.replace('/(tabs)/form');
  }, [setIsExitMidSessionSheetVisible, computeAverageFqi, router, detectionMode, repCount, sessionStartRef, sessionIdRef, DEV, stopTracking]);

  const handleExitCancel = useCallback(() => {
    setIsExitMidSessionSheetVisible(false);
  }, [setIsExitMidSessionSheetVisible]);

  const handleOverlayLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    overlayLayout.current = { width, height };
    if (__DEV__) {
      logWithTs(`[ScanARKit] Overlay layout: ${width.toFixed(1)}x${height.toFixed(1)} (compare with native ARView bounds)`);
    }
  }, [overlayLayout]);

  const openWorkoutInsights = useCallback(() => {
    const sessionId = encodeURIComponent(sessionIdRef.current);
    router.push(`/(modals)/workout-insights?sessionId=${sessionId}`);
  }, [router, sessionIdRef]);

  // Fade out text after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(textOpacity, {
        toValue: 0,
        duration: 1000,
        useNativeDriver: true,
      }).start();
    }, 5000);

    return () => clearTimeout(timer);
  }, [textOpacity]);

  // Analyze form and provide feedback
  const analyzeForm = useCallback(() => {
    if (!jointAngles) return null;

    const messages: string[] = [];

    if (!activeMetrics) {
      messages.push('Move fully into frame so we can track your movement.');
      return messages;
    }

    const phaseCue = getPhaseStaticCue(activeWorkoutDef, activePhase);
    if (phaseCue) {
      messages.push(phaseCue);
    }

	    if (!activeMetrics.armsTracked || activeMetrics.wristsTracked === false) {
	      messages.push('Keep both hands and elbows visible to the camera.');
	      return messages;
	    }

	    const realtimeCues = activeWorkoutDef.ui?.getRealtimeCues?.({
	      phaseId: activePhase,
	      metrics: activeMetrics as never,
	    });
	    if (realtimeCues?.length) {
	      messages.push(...realtimeCues);
	    }

	    return messages.length ? messages : null;
	  }, [jointAngles, activeMetrics, activePhase, activeWorkoutDef]);

	    const feedback = useMemo(() => analyzeForm(), [analyzeForm]);
	    const orderedActiveCues = useMemo(
	      () => feedback?.filter((cue): cue is string => !!cue) ?? [],
	      [feedback]
	    );
	    const poseTimestamp = pose?.timestamp ?? null;
	    const primaryCue = useMemo(() => {
	      if (!isTracking) {
	        return null;
	      }

	      const frameTick = poseTimestamp !== null
	        ? `pose:${poseTimestamp}`
	        : fixturePlaybackEnabled
	          ? `fixture:${fixturePlaybackFramesProcessed}`
	          : null;
	      if (frameTick === null) {
	        return stablePrimaryCueRef.current;
	      }

	      if (cueHysteresisLastTickRef.current !== frameTick) {
	        cueHysteresisLastTickRef.current = frameTick;
	        const previousStableCue = stablePrimaryCueRef.current;
	        stablePrimaryCueRef.current = cueHysteresisControllerRef.current.nextStableCueFromOrderedActive({
	          orderedActiveCues,
	          previousStableCue,
	        });
	      }

	      return stablePrimaryCueRef.current;
	    }, [cueHysteresisControllerRef, cueHysteresisLastTickRef, fixturePlaybackEnabled, fixturePlaybackFramesProcessed, isTracking, orderedActiveCues, poseTimestamp, stablePrimaryCueRef]);
	    const latestMetricsForUpload = useMemo<BaseUploadMetrics>(
	      () => ({
	        mode: detectionMode,
	        reps: repCount,
	        ...(activeWorkoutDef.ui?.buildUploadMetrics(activeMetrics as never) ?? {}),
	      }),
	      [activeWorkoutDef, activeMetrics, detectionMode, repCount]
	    );

  useEffect(() => {
    if (!primaryCue || !audioFeedbackEnabled) {
      return;
    }
    const now = Date.now();
    const last = lastSpokenCueRef.current;
    if (last && last.cue === primaryCue && now - last.timestamp < 5000) {
      return;
    }
    lastSpokenCueRef.current = { cue: primaryCue, timestamp: now };
    // Rotate to a varied phrasing just before TTS so the user doesn't hear
    // the same wording across reps. Dedupe + logging keep the base string
    // so the 5s repeat-guard and analytics stay coherent.
    speakCue(cueRotatorRef.current.rotate(primaryCue));

    addWorkoutRepCue(primaryCue);
  }, [primaryCue, audioFeedbackEnabled, speakCue, addWorkoutRepCue, lastSpokenCueRef, cueRotatorRef]);

  useEffect(() => {
    if (!baselineDebugEnabledRef.current) {
      return;
    }
    const metrics = baselineDebugMetricsRef.current;
    if (!primaryCue) {
      metrics.lastCue = null;
      return;
    }

    metrics.cueSamples += 1;
    if (metrics.lastCue && metrics.lastCue !== primaryCue) {
      metrics.cueFlipCount += 1;
    }
    metrics.lastCue = primaryCue;
  }, [baselineDebugEnabledRef, baselineDebugMetricsRef, primaryCue]);

  return {
    computeAverageFqi, handleCloseScan, handleExitDiscard, handleExitSaveSnapshot,
    handleExitCancel, handleOverlayLayout, openWorkoutInsights, primaryCue,
    latestMetricsForUpload,
  };
}

export type ScanCuesAndExitCtx = ScanTrackingLifecycleCtx & ReturnType<typeof useScanCuesAndExit>;
