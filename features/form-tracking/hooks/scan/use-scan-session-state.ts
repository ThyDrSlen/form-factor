import { useRouter, useLocalSearchParams } from 'expo-router';
import { useToast } from '@/contexts/ToastContext';
import { useFormTrackingSettings } from '@/features/form-tracking/hooks/use-form-tracking-settings';
import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { usePRDetection } from '@/features/form-tracking/hooks/use-pr-detection';
import { useProgressionSuggestion } from '@/features/form-tracking/hooks/use-progression-suggestion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, Animated } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { warnWithTs, logWithTs } from '@/lib/logger';
import { useAdaptiveFps } from '@/features/form-tracking/hooks/use-adaptive-fps';
import { useBodyTracking, type JointAngles, type Joint2D, type MediaPipePose2D } from '@/lib/arkit/ARKitBodyTracker';
import { createRealtimeFormEngineState } from '@/lib/pose/realtime-form-engine';
import { DEFAULT_DETECTION_MODE, getWorkoutByMode, type DetectionMode } from '@/lib/workouts';
import { getDefaultsForExerciseWithFlag, type FormTargets } from '@/lib/services/form-target-resolver';
import type { WorkoutMetrics } from '@/lib/types/workout-definitions';
import type { RecordingQuality } from '@/lib/services/video-metrics';
import { SHOW_N_FRAMES, HIDE_N_FRAMES, type PullupScoringResult } from '@/lib/tracking-quality';
import { createCueRotator } from '@/lib/services/cue-rotator';
import { CUE_ROTATION_VARIANTS } from '@/lib/services/cue-rotator-variants';
import { CueHysteresisController } from '@/lib/tracking-quality/cue-hysteresis';
import { usePreSetPreview } from '@/features/form-tracking/hooks/use-pre-set-preview';
import { useIsFocused } from '@react-navigation/native';
import { generateSessionId } from '@/lib/services/cue-logger';
import { useSubjectIdentity } from '@/features/form-tracking/hooks/use-subject-identity';
import { useCameraPermissionGuard } from '@/features/form-tracking/hooks/use-camera-permission-guard';
import { useAppStatePause } from '@/features/form-tracking/hooks/use-app-state-pause';
import { OcclusionHoldManager, type SustainedOcclusionEvent } from '@/lib/tracking-quality/occlusion';
import { createWatchMirrorPublisher } from '@/lib/watch-connectivity/mirror-publisher';
import { Svg } from 'react-native-svg';
import type { WatchTrackingPublicationState } from '@/lib/watch-connectivity/tracking-publication';
import { createShadowStatsAccumulator } from '@/lib/pose/shadow-metrics';
import { createShadowProviderCounts, type ShadowProvider } from '@/lib/pose/shadow-provider';
import { MEDIAPIPE_POSE_LANDMARKER_VERSION } from '@/lib/pose/adapters/mediapipe-workout-adapter';
import { FIXTURE_PLAYBACK_DEFAULT, FIXTURE_PLAYBACK_TRACES, RecordedPreview, ClipUploadMetrics, BaselineDebugMetrics, createBaselineDebugMetrics } from '@/features/form-tracking/hooks/scan/scan-constants';

export function useScanSessionState() {
  const DEV = __DEV__;
  const router = useRouter();
  const { show: showToast } = useToast();
  // Form-tracking global preferences. We only read the two feedback-modality
  // toggles here — `countAudioEnabled` gates the 3-2-1 rep countdown and
  // `hapticsEnabled` gates the rep-complete / start / stop haptic pulses.
  // Voice gating is handled elsewhere (usePremiumCueAudio). Mirror both into
  // refs so callback-stable callsites don't need to re-render when the user
  // toggles either in settings.
  const { settings: formTrackingSettings } = useFormTrackingSettings();
  const countAudioEnabledRef = React.useRef<boolean>(formTrackingSettings.countAudioEnabled);
  const hapticsEnabledRef = React.useRef<boolean>(formTrackingSettings.hapticsEnabled);
  useEffect(() => {
    countAudioEnabledRef.current = formTrackingSettings.countAudioEnabled;
    hapticsEnabledRef.current = formTrackingSettings.hapticsEnabled;
  }, [formTrackingSettings.countAudioEnabled, formTrackingSettings.hapticsEnabled]);
  const params = useLocalSearchParams<{ fixturePlayback?: string; fixture?: string; trackingDebug?: string; templateId?: string }>();
  const fixturePlaybackRequested = params.fixturePlayback === '1';
  // Issue #447 — deep-link / scheduled-workout template binding.
  // Reads form-targets from the session-runner store (populated when the
  // session was started from this templateId by `materializeTemplate`).
  // No side-effects when no templateId is present.
  const deepLinkTemplateId = typeof params.templateId === 'string' ? params.templateId : null;
  const getFormTargetsFor = useSessionRunner((s) => s.getFormTargetsFor);
  // PR-detection surface (issue #447 W3-C item #2).
  const { pr: currentPR, clearPR: clearCurrentPR } = usePRDetection();
  // Progression suggestion surface (issue #447 W3-C item #3).
  // TODO(#434): wire lastSessionAvgFqi + lastWeight from session-runner
  // history once PR #434 lands its history-panel query. Until then, keep
  // the inputs null so the badge stays hidden. The hook + badge component
  // are production-ready; only the data feed is deferred.
  const progressionSuggestion = useProgressionSuggestion({
    exerciseId: null,
    lastSessionAvgFqi: null,
    lastWeight: null,
    unit: 'lb',
  });
  const fixtureName = typeof params.fixture === 'string' ? params.fixture : FIXTURE_PLAYBACK_DEFAULT;
  const fixtureFrames = fixturePlaybackRequested ? FIXTURE_PLAYBACK_TRACES[fixtureName] ?? null : null;
  const fixturePlaybackEnabled = fixturePlaybackRequested && !!fixtureFrames;
  const trackingDebugEnabled = DEV && params.trackingDebug === '1';
  const insets = useSafeAreaInsets();
  const topBarHeight = 44;
  const topBarPadding = 8;
  const topBarOffset = insets.top + topBarPadding;
  const topBarBottom = topBarOffset + topBarHeight;
  // ARKit body tracking supports back camera only; remove VisionCamera preview dependency.
  const cameraPosition = 'back' as const;
  const ensureMediaLibraryPermission = useCallback(async () => {
    if (Platform.OS === 'web') return false;
    try {
      const current = await MediaLibrary.getPermissionsAsync();
      if (current.granted) return true;
      const next = await MediaLibrary.requestPermissionsAsync();
      return next.granted;
    } catch (error) {
      warnWithTs('[ScanARKit] Media library permission check failed', error);
      return false;
    }
  }, []);
  
  const adaptiveFps = useAdaptiveFps();
  const {
    pose,
    pose2D,
    isSupported: nativeSupported,
    isTracking,
    startTracking: startNativeTracking,
    stopTracking: stopNativeTracking,
  } = useBodyTracking(60, { activeFps: adaptiveFps.fps });
  const [supportStatus, setSupportStatus] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');
  const [jointAngles, setJointAngles] = useState<JointAngles | null>(null);
  const [fps, setFps] = useState(0);
  const textOpacity = React.useRef(new Animated.Value(1)).current;
  const frameStatsRef = React.useRef({ lastTimestamp: 0, frameCount: 0 });
  const realtimeFormEngineRef = React.useRef(createRealtimeFormEngineState());
  const jointAnglesStateRef = React.useRef<JointAngles | null>(null);
  const [repCount, setRepCount] = useState(0);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>(DEFAULT_DETECTION_MODE);
  const activeWorkoutDef = useMemo(() => getWorkoutByMode(detectionMode), [detectionMode]);
  // Active form targets — resolved from session-runner (template override)
  // with a fall-through to per-exercise defaults. Exposed as a ref so the
  // cue-engine / FQI gauge can read without retriggering the whole render.
  // Issue #447 W3-C item #1.
  const activeFormTargets: FormTargets = useMemo(
    () => getFormTargetsFor(detectionMode),
    [getFormTargetsFor, detectionMode],
  );
  // Provenance flag — true when `detectionMode` isn't a first-class exercise
  // and the resolver fell back to DEFAULT_FORM_TARGETS. Kept as a boolean so
  // a later PR can light up a subtle "generic thresholds" badge without any
  // UI churn now. #575 item #8.
  const usingGenericTargets = useMemo(
    () => getDefaultsForExerciseWithFlag(detectionMode).usingGenericTargets,
    [detectionMode],
  );
  const usingGenericTargetsRef = React.useRef<boolean>(usingGenericTargets);
  useEffect(() => {
    usingGenericTargetsRef.current = usingGenericTargets;
  }, [usingGenericTargets]);
  const activeFormTargetsRef = React.useRef<FormTargets>(activeFormTargets);
  useEffect(() => {
    const prev = activeFormTargetsRef.current;
    activeFormTargetsRef.current = activeFormTargets;
    // When form targets shift (e.g. user just picked a template override for
    // the active exercise) the cue-hysteresis boundary that was computed
    // against the old thresholds becomes stale — already-spoken cues can
    // re-fire under the new boundary because the TTS hook's 5s repeat-guard
    // sees them as "different" cues. Reset both boundaries in tandem. Skip
    // on first-render init (prev === current) since nothing's rotated yet.
    // (#575 item #1, targets-only leg.)
    const targetsChanged =
      prev !== activeFormTargets &&
      (prev.fqiMin !== activeFormTargets.fqiMin ||
        prev.romMin !== activeFormTargets.romMin ||
        prev.romMax !== activeFormTargets.romMax);
    if (targetsChanged) {
      cueHysteresisControllerRef.current.resetAll();
      cueHysteresisLastTickRef.current = null;
      stablePrimaryCueRef.current = null;
      lastSpokenCueRef.current = null;
    }
    if (deepLinkTemplateId) {
      logWithTs('[ScanARKit] Active form targets', {
        exerciseId: detectionMode,
        templateId: deepLinkTemplateId,
        fqiMin: activeFormTargets.fqiMin,
        romMin: activeFormTargets.romMin,
        romMax: activeFormTargets.romMax,
      });
    }
  }, [activeFormTargets, detectionMode, deepLinkTemplateId]);
  const [activePhase, setActivePhase] = useState<string>(getWorkoutByMode(DEFAULT_DETECTION_MODE).initialPhase);
  const [audioFeedbackEnabled, setAudioFeedbackEnabled] = useState(true);
  // Mirror for callback-stable access inside memoized workout callbacks.
  // Updating a ref keeps `workoutControllerCallbacks` from churning every
  // time the user flips the audio-cue switch.
  const audioFeedbackEnabledRef = React.useRef<boolean>(true);
  useEffect(() => {
    audioFeedbackEnabledRef.current = audioFeedbackEnabled;
  }, [audioFeedbackEnabled]);
  const activePhaseRef = React.useRef<string>(getWorkoutByMode(DEFAULT_DETECTION_MODE).initialPhase);
  // Tracks the current workout's resting/initial phase so timer callbacks can
  // cheaply skip heavy work while the user is between reps.
  const restPhaseRef = React.useRef<string>(getWorkoutByMode(DEFAULT_DETECTION_MODE).initialPhase);
  const [activeMetrics, setActiveMetrics] = useState<WorkoutMetrics | null>(null);
  const lastMetricsPublishRef = React.useRef<number | null>(null);
  const [latestFqiScore, setLatestFqiScore] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [recordPreview, setRecordPreview] = useState<RecordedPreview | null>(null);
  const [recordingQuality, setRecordingQuality] = useState<RecordingQuality>('medium');
  const [recordingStartStatus, setRecordingStartStatus] = useState<'idle' | 'starting-camera' | 'waiting-for-skeleton'>('idle');
  const [subjectLockEnabled, setSubjectLockEnabled] = useState(true);
  const [gestureRecordingEnabled, setGestureRecordingEnabled] = useState(true);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Retry-able upload failure surface. When a manual video upload
  // rejects (network blip, auth refresh, 5xx), we stash the last
  // attempted payload so the banner's "Retry" action can re-invoke
  // uploadRecordedVideo without requiring the user to re-encode or
  // navigate back to the preview. Cleared on success / dismiss.
  const [uploadRetryPayload, setUploadRetryPayload] = useState<{
    uri: string;
    exercise: string;
    metrics: ClipUploadMetrics;
    message: string;
  } | null>(null);
  const lastUploadPayloadRef = React.useRef<{
    uri: string;
    exercise: string;
    metrics: ClipUploadMetrics;
  } | null>(null);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isExitMidSessionSheetVisible, setIsExitMidSessionSheetVisible] = useState(false);
  const [showDebugStats, setShowDebugStats] = useState(false);
  const [fixturePlaybackFramesProcessed, setFixturePlaybackFramesProcessed] = useState(0);
  const [latestPullupScoring, setLatestPullupScoring] = useState<PullupScoringResult | null>(null);
  const [livePullupPartialStatus, setLivePullupPartialStatus] = useState<
    Pick<PullupScoringResult, 'visibility_badge' | 'missing_components'> | null
  >(null);
  const partialWarningVisibleRef = React.useRef(false);
  const lastLivePartialBadgeRef = React.useRef<PullupScoringResult['visibility_badge'] | null>(null);
  const [showPartialTrackingBadge, setShowPartialTrackingBadge] = useState(false);
  const [partialTrackingBannerDismissedUntilMs, setPartialTrackingBannerDismissedUntilMs] = useState(0);
  const [trackingRecoveredPulseId, setTrackingRecoveredPulseId] = useState<number | null>(null);
  const baselineDebugEnabled = DEV && showDebugStats;
  const baselineDebugEnabledRef = React.useRef(baselineDebugEnabled);
  const baselineDebugMetricsRef = React.useRef<BaselineDebugMetrics>(createBaselineDebugMetrics());
  const [savingRecording, setSavingRecording] = useState(false);
  const recordingStopInFlightRef = React.useRef(false);
  const pendingRecordAfterTrackingRef = React.useRef(false);
  const resumeTrackingAfterPermissionGrantRef = React.useRef(false);
  const stopTrackingRef = React.useRef<(() => Promise<void>) | null>(null);
  const [smoothedPose2DJoints, setSmoothedPose2DJoints] = useState<Joint2D[] | null>(null);
  const smoothedPose2DRef = React.useRef<Joint2D[] | null>(null);
  // LRU cache keyed by lowercased joint name. Map preserves insertion order,
  // so reinserting on update pushes the key to the most-recently-used tail
  // and the head is always the oldest candidate for eviction.
  const pose2DCacheRef = React.useRef<Map<string, { x: number; y: number }>>(new Map());
  // Exposed via `__getPose2DCacheSizeForTests` for regression guards.
  const pose2DCacheKeysRef = React.useRef<number | null>(null);
  const lastSpokenCueRef = React.useRef<{ cue: string; timestamp: number } | null>(null);
  const cueRotatorRef = useRef(createCueRotator(CUE_ROTATION_VARIANTS));
  const cueHysteresisControllerRef = React.useRef(
    new CueHysteresisController<string>({ showFrames: SHOW_N_FRAMES, hideFrames: HIDE_N_FRAMES })
  );
  const cueHysteresisLastTickRef = React.useRef<string | null>(null);
  const stablePrimaryCueRef = React.useRef<string | null>(null);
  const gestureHoldStartRef = React.useRef<number | null>(null);
  const lastGestureTriggerRef = React.useRef(0);
  const overlayLayout = React.useRef<{ width: number; height: number } | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [preSetPreviewVisible, setPreSetPreviewVisible] = useState(false);
  const [showCameraGuide, setShowCameraGuide] = useState(true);
  const preSetPreview = usePreSetPreview();
  const isScreenFocused = useIsFocused();
  const sessionIdRef = React.useRef(generateSessionId());
  const sessionStartRef = React.useRef(new Date().toISOString());
  const cueCountersRef = React.useRef({ total: 0, spoken: 0, droppedRepeat: 0, droppedDisabled: 0 });
  const fpsStatsRef = React.useRef<{ count: number; sum: number; min: number }>({ count: 0, sum: 0, min: Number.POSITIVE_INFINITY });
  // Wall-clock of the last FPS publish so we can throttle to 500ms intervals
  // independent of the ARKit frame timestamp clock.
  const lastFpsPublishMsRef = React.useRef<number>(0);

  // Form-tracking resilience (#445): subject identity, camera permission and
  // app-state pause guards run whenever tracking is active.
  const subjectIdentity = useSubjectIdentity({ enabled: isTracking });
  const cameraPermission = useCameraPermissionGuard();
  const appStatePause = useAppStatePause({ enabled: isTracking });
  const [sustainedOcclusionHint, setSustainedOcclusionHint] =
    useState<SustainedOcclusionEvent | null>(null);
  const sustainedOcclusionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persistent banner (#551): the sustained-occlusion cue used to auto-
  // dismiss after 3.2s, which meant a user whose hand was covering a
  // joint long enough for the native manager to fire the event lost the
  // guidance almost immediately — especially bad when the joint stayed
  // hidden. The banner now sticks until the user taps "Got it" (via
  // dismissSustainedOcclusion below); re-entry of a sustained occlusion
  // with a different joint set overwrites the existing banner.
  const handleSustainedOcclusion = useCallback((event: SustainedOcclusionEvent) => {
    setSustainedOcclusionHint(event);
  }, []);
  const dismissSustainedOcclusion = useCallback(() => {
    setSustainedOcclusionHint(null);
  }, []);
  const occlusionManagerRef = React.useRef<OcclusionHoldManager | null>(null);
  if (occlusionManagerRef.current === null) {
    occlusionManagerRef.current = new OcclusionHoldManager({
      sustainFrames: 30,
      onSustainedOcclusion: handleSustainedOcclusion,
    });
  }
  // ---------------------------------------------------------------

  const [watchMirrorEnabled, setWatchMirrorEnabled] = useState(Platform.OS === 'ios');
  const [watchPaired, setWatchPaired] = useState(false);
  const [watchInstalled, setWatchInstalled] = useState(false);
  const [watchReachable, setWatchReachable] = useState(false);
  const watchMirrorTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const watchMirrorPublisher = React.useRef(createWatchMirrorPublisher()).current;
  const watchMirrorSvgRef = React.useRef<Svg | null>(null);
  const watchTrackingPublicationRef = React.useRef<WatchTrackingPublicationState>({ lastSubmission: null, timestamp: 0 });
  const lastTrackingQualityRef = React.useRef<number | null>(null);
  // Tracks the previous confidence tier so mid-set degradation warnings fire
  // once on the high → low transition edge rather than on every frame. See
  // emitMidSetDegradationIfTransition below for the thresholds.
  const lastConfidenceTierRef = React.useRef<'high' | 'low' | null>(null);
  const [shadowModeEnabled, setShadowModeEnabled] = useState(true);
  const shadowModeEnabledRef = React.useRef(true);
  const shadowStatsRef = React.useRef(createShadowStatsAccumulator());
  // Per-rep shadow-drift accumulator — reset at each rep-start phase
  // transition so callers (realtime pipeline, UI, future telemetry) see a
  // fresh drift window per rep rather than a cumulative session average
  // that gets dominated by any single bad rep.
  const shadowStatsPerRepRef = React.useRef(createShadowStatsAccumulator());
  const [shadowProviderRuntime, setShadowProviderRuntime] = useState<ShadowProvider>('mediapipe_proxy');
  const shadowProviderRuntimeRef = React.useRef<ShadowProvider>('mediapipe_proxy');
  const shadowProviderCountsRef = React.useRef(createShadowProviderCounts());
  const mediaPipePoseRef = React.useRef<MediaPipePose2D | null>(null);
  const mediaPipeModelVersionRef = React.useRef<string>(MEDIAPIPE_POSE_LANDMARKER_VERSION);
  const lastShadowMeanAbsDeltaRef = React.useRef<number | null>(null);
  const [mediaPipeModelPath, setMediaPipeModelPath] = useState<string | null>(null);
  // Tracks the initial pose-model download / init phase so the UI can
  // surface a "Downloading pose model…" modal. The flag starts as true
  // on iOS where the bundled MediaPipe Lite asset must be resolved
  // (and occasionally re-downloaded on first run). The effect below
  // that loads MEDIAPIPE_LITE_MODEL_ASSET flips it to false on success
  // OR failure, and supportStatus resolving to 'supported' /
  // 'unsupported' also clears it so the modal cannot persist past the
  // skeleton gate.
  const [isPoseModelLoading, setIsPoseModelLoading] = useState<boolean>(
    Platform.OS === 'ios',
  );
  const mediaPipePollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaPipePollInFlightRef = React.useRef(false);
  const partialTrackingHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackingRecoveredTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const partialTrackingVisibleUntilMsRef = React.useRef(0);
  const trackingDebugEnabledRef = React.useRef(trackingDebugEnabled);

  useEffect(() => {
    trackingDebugEnabledRef.current = trackingDebugEnabled;
  }, [trackingDebugEnabled]);

  return {
    DEV, router, showToast, countAudioEnabledRef, hapticsEnabledRef, fixturePlaybackRequested,
    currentPR, clearCurrentPR, progressionSuggestion, fixtureName, fixtureFrames,
    fixturePlaybackEnabled, insets, topBarOffset, topBarBottom, cameraPosition,
    ensureMediaLibraryPermission, adaptiveFps, pose, pose2D, nativeSupported, isTracking,
    startNativeTracking, stopNativeTracking, supportStatus, setSupportStatus, jointAngles,
    setJointAngles, fps, setFps, textOpacity, frameStatsRef, realtimeFormEngineRef,
    jointAnglesStateRef, repCount, setRepCount, detectionMode, setDetectionMode,
    activeWorkoutDef, activeFormTargets, activePhase, setActivePhase, audioFeedbackEnabled,
    setAudioFeedbackEnabled, audioFeedbackEnabledRef, activePhaseRef, restPhaseRef,
    activeMetrics, setActiveMetrics, lastMetricsPublishRef, latestFqiScore, setLatestFqiScore,
    uploading, setUploading, isRecording, setIsRecording, isFinalizingRecording,
    setIsFinalizingRecording, recordPreview, setRecordPreview, recordingQuality,
    setRecordingQuality, recordingStartStatus, setRecordingStartStatus, subjectLockEnabled,
    setSubjectLockEnabled, gestureRecordingEnabled, setGestureRecordingEnabled, isPreviewVisible,
    setIsPreviewVisible, previewError, setPreviewError, uploadRetryPayload,
    setUploadRetryPayload, lastUploadPayloadRef, isSettingsVisible, setIsSettingsVisible,
    isExitMidSessionSheetVisible, setIsExitMidSessionSheetVisible, showDebugStats,
    setShowDebugStats, fixturePlaybackFramesProcessed, setFixturePlaybackFramesProcessed,
    latestPullupScoring, setLatestPullupScoring, livePullupPartialStatus,
    setLivePullupPartialStatus, partialWarningVisibleRef, lastLivePartialBadgeRef,
    showPartialTrackingBadge, setShowPartialTrackingBadge, partialTrackingBannerDismissedUntilMs,
    setPartialTrackingBannerDismissedUntilMs, trackingRecoveredPulseId,
    setTrackingRecoveredPulseId, baselineDebugEnabled, baselineDebugEnabledRef,
    baselineDebugMetricsRef, savingRecording, setSavingRecording, recordingStopInFlightRef,
    pendingRecordAfterTrackingRef, resumeTrackingAfterPermissionGrantRef, stopTrackingRef,
    smoothedPose2DJoints, setSmoothedPose2DJoints, smoothedPose2DRef, pose2DCacheRef,
    pose2DCacheKeysRef, lastSpokenCueRef, cueRotatorRef, cueHysteresisControllerRef,
    cueHysteresisLastTickRef, stablePrimaryCueRef, gestureHoldStartRef, lastGestureTriggerRef,
    overlayLayout, isDropdownOpen, setIsDropdownOpen, preSetPreviewVisible,
    setPreSetPreviewVisible, showCameraGuide, setShowCameraGuide, preSetPreview, isScreenFocused,
    sessionIdRef, sessionStartRef, cueCountersRef, fpsStatsRef, lastFpsPublishMsRef,
    subjectIdentity, cameraPermission, appStatePause, sustainedOcclusionHint,
    setSustainedOcclusionHint, sustainedOcclusionTimerRef, dismissSustainedOcclusion,
    occlusionManagerRef, watchMirrorEnabled, setWatchMirrorEnabled, watchPaired, setWatchPaired,
    watchInstalled, setWatchInstalled, watchReachable, setWatchReachable, watchMirrorTimerRef,
    watchMirrorPublisher, watchMirrorSvgRef, watchTrackingPublicationRef, lastTrackingQualityRef,
    lastConfidenceTierRef, shadowModeEnabled, setShadowModeEnabled, shadowModeEnabledRef,
    shadowStatsRef, shadowStatsPerRepRef, shadowProviderRuntime, setShadowProviderRuntime,
    shadowProviderRuntimeRef, shadowProviderCountsRef, mediaPipePoseRef,
    mediaPipeModelVersionRef, lastShadowMeanAbsDeltaRef, mediaPipeModelPath,
    setMediaPipeModelPath, isPoseModelLoading, setIsPoseModelLoading, mediaPipePollTimerRef,
    mediaPipePollInFlightRef, partialTrackingHideTimerRef, trackingRecoveredTimerRef,
    partialTrackingVisibleUntilMsRef, trackingDebugEnabledRef,
  };
}

export type ScanSessionStateCtx = ReturnType<typeof useScanSessionState>;
