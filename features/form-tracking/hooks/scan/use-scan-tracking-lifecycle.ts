import { useCallback, useEffect } from 'react';
import { logWithTs, warnWithTs, errorWithTs } from '@/lib/logger';
import { Alert, Platform } from 'react-native';
import { getWorkoutByMode } from '@/lib/workouts';
import { createShadowStatsAccumulator } from '@/lib/pose/shadow-metrics';
import { createShadowProviderCounts } from '@/lib/pose/shadow-provider';
import { createRealtimeFormEngineState } from '@/lib/pose/realtime-form-engine';
import { exerciseRecordingStore } from '@/lib/debug/exercise-recording-store';
import * as Haptics from 'expo-haptics';
import { playRepCountdown } from '@/lib/services/rep-countdown-audio';
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';
import * as FileSystem from 'expo-file-system/legacy';
import { getFormSessionHistory, countPbsThisMonth, countConsecutiveSessionDays, appendFormSessionHistory } from '@/lib/services/form-session-history';
import { emitFormMilestone } from '@/lib/stores/session-runner';
import type { ScanPose2DSmoothingCtx } from '@/features/form-tracking/hooks/scan/use-scan-pose2d-smoothing';

export function useScanTrackingLifecycle(ctx: ScanPose2DSmoothingCtx) {
  const {
    DEV, activePhaseRef, cameraPosition, countAudioEnabledRef, detectionMode,
    fixturePlaybackEnabled, flushPendingRepsOnStop, frameStatsRef, hapticsEnabledRef,
    isRecording, lastConfidenceTierRef, lastFpsPublishMsRef, lastMetricsPublishRef,
    lastShadowMeanAbsDeltaRef, mediaPipePoseRef, pendingRecordAfterTrackingRef,
    realtimeFormEngineRef, recordingStopInFlightRef, repCountRef, repCountdownFiredRef,
    repIndexTrackerRef, repStartTsRef, resetBaselineDebugMetrics, resetCueHysteresis,
    resetWorkoutController, resumeTrackingAfterPermissionGrantRef, sessionFqiScoresRef,
    sessionIdRef, setActiveMetrics, setFps, setIsFinalizingRecording, setIsRecording,
    setJointAngles, setLatestFqiScore, setRecordingStartStatus, setRepCount,
    setShadowProviderRuntime, setSustainedOcclusionHint, shadowProviderCountsRef, shadowStatsRef,
    showToast, startNativeTracking, stopNativeTracking, stopTrackingRef,
    sustainedOcclusionTimerRef, transitionPhase, watchMirrorPublisher,
  } = ctx;

  // Start tracking
  const startTracking = useCallback(async (): Promise<boolean> => {
    if (DEV) logWithTs('[ScanARKit] Starting tracking...');
    resumeTrackingAfterPermissionGrantRef.current = true;
    if (cameraPosition !== 'back') {
      if (DEV) warnWithTs('[ScanARKit] Skipping tracking start: ARKit requires back camera');
      Alert.alert('Back camera required', 'ARKit body tracking only works with the back camera.');
      resumeTrackingAfterPermissionGrantRef.current = false;
      return false;
    }
    try {
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      repIndexTrackerRef.current.reset();
      resetWorkoutController();
      setRepCount(0);
      repCountRef.current = 0;
      lastMetricsPublishRef.current = null;
      setActiveMetrics(null);
      setLatestFqiScore(null);
      resetBaselineDebugMetrics();
      resetCueHysteresis();
      repCountdownFiredRef.current = false;
      sessionFqiScoresRef.current = [];
      repStartTsRef.current = 0;
      lastConfidenceTierRef.current = null;

      const startTime = Date.now();
      shadowStatsRef.current = createShadowStatsAccumulator();
      shadowProviderCountsRef.current = createShadowProviderCounts();
      mediaPipePoseRef.current = null;
      realtimeFormEngineRef.current = createRealtimeFormEngineState();
      lastShadowMeanAbsDeltaRef.current = null;
      if (__DEV__) exerciseRecordingStore.begin(detectionMode, fixturePlaybackEnabled);
      await startNativeTracking();
      const elapsed = Date.now() - startTime;
      resumeTrackingAfterPermissionGrantRef.current = false;

      if (DEV) logWithTs('[ScanARKit] Tracking started successfully in', elapsed, 'ms');

      if (Platform.OS === 'ios' && hapticsEnabledRef.current) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Fire the 3-2-1 pre-announce once per tracking start. Gated on the
      // user preference (form-tracking `countAudioEnabled` toggle) + the
      // EXPO_PUBLIC_REP_COUNTDOWN env flag inside playRepCountdown itself.
      // Errors are swallowed — countdown is a nice-to-have, not a blocker
      // for the tracking loop.
      if (!repCountdownFiredRef.current && countAudioEnabledRef.current) {
        repCountdownFiredRef.current = true;
        playRepCountdown().catch((error) => {
          if (DEV) warnWithTs('[ScanARKit] rep countdown failed', error);
        });
      }
      return true;
    } catch (error) {
      if (__DEV__) exerciseRecordingStore.abort('Capture discarded: tracking failed to start.');
      // Native start can throw AFTER `useBodyTracking` has already flipped
      // its internal isTracking to true (see ARKitBodyTracker.ios.ts
      // startTracking — setIsTracking(true) runs before the async body can
      // reject asynchronously). Call stopNativeTracking() here so the hook
      // resets isTracking -> false, tears down its pose-polling interval,
      // and we don't keep the UI rendered as if tracking were live. Also
      // clear the rep-countdown latch so a retry fires the pre-announce
      // again.
      try {
        stopNativeTracking();
      } catch (stopError) {
        if (DEV) warnWithTs('[ScanARKit] stopNativeTracking after failed start also threw', stopError);
      }
      repCountdownFiredRef.current = false;
      resumeTrackingAfterPermissionGrantRef.current = false;
      pendingRecordAfterTrackingRef.current = false;
      setRecordingStartStatus('idle');
      errorWithTs('[ScanARKit] ❌ Failed to start tracking:', error);
      if (DEV) {
        errorWithTs('[ScanARKit] Error details:', {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startNativeTracking,
    stopNativeTracking,
    transitionPhase,
    cameraPosition,
    logWithTs,
    detectionMode,
    fixturePlaybackEnabled,
    resetWorkoutController,
    resetBaselineDebugMetrics,
    resetCueHysteresis,
  ]);

  const stopRecordingCore = useCallback(async () => {
    if (!isRecording || recordingStopInFlightRef.current) {
      return null;
    }
    recordingStopInFlightRef.current = true;
    setIsFinalizingRecording(true);
    try {
      const path = await BodyTracker.stopRecording();
      setIsRecording(false);
      if (!path) {
        return null;
      }
      return path.startsWith('file://') ? path : `file://${path}`;
    } catch (error) {
      errorWithTs('[ScanARKit] Failed to stop ARKit recording', error);
      setIsRecording(false);
      throw error;
    } finally {
      setIsFinalizingRecording(false);
      recordingStopInFlightRef.current = false;
    }
  }, [isRecording, recordingStopInFlightRef, setIsFinalizingRecording, setIsRecording]);

  // Stop tracking
  const stopTracking = useCallback(async () => {
    if (__DEV__) void exerciseRecordingStore.finish();
    watchMirrorPublisher.setActive(false);
    if (DEV) logWithTs('[ScanARKit] Stopping tracking...');
    pendingRecordAfterTrackingRef.current = false;
    setRecordingStartStatus('idle');

    // Snapshot the session data before the cleanup below wipes the refs.
    // Used for post-session milestone detection (#494).
    const sessionScoresAtStop = sessionFqiScoresRef.current.slice();
    const exerciseKeyAtStop = detectionMode;
    const sessionIdAtStop = sessionIdRef.current;

    // Drop any pending sustained-occlusion hint timer so the badge doesn't
    // bleed into the next session with a stale "Some joints hidden" toast
    // (#575 item #6). The hint state is also cleared to match.
    if (sustainedOcclusionTimerRef.current) {
      clearTimeout(sustainedOcclusionTimerRef.current);
      sustainedOcclusionTimerRef.current = null;
    }
    setSustainedOcclusionHint(null);

    // Surface any reps that failed to persist before the controller resets
    // its pending-writes queue (#575 item #10). The callback below emits a
    // user-facing "N reps pending sync" toast so the user knows their work
    // wasn't lost even though we can't block stopTracking on a drain.
    flushPendingRepsOnStop();

    try {
      if (isRecording) {
        try {
          const uri = await stopRecordingCore();
          if (uri) {
            FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
          }
        } catch (error) {
          errorWithTs('[ScanARKit] ❌ Error stopping recording when stopping tracking:', error);
        }
      }

      stopNativeTracking();
      frameStatsRef.current = { lastTimestamp: 0, frameCount: 0 };
      lastFpsPublishMsRef.current = 0;
      setJointAngles(null);
      lastMetricsPublishRef.current = null;
      setActiveMetrics(null);
      setLatestFqiScore(null);
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      repIndexTrackerRef.current.reset();
      resetWorkoutController();
      setRepCount(0);
      repCountRef.current = 0;
      setFps(0);
      realtimeFormEngineRef.current = createRealtimeFormEngineState();
      lastShadowMeanAbsDeltaRef.current = null;
      shadowStatsRef.current = createShadowStatsAccumulator();
      shadowProviderCountsRef.current = createShadowProviderCounts();
      mediaPipePoseRef.current = null;
      setShadowProviderRuntime('mediapipe_proxy');
      resetBaselineDebugMetrics();
      resetCueHysteresis();
      repCountdownFiredRef.current = false;
      sessionFqiScoresRef.current = [];
      repStartTsRef.current = 0;
      lastConfidenceTierRef.current = null;

      if (DEV) logWithTs('[ScanARKit] Tracking stopped');

      if (Platform.OS === 'ios' && hapticsEnabledRef.current) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      // Post-session milestone detection (#494). Runs off the main
      // stop-tracking path so we never block cleanup on I/O. Requires at
      // least 3 reps so a half-hearted 1-rep toggle doesn't overwrite PBs.
      if (sessionScoresAtStop.length >= 3) {
        const sum = sessionScoresAtStop.reduce((acc, v) => acc + v, 0);
        const avgFqi = sum / sessionScoresAtStop.length;
        const endedAt = new Date().toISOString();
        (async () => {
          try {
            const prior = await getFormSessionHistory(exerciseKeyAtStop);
            // Enrichment: count PBs set so far this month (including the
            // candidate session if it would land a PB) and the day-streak
            // ending today. These are best-effort — failures don't block
            // milestone emission.
            let priorPbCount = 0;
            let weekStreakDays = 0;
            try {
              priorPbCount = await countPbsThisMonth({
                now: new Date(endedAt),
                candidate: { exerciseKey: exerciseKeyAtStop, avgFqi },
              });
            } catch {
              /* ignore */
            }
            try {
              // +1 for today's session even though it isn't persisted yet —
              // match the "today counts once a session lands" contract the
              // streak helper uses on already-appended entries.
              weekStreakDays =
                (await countConsecutiveSessionDays({ now: new Date(endedAt) })) + 1;
            } catch {
              /* ignore */
            }
            await emitFormMilestone({
              sessionId: sessionIdAtStop,
              exerciseKey: exerciseKeyAtStop,
              currentAvgFqi: avgFqi,
              priorSessions: prior.map((p) => ({
                avgFqi: p.avgFqi,
                endedAt: p.endedAt,
              })),
              priorPbCount,
              weekStreakDays,
            });
            await appendFormSessionHistory({
              exerciseKey: exerciseKeyAtStop,
              avgFqi,
              endedAt,
              sessionId: sessionIdAtStop,
            });
          } catch (error) {
            // Production: surface a non-blocking toast so the user knows
            // the achievement wasn't persisted but sync will retry. Dev
            // keeps the detailed warn for debugging.
            if (DEV) {
              warnWithTs('[ScanARKit] milestone post-session failed', error);
            }
            try {
              showToast(
                "Achievement couldn't be saved — we'll retry on next sync",
                { type: 'error', duration: 5000 },
              );
            } catch {
              /* toast provider absent in headless tests — ignore */
            }
          }
        })();
      }
    } catch (error) {
      errorWithTs('[ScanARKit] ❌ Error stopping tracking:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stopNativeTracking,
    transitionPhase,
    isRecording,
    stopRecordingCore,
    logWithTs,
    detectionMode,
    resetWorkoutController,
    resetBaselineDebugMetrics,
    resetCueHysteresis,
    flushPendingRepsOnStop,
  ]);

  useEffect(() => {
    stopTrackingRef.current = stopTracking;
  }, [stopTracking, stopTrackingRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void stopTrackingRef.current?.();
    };
  }, [stopTrackingRef]);

  return {
    startTracking, stopRecordingCore, stopTracking,
  };
}

export type ScanTrackingLifecycleCtx = ScanPose2DSmoothingCtx & ReturnType<typeof useScanTrackingLifecycle>;
