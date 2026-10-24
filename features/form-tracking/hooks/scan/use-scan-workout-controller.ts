import React, { useEffect, useCallback, useMemo } from 'react';
import { RepIndexTracker } from '@/lib/services/rep-index-tracker';
import { usePremiumCueAudio } from '@/features/voice/hooks/use-premium-cue-audio';
import { logCueEvent, upsertSessionMetrics } from '@/lib/services/cue-logger';
import { audioSessionManager } from '@/lib/services/audio-session-manager';
import { markCuesDisabled, initSessionContext, getSessionQuality } from '@/lib/services/telemetry-context';
import { warnWithTs } from '@/lib/logger';
import { resetFrameCounter, flushPoseBuffer } from '@/lib/services/pose-logger';
import { createShadowStatsAccumulator, finalizeShadowStats } from '@/lib/pose/shadow-metrics';
import { createShadowProviderCounts, summarizeShadowProvider } from '@/lib/pose/shadow-provider';
import { createRealtimeFormEngineState } from '@/lib/pose/realtime-form-engine';
import { MEDIAPIPE_SHADOW_PROXY_VERSION } from '@/lib/pose/adapters/mediapipe-shadow-proxy';
import * as Haptics from 'expo-haptics';
import { Platform, AccessibilityInfo } from 'react-native';
import type { PullupScoringResult } from '@/lib/tracking-quality';
import { isPendingRepsAtStopSignal, useWorkoutController } from '@/features/form-tracking/hooks/use-workout-controller';
import type { ExerciseReplayFrame } from '@/lib/debug/exercise-replay';
import { exerciseRecordingStore } from '@/lib/debug/exercise-recording-store';
import type { ScanDiagnosticsCtx } from '@/features/form-tracking/hooks/scan/use-scan-diagnostics';

export function useScanWorkoutController(ctx: ScanDiagnosticsCtx) {
  const {
    activePhase, activePhaseRef, activeWorkoutDef, audioFeedbackEnabled, audioFeedbackEnabledRef,
    cueCountersRef, cueRotatorRef, detectionMode, fixturePlaybackEnabled, fpsStatsRef,
    hapticsEnabledRef, isRecording, isScreenFocused, isTracking, lastShadowMeanAbsDeltaRef,
    lastSpokenCueRef, mediaPipeModelVersionRef, mediaPipePoseRef, realtimeFormEngineRef,
    repCount, resetBaselineDebugMetrics, sessionIdRef, sessionStartRef, setActivePhase,
    setLatestFqiScore, setLatestPullupScoring, setRepCount, shadowModeEnabledRef,
    shadowProviderCountsRef, shadowProviderRuntimeRef, shadowStatsPerRepRef, shadowStatsRef,
    showToast, updatePartialTrackingBadgeVisibility,
  } = ctx;

  const repIndexTrackerRef = React.useRef(new RepIndexTracker());
  // Stable mirror of `repCount` for callback closures (telemetry, cue logger).
  // Telemetry events fire asynchronously after phase transitions, so reading
  // React state inside the closure can attribute the cue to the wrong rep
  // (closure captured the *previous* value). We snapshot into this ref on
  // every rep-complete callback and read from it in logCueEvent().
  const repCountRef = React.useRef(0);

  // Epoch-ms timestamp of the most recent rep-start phase transition. Used
  // by the live pullup partial-scoring path so the scoring call reflects
  // *actual* elapsed time for the in-flight rep instead of a hardcoded
  // placeholder. Reset to 0 on rep complete, phase reset, and tracking
  // stop so subsequent scoring calls fall back to the safe default.
  const repStartTsRef = React.useRef<number>(0);

  const lastPoseTimestampRef = React.useRef<number | null>(null);
  const recordingActiveRef = React.useRef(false);
  const recordingStartAtRef = React.useRef<string | null>(null);
  const recordingStartEpochMsRef = React.useRef<number>(0);
  const recordingStartFrameTimestampRef = React.useRef<number | null>(null);
  const recordingStartRepsRef = React.useRef<number>(0);
  const recordingFqiScoresRef = React.useRef<number[]>([]);
  // Session-wide FQI scores (one entry per completed rep, regardless of
  // recording state) — used for snapshots + milestone checks, independent
  // of whether the user is actively recording a clip. Reset when tracking
  // starts / stops.
  const sessionFqiScoresRef = React.useRef<number[]>([]);
  // Ensures the 3-2-1 countdown only fires once per tracking start so we
  // do not re-announce on mode swaps / transient phase re-entries. Reset
  // to false inside startTracking + stopTracking.
  const repCountdownFiredRef = React.useRef(false);
  // Throttles VoiceOver/TalkBack rep-completion announcements so burst
  // sets (e.g. 10 reps in 5s) don't flood the screen-reader queue. At
  // most one announcement every 400ms; the SVG rep counter itself is
  // not announceable so this is the primary a11y affordance for reps.
  const lastRepAnnounceAtMsRef = React.useRef(0);

  const { speak: speakCue, stop: stopSpeech } = usePremiumCueAudio({
    enabled: audioFeedbackEnabled && isScreenFocused,
    voiceId: undefined, // Use default system voice
    rate: 0.52,
    pitch: 1.0,
    volume: 1,
    minIntervalMs: 3500,
    shouldAllowRecording: isRecording,
    onEvent: (evt) => {
      const sessionId = sessionIdRef.current;
      cueCountersRef.current.total += 1;
      if (evt.action === 'spoken') {
        cueCountersRef.current.spoken += 1;
      }
      if (evt.reason === 'throttled_same_cue' || evt.reason === 'duplicate_in_queue' || evt.reason === 'throttled_interval') {
        cueCountersRef.current.droppedRepeat += 1;
      }
      if (evt.reason === 'disabled') {
        cueCountersRef.current.droppedDisabled += 1;
      }

      const phase = activePhase;

      logCueEvent({
        sessionId,
        cue: evt.cue,
        mode: detectionMode,
        phase,
        // Read from the ref rather than the closure-captured React state so
        // cues that emit just after a rep-complete phase transition attribute
        // to the latest rep (see #575 item #3).
        repCount: repCountRef.current,
        reason: evt.reason,
        throttled: evt.throttled,
        dropped: evt.action !== 'spoken',
      });
    },
  });

  useEffect(() => {
    audioSessionManager.setMode('tracking');
    return () => {
      audioSessionManager.setMode('idle');
    };
  }, []);

  useEffect(() => {
    if (!audioFeedbackEnabled) {
      lastSpokenCueRef.current = null;
      stopSpeech();
      // Track when user disables cues mid-session
      if (isTracking) {
        markCuesDisabled();
      }
    }
  }, [audioFeedbackEnabled, stopSpeech, isTracking, lastSpokenCueRef]);

  useEffect(() => {
    if (!isScreenFocused) {
      lastSpokenCueRef.current = null;
      stopSpeech();
    }
  }, [isScreenFocused, lastSpokenCueRef, stopSpeech]);

  // Each new tracking session starts cue rotation at variant 0 so support
  // debugging is deterministic and users always hear the most familiar
  // phrasing first.
  useEffect(() => {
    if (isTracking) {
      cueRotatorRef.current.reset();
    }
  }, [cueRotatorRef, isTracking]);

  // Initialize telemetry context on mount
  useEffect(() => {
    initSessionContext().catch((error) => {
      if (__DEV__) {
        warnWithTs('[ScanARKit] Failed to initialize session context', error);
      }
      // Surface the failure to the user — when the telemetry context
      // can't initialize, the rep-count pipeline may fail to persist
      // session metrics, so we owe them an honest warning rather than a
      // silent session that produces no history entry.
      showToast('Telemetry unavailable — reps may not be counted.', {
        type: 'error',
      });
    });
    resetFrameCounter();
    shadowStatsRef.current = createShadowStatsAccumulator();
    shadowStatsPerRepRef.current = createShadowStatsAccumulator();
    shadowProviderCountsRef.current = createShadowProviderCounts();
    mediaPipePoseRef.current = null;
    realtimeFormEngineRef.current = createRealtimeFormEngineState();
    lastShadowMeanAbsDeltaRef.current = null;
    resetBaselineDebugMetrics();
  }, [lastShadowMeanAbsDeltaRef, mediaPipePoseRef, realtimeFormEngineRef, resetBaselineDebugMetrics, shadowProviderCountsRef, shadowStatsPerRepRef, shadowStatsRef, showToast]);

  useEffect(() => {
    const countersRef = cueCountersRef;
    const fpsRef = fpsStatsRef;
    const sessionId = sessionIdRef.current;
    const sessionStart = sessionStartRef.current;

    return () => {
      const counters = { ...countersRef.current };
      const fpsStats = { ...fpsRef.current };
      const avgFps = fpsStats.count > 0 ? fpsStats.sum / fpsStats.count : null;
      const minFps = fpsStats.count > 0 ? fpsStats.min : null;
      const quality = getSessionQuality();
      const shadow = finalizeShadowStats(shadowStatsRef.current);
      const shadowProvider = shadowModeEnabledRef.current
        // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount telemetry must read the final ref value
        ? summarizeShadowProvider(shadowProviderCountsRef.current, shadowProviderRuntimeRef.current)
        : undefined;
      const shadowModelVersion = shadowModeEnabledRef.current
        ? shadowProvider === 'mediapipe'
          // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount telemetry must read the final ref value
          ? mediaPipeModelVersionRef.current
          : MEDIAPIPE_SHADOW_PROXY_VERSION
        : undefined;

      // Flush any remaining pose samples before session ends
      flushPoseBuffer().catch((error) => {
        if (__DEV__) {
          warnWithTs('[ScanARKit] Failed to flush pose buffer on cleanup', error);
        }
      });

      upsertSessionMetrics({
        sessionId,
        startAt: sessionStart,
        endAt: new Date().toISOString(),
        avgFps,
        minFps,
        cuesTotal: counters.total,
        cuesSpoken: counters.spoken,
        cuesDroppedRepeat: counters.droppedRepeat,
        cuesDroppedDisabled: counters.droppedDisabled,
        // Quality signals from telemetry context
        poseLostCount: quality.poseLostCount,
        lowConfidenceFrames: quality.lowConfidenceFrames,
        trackingResetCount: quality.trackingResetCount,
        userAbortedEarly: quality.userAbortedEarly,
        cuesDisabledMidSession: quality.cuesDisabledMidSession,

        // Shadow-mode drift summary
        // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount telemetry must read the final ref value
        shadowEnabled: shadowModeEnabledRef.current,
        shadowProvider,
        shadowModelVersion,
        shadowFramesCompared: shadow.framesCompared,
        shadowMeanAbsDelta: shadow.meanAbsDelta,
        shadowP95AbsDelta: shadow.p95AbsDelta,
        shadowMaxAbsDelta: shadow.maxAbsDelta,
        shadowCoverageRatio: shadow.coverageRatio,
      });
    };
  }, [cueCountersRef, fpsStatsRef, mediaPipeModelVersionRef, sessionIdRef, sessionStartRef, shadowModeEnabledRef, shadowProviderCountsRef, shadowProviderRuntimeRef, shadowStatsRef]);

  const transitionPhase = useCallback((next: string) => {
    if (activePhaseRef.current !== next) {
      activePhaseRef.current = next;
      setActivePhase(next);
    }
  }, [activePhaseRef, setActivePhase]);

  const workoutControllerCallbacks = useMemo(() => ({
    onPhaseChange: (nextPhase: string, prevPhase: string) => {
      transitionPhase(nextPhase);
      if (nextPhase === activeWorkoutDef.initialPhase && prevPhase !== nextPhase) {
        repIndexTrackerRef.current.reset();
      }
      if (nextPhase === activeWorkoutDef.repBoundary.startPhase) {
        repIndexTrackerRef.current.startRep(repCount);
        // Capture the rep-start epoch timestamp so the live partial-scoring
        // block below can pass a real elapsed duration into
        // scorePullupWithComponentAvailability instead of the hardcoded
        // 1000ms placeholder that was previously used.
        repStartTsRef.current = Date.now();
        // Start of a new rep: clear the per-rep shadow-drift accumulator so
        // the next rep's delta metrics are not polluted by the previous rep.
        shadowStatsPerRepRef.current = createShadowStatsAccumulator();
      }
    },
    onRepComplete: (repNumber: number, fqi: number) => {
      setRepCount(repNumber);
      // Snapshot into a ref so async telemetry closures (logCueEvent) read
      // the current count instead of the value captured when the closure was
      // created — avoids attributing cues to the prior rep when phase
      // transitions fire asynchronously.
      repCountRef.current = repNumber;
      repIndexTrackerRef.current.endRep();
      // Clear the in-flight rep timestamp; live partial scoring between
      // reps will fall back to the 1000ms safe default until the next
      // rep-start phase transition captures a fresh epoch.
      repStartTsRef.current = 0;
      if (Number.isFinite(fqi)) {
        sessionFqiScoresRef.current.push(fqi);
        setLatestFqiScore(fqi);
      }
      if (recordingActiveRef.current && Date.now() >= recordingStartEpochMsRef.current) {
        recordingFqiScoresRef.current.push(fqi);
      }
      // Additive rep-complete haptic: the workout controller already fires
      // a Light impact through the shared haptic bus, but testers reported
      // that in noisy gym environments the light tap is easy to miss. When
      // the user has audio/cue feedback enabled AND hasn't muted haptics we
      // also fire a Heavy impact here so successful reps register
      // unambiguously. Gated by audioFeedbackEnabledRef.current (mirrors
      // the cue-audio toggle) + hapticsEnabledRef.current (form-tracking
      // settings) so users who silenced either don't get a phantom buzz.
      if (audioFeedbackEnabledRef.current && hapticsEnabledRef.current) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {
          /* native bridge unavailable — silent */
        });
      }
      // VoiceOver/TalkBack announcement. The rep-counter overlay is an
      // SVG <Text>, which RN does not expose to screen readers, so we
      // rely on announceForAccessibility. Throttled to 400ms to avoid
      // queue pile-up during fast sets (RN queues announcements rather
      // than coalescing them). No-op on web.
      if (Platform.OS !== 'web') {
        const nowMs = Date.now();
        if (nowMs - lastRepAnnounceAtMsRef.current >= 400) {
          lastRepAnnounceAtMsRef.current = nowMs;
          try {
            AccessibilityInfo.announceForAccessibility(`Rep ${repNumber}`);
          } catch {
            /* a11y bridge unavailable — silent */
          }
        }
      }
    },
    onPullupScoring: (
      _repNumber: number,
      scoring: PullupScoringResult,
      meta?: { source: 'frame' | 'rep-complete' }
    ) => {
      setLatestPullupScoring(scoring);
      updatePartialTrackingBadgeVisibility(
        scoring.visibility_badge,
        meta?.source === 'frame' ? 'frame-live' : 'onPullupScoring-rep-complete'
      );
    },
    // Surface pending-rep warnings to the user (#575 item #10). The
    // controller fires this both during the session (single-rep retry
    // failures) and at stop-time (via flushPendingRepsOnStop) with a
    // distinct sentinel we can discriminate on.
    onRepLogFailure: (error: unknown, queueDepth: number) => {
      if (isPendingRepsAtStopSignal(error)) {
        showToast(`${queueDepth} rep${queueDepth === 1 ? '' : 's'} pending sync — we'll retry when you're back online.`, {
          type: 'info',
        });
      }
    },
  }), [activeWorkoutDef.initialPhase, activeWorkoutDef.repBoundary.startPhase, audioFeedbackEnabledRef, hapticsEnabledRef, repCount, setLatestFqiScore, setLatestPullupScoring, setRepCount, shadowStatsPerRepRef, showToast, transitionPhase, updatePartialTrackingBadgeVisibility]);

  const onExerciseRecordingFrame = useCallback((frame: ExerciseReplayFrame) => {
    if (__DEV__ && !fixturePlaybackEnabled) exerciseRecordingStore.append(frame);
  }, [fixturePlaybackEnabled]);

  const onExerciseRecordingReset = useCallback((options?: { preserveRepCount?: boolean }) => {
    if (__DEV__ && !fixturePlaybackEnabled) exerciseRecordingStore.reset(options);
  }, [fixturePlaybackEnabled]);

  useEffect(() => {
    // A capture must never span exercise definitions or fixture/live sources.
    // Unrelated render/callback changes deliberately do not restart this effect.
    return () => { if (__DEV__) exerciseRecordingStore.abort(); };
  }, [detectionMode, fixturePlaybackEnabled]);

  const workoutController = useWorkoutController(detectionMode, {
    sessionId: sessionIdRef.current,
    callbacks: workoutControllerCallbacks,
    enableHaptics: true,
    onFrame: __DEV__ ? onExerciseRecordingFrame : undefined,
    onReset: __DEV__ ? onExerciseRecordingReset : undefined,
  });

  const {
    processFrame: processWorkoutFrame,
    reset: resetWorkoutController,
    setWorkout: setWorkoutController,
    addRepCue: addWorkoutRepCue,
    flushPendingRepsOnStop,
  } = workoutController;

  return {
    repIndexTrackerRef, repCountRef, repStartTsRef, lastPoseTimestampRef, recordingActiveRef,
    recordingStartAtRef, recordingStartEpochMsRef, recordingStartFrameTimestampRef,
    recordingStartRepsRef, recordingFqiScoresRef, sessionFqiScoresRef, repCountdownFiredRef,
    speakCue, stopSpeech, transitionPhase, processWorkoutFrame, resetWorkoutController,
    setWorkoutController, addWorkoutRepCue, flushPendingRepsOnStop,
  };
}

export type ScanWorkoutControllerCtx = ScanDiagnosticsCtx & ReturnType<typeof useScanWorkoutController>;
