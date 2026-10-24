import { useEffect } from 'react';
import { getWorkoutByMode } from '@/lib/workouts';
import { createShadowStatsAccumulator } from '@/lib/pose/shadow-metrics';
import { createShadowProviderCounts } from '@/lib/pose/shadow-provider';
import { createRealtimeFormEngineState } from '@/lib/pose/realtime-form-engine';
import { logWithTs, warnWithTs } from '@/lib/logger';
import { Platform } from 'react-native';
import type { WorkoutMetrics } from '@/lib/types/workout-definitions';
import type { ScanWorkoutControllerCtx } from '@/features/form-tracking/hooks/scan/use-scan-workout-controller';

export function useScanModeAndPlayback(ctx: ScanWorkoutControllerCtx) {
  const {
    DEV, activePhaseRef, cameraPosition, detectionMode, fixtureFrames, fixtureName,
    fixturePlaybackEnabled, fixturePlaybackRequested, isTracking, jointAnglesStateRef,
    lastLivePartialBadgeRef, lastMetricsPublishRef, lastPoseTimestampRef,
    lastShadowMeanAbsDeltaRef, lastSpokenCueRef, mediaPipePoseRef, nativeSupported,
    occlusionManagerRef, partialTrackingHideTimerRef, partialTrackingVisibleUntilMsRef,
    partialWarningVisibleRef, processWorkoutFrame, realtimeFormEngineRef, repCountRef,
    repIndexTrackerRef, resetBaselineDebugMetrics, resetCueHysteresis, resetWorkoutController,
    restPhaseRef, sessionFqiScoresRef, setActiveMetrics, setActivePhase, setDetectionMode,
    setFixturePlaybackFramesProcessed, setFps, setJointAngles, setLatestFqiScore,
    setLatestPullupScoring, setLivePullupPartialStatus, setRepCount, setShowCameraGuide,
    setShowPartialTrackingBadge, setSupportStatus, setSustainedOcclusionHint,
    setWorkoutController, shadowProviderCountsRef, shadowStatsPerRepRef, shadowStatsRef,
    stopSpeech, supportStatus, transitionPhase,
  } = ctx;

  useEffect(() => {
    const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
    activePhaseRef.current = nextInitialPhase;
    restPhaseRef.current = nextInitialPhase;
    setActivePhase(nextInitialPhase);
    setRepCount(0);
    repCountRef.current = 0;
    lastMetricsPublishRef.current = null;
    setActiveMetrics(null);
    setLivePullupPartialStatus(null);
    lastLivePartialBadgeRef.current = null;
    repIndexTrackerRef.current.reset();
    shadowStatsRef.current = createShadowStatsAccumulator();
    shadowStatsPerRepRef.current = createShadowStatsAccumulator();
    shadowProviderCountsRef.current = createShadowProviderCounts();
    mediaPipePoseRef.current = null;
    realtimeFormEngineRef.current = createRealtimeFormEngineState();
    lastShadowMeanAbsDeltaRef.current = null;
    // Previously held lower-body occlusions must not leak into a curl set.
    occlusionManagerRef.current?.reset();
    setSustainedOcclusionHint(null);
    // Clear session-wide FQI accumulator BEFORE swapping the workout
    // controller so the first rep of the new exercise can't briefly land in
    // the previous exercise's score array (#575 item #4). Without this the
    // stopTracking() avg-fqi milestone and session-summary both mix scores
    // across exercises when the user swaps mid-session.
    sessionFqiScoresRef.current = [];
    // Cue-hysteresis + TTS-throttle have independent state (hysteresis
    // stable-cue ref + TTS last-phrase ref). When the user swaps exercises
    // mid-session the same cue text can remain "stable" under the new
    // thresholds, and the TTS hook's 5s repeat-guard treats it as a
    // duplicate — so already-muted cues re-fire as the targets flip.
    // Resetting both boundaries in tandem keeps them coherent (#575 item
    // #1). stopSpeech() also drains the pending speech queue so the user
    // doesn't hear a cue from the prior exercise after the swap.
    resetCueHysteresis();
    lastSpokenCueRef.current = null;
    stopSpeech();
    resetBaselineDebugMetrics();
    setWorkoutController(detectionMode);
  }, [activePhaseRef, detectionMode, lastLivePartialBadgeRef, lastMetricsPublishRef, lastShadowMeanAbsDeltaRef, lastSpokenCueRef, mediaPipePoseRef, occlusionManagerRef, realtimeFormEngineRef, repCountRef, repIndexTrackerRef, resetBaselineDebugMetrics, resetCueHysteresis, restPhaseRef, sessionFqiScoresRef, setActiveMetrics, setActivePhase, setLivePullupPartialStatus, setRepCount, setSustainedOcclusionHint, setWorkoutController, shadowProviderCountsRef, shadowStatsPerRepRef, shadowStatsRef, stopSpeech]);

  useEffect(() => {
    let unsupportedTimer: ReturnType<typeof setTimeout> | null = null;

    if (DEV) {
      logWithTs('[ScanARKit] Component mounted - Platform:', Platform.OS);
      logWithTs('[ScanARKit] nativeSupported value:', nativeSupported);
    }

    if (fixturePlaybackRequested) {
      if (!fixturePlaybackEnabled) {
        warnWithTs('[ScanARKit] Fixture playback requested with unknown fixture name', fixtureName);
      }
      setSupportStatus('supported');
      return;
    }
    
    if (Platform.OS === 'web') {
      setSupportStatus('unsupported');
      return;
    }

    if (nativeSupported) {
      if (DEV) logWithTs('[ScanARKit] Device is supported!');
      setSupportStatus('supported');
    } else {
      if (DEV) logWithTs('[ScanARKit] Waiting for native support probe before showing unsupported state');
      setSupportStatus((current) => (current === 'supported' ? current : 'unknown'));
      unsupportedTimer = setTimeout(() => {
        if (DEV) logWithTs('[ScanARKit] Device NOT supported after readiness probe');
        setSupportStatus((current) => (current === 'supported' ? current : 'unsupported'));
      }, 900);
    }

    return () => {
      if (unsupportedTimer) {
        clearTimeout(unsupportedTimer);
      }
    };
  }, [nativeSupported, fixturePlaybackRequested, fixturePlaybackEnabled, fixtureName, DEV, setSupportStatus]);

  useEffect(() => {
    setLatestPullupScoring(null);
    partialWarningVisibleRef.current = false;
    setShowPartialTrackingBadge(false);
    setShowCameraGuide(true);
    partialTrackingVisibleUntilMsRef.current = 0;
    if (partialTrackingHideTimerRef.current) {
      clearTimeout(partialTrackingHideTimerRef.current);
      partialTrackingHideTimerRef.current = null;
    }
  }, [detectionMode, partialTrackingHideTimerRef, partialTrackingVisibleUntilMsRef, partialWarningVisibleRef, setLatestPullupScoring, setShowCameraGuide, setShowPartialTrackingBadge]);

  // Keep camera readiness under user control. Tracking starts from the main
  // button or a good stance check so the user can frame their full body first.
  useEffect(() => {
    if (DEV) {
      logWithTs('[ScanARKit] Readiness check:', {
        supportStatus,
        isTracking,
        cameraPosition,
        ready: supportStatus === 'supported' && cameraPosition === 'back'
      });
    }
  }, [supportStatus, isTracking, cameraPosition, DEV]);

  useEffect(() => {
    if (!fixturePlaybackEnabled || !fixtureFrames || fixtureFrames.length === 0) {
      setFixturePlaybackFramesProcessed(0);
      return;
    }

    if (detectionMode !== 'pullup') {
      setDetectionMode('pullup');
    }

    const firstFrame = fixtureFrames[0];
    const nextInitialPhase = getWorkoutByMode('pullup').initialPhase;
    activePhaseRef.current = nextInitialPhase;
    transitionPhase(nextInitialPhase);
    repIndexTrackerRef.current.reset();
    resetWorkoutController();
    setRepCount(0);
    repCountRef.current = 0;
    lastMetricsPublishRef.current = null;
    setActiveMetrics(null);
    setLatestFqiScore(null);
    setFps(30);
    setFixturePlaybackFramesProcessed(0);
    setJointAngles(firstFrame?.angles ?? null);
    resetBaselineDebugMetrics();
    resetCueHysteresis();

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const processFrameAt = (index: number) => {
      if (cancelled) return;
      const frame = fixtureFrames[index];
      if (!frame) {
        if (DEV) {
          logWithTs('[ScanARKit] Fixture playback completed', {
            fixture: fixtureName,
            framesProcessed: fixtureFrames.length,
            expectedRepCount: fixtureFrames[0]?.expected.repCount,
          });
        }
        return;
      }

      const joints = frame.joints
        ? new Map(
            Object.entries(frame.joints).map(([key, value]) => [
              key,
              { x: value.x, y: value.y, isTracked: value.isTracked },
            ]),
          )
        : undefined;

      lastPoseTimestampRef.current = frame.timestampSec;
      jointAnglesStateRef.current = frame.angles;
      setJointAngles(frame.angles);
      const metrics = getWorkoutByMode('pullup').calculateMetrics(frame.angles, joints) as WorkoutMetrics;
      setActiveMetrics(metrics);
      processWorkoutFrame(frame.angles, joints, {
        metrics,
        trackingQuality: 1,
        shadowMeanAbsDelta: 0,
      });
      setFixturePlaybackFramesProcessed(index + 1);

      const next = fixtureFrames[index + 1];
      if (!next) {
        return;
      }

      const deltaMs = Math.max(1, Math.round((next.timestampSec - frame.timestampSec) * 1000));
      timeoutId = setTimeout(() => {
        processFrameAt(index + 1);
      }, deltaMs);
    };

    processFrameAt(0);

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [fixturePlaybackEnabled, fixtureFrames, fixtureName, detectionMode, transitionPhase, resetWorkoutController, processWorkoutFrame, DEV, resetBaselineDebugMetrics, resetCueHysteresis, activePhaseRef, repIndexTrackerRef, setRepCount, repCountRef, lastMetricsPublishRef, setActiveMetrics, setLatestFqiScore, setFps, setFixturePlaybackFramesProcessed, setJointAngles, setDetectionMode, lastPoseTimestampRef, jointAnglesStateRef]);

  return {

  };
}

export type ScanModeAndPlaybackCtx = ScanWorkoutControllerCtx & ReturnType<typeof useScanModeAndPlayback>;
