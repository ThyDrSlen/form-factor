import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createCueRotator } from '@/lib/services/cue-rotator';
import { CUE_ROTATION_VARIANTS } from '@/lib/services/cue-rotator-variants';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  Platform,
  Animated,
  ToastAndroid,
  LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Svg, Circle, Line, Rect } from 'react-native-svg';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import {
  watchEvents,
  sendMessage,
  updateWatchContext,
  getIsPaired,
  getIsWatchAppInstalled,
  getReachability,
} from '@/lib/watch-connectivity';
import { buildWatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';
import { errorWithTs, logWithTs, warnWithTs } from '@/lib/logger';

// Import ARKit module - Metro auto-resolves to .ios.ts or .web.ts
import { BodyTracker, useBodyTracking, type JointAngles, type Joint2D, type MediaPipePose2D } from '@/lib/arkit/ARKitBodyTracker';
import { usePremiumCueAudio } from '@/hooks/use-premium-cue-audio';
import { audioSessionManager } from '@/lib/services/audio-session-manager';
import { useToast } from '@/contexts/ToastContext';
import { CrashBoundary } from '@/components/CrashBoundary';
import { ARKitUnsupportedPlaceholder } from '@/components/form-tracking/ARKitUnsupportedPlaceholder';
import { ExitMidSessionSheet } from '@/components/form-tracking/ExitMidSessionSheet';
import { PreSetPreviewCard } from '@/components/form-tracking/PreSetPreviewCard';
import { usePreSetPreview } from '@/hooks/use-pre-set-preview';
import { generateSessionId, logCueEvent, upsertSessionMetrics } from '@/lib/services/cue-logger';
import { logPoseSample, flushPoseBuffer, resetFrameCounter } from '@/lib/services/pose-logger';
import {
  appendFormSessionHistory,
  countConsecutiveSessionDays,
  countPbsThisMonth,
  getFormSessionHistory,
} from '@/lib/services/form-session-history';
import { playRepCountdown } from '@/lib/services/rep-countdown-audio';
import { RepIndexTracker } from '@/lib/services/rep-index-tracker';
import { saveSessionSnapshot } from '@/lib/services/session-snapshot';
import {
  initSessionContext,
  incrementPoseLost,
  markCuesDisabled,
  getSessionQuality,
} from '@/lib/services/telemetry-context';
import { buildArkitCanonicalFrame } from '@/lib/pose/adapters/arkit-workout-adapter';
import {
  buildMediaPipeShadowFrameFromArkit2D,
  MEDIAPIPE_SHADOW_PROXY_VERSION,
} from '@/lib/pose/adapters/mediapipe-shadow-proxy';
import {
  buildMediaPipeShadowFrameFromLandmarks,
  MEDIAPIPE_POSE_LANDMARKER_VERSION,
} from '@/lib/pose/adapters/mediapipe-workout-adapter';
import {
  accumulateShadowStats,
  compareJointAngles,
  createShadowStatsAccumulator,
  finalizeShadowStats,
} from '@/lib/pose/shadow-metrics';
import {
  bumpShadowProviderCount,
  createShadowProviderCounts,
  selectShadowProvider,
  summarizeShadowProvider,
  type ShadowProvider,
} from '@/lib/pose/shadow-provider';
import { createRealtimeFormEngineState, processRealtimeAngles } from '@/lib/pose/realtime-form-engine';
import {
  createTrackingQualityPipelineState,
  HIDE_N_FRAMES,
  processTrackingQualityAngles,
  readUseNewTrackingPipelineFlag,
  scorePullupWithComponentAvailability,
  SHOW_N_FRAMES,
  type PullupScoringResult,
} from '@/lib/tracking-quality';
import { CueHysteresisController } from '@/lib/tracking-quality/cue-hysteresis';
import { useWorkoutController } from '@/hooks/use-workout-controller';
import { usePRDetection } from '@/hooks/use-pr-detection';
import { PRCelebrationBadge } from '@/components/form-tracking/PRCelebrationBadge';
import { ProgressionSuggestionBadge } from '@/components/form-tracking/ProgressionSuggestionBadge';
import { useProgressionSuggestion } from '@/hooks/use-progression-suggestion';
import { emitFormMilestone, useSessionRunner } from '@/lib/stores/session-runner';
import type { FormTargets } from '@/lib/services/form-target-resolver';
import {
  DEFAULT_DETECTION_MODE,
  getWorkoutByMode,
  getWorkoutIds,
  getPhaseStaticCue,
  type DetectionMode,
} from '@/lib/workouts';
import type { WorkoutMetrics } from '@/lib/types/workout-definitions';
import { uploadWorkoutVideo } from '@/lib/services/video-service';
import { buildVideoMetricsForClip, type RecordingQuality } from '@/lib/services/video-metrics';
import { shouldUploadVideo } from '@/lib/services/consent-service';
import type { PullupFixtureFrame } from '@/lib/debug/pullup-fixture-corpus';
import cameraFacingFixture from '@/tests/fixtures/pullup-tracking/camera-facing.json';
import backTurnedFixture from '@/tests/fixtures/pullup-tracking/back-turned.json';
import occlusionBriefFixture from '@/tests/fixtures/pullup-tracking/occlusion-brief.json';
import occlusionLongFixture from '@/tests/fixtures/pullup-tracking/occlusion-long.json';
import bounceNoiseFixture from '@/tests/fixtures/pullup-tracking/bounce-noise.json';
import { styles } from '../../styles/tabs/_scan-arkit.styles';
import { spacing } from '../../styles/tabs/_theme-constants';
import { VoiceCommandFeedback } from '@/components/form-tracking/VoiceCommandFeedback';
import { CameraPermissionBanner } from '@/components/form-tracking/CameraPermissionBanner';
// W3-A resilience (#445) — hooks + services.
import { isAROverlaysV2Enabled } from '@/lib/services/ar-overlays-v2-flag';
import { useSubjectIdentity } from '@/hooks/use-subject-identity';
import { useCameraPermissionGuard } from '@/hooks/use-camera-permission-guard';
import { useAppStatePause } from '@/hooks/use-app-state-pause';
import { useAdaptiveFps } from '@/hooks/use-adaptive-fps';
import { OcclusionHoldManager, type SustainedOcclusionEvent } from '@/lib/tracking-quality/occlusion';
// W3-D AR overlays (#445) — SVG overlays gated by the same feature flag.
import { FramingGuide } from '@/components/form-tracking/FramingGuide';
import { JointArcOverlay } from '@/components/form-tracking/JointArcOverlay';
import { CueArrowOverlay, type CueSeverity } from '@/components/form-tracking/CueArrowOverlay';
import { ROMProgressBar } from '@/components/form-tracking/ROMProgressBar';
import { FaultHighlight } from '@/components/form-tracking/FaultHighlight';

// Phase and detection mode types are now imported from lib/workouts
type BaseUploadMetrics = Record<string, unknown> & {
  mode: DetectionMode;
  reps: number;
};

type ClipMetaMetrics = {
  avgFqi: number | null;
  formScore: number | null;
  sessionId: string;
  recordingQuality: RecordingQuality;
  recordingStartAt: string;
  recordingEndAt: string;
  recordingStartFrameTimestamp: number | null;
  recordingEndFrameTimestamp: number | null;
};

type ClipUploadMetrics = BaseUploadMetrics & ClipMetaMetrics;

type RecordedPreview = {
  uri: string;
  exercise: string;
  metrics: ClipUploadMetrics;
  sizeBytes: number | null;
  savedToLibrary: boolean;
};

// Thresholds are now imported from workout definitions (PULLUP_THRESHOLDS, PUSHUP_THRESHOLDS)

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
// Upper bound for the 2D pose smoothing cache. ARKit exposes ~20 joints;
// we allow modest alias headroom before LRU-evicting the oldest entry.
export const POSE2D_CACHE_MAX_ENTRIES = 30;
// Minimum wall-clock interval between FPS stat publishes. Frames can arrive
// at up to 60Hz; publishing state + debug logs on every frame wastes both
// render work and log bandwidth when only the smoothed average is useful.
export const FPS_PUBLISH_INTERVAL_MS = 500;
const WATCH_MIRROR_INTERVAL_MS = 750;
const WATCH_MIRROR_AR_QUALITY = 0.25;
const WATCH_MIRROR_MAX_WIDTH = 320;
const MEDIAPIPE_SHADOW_POLL_INTERVAL_MS = 100;
const MEDIAPIPE_MAX_TIMESTAMP_SKEW_SEC = 0.4;
const PARTIAL_TRACKING_BADGE_MIN_VISIBLE_MS = 900;
const PARTIAL_TRACKING_BADGE_HIDE_DELAY_MS = 350;
const FIXTURE_PLAYBACK_DEFAULT = 'camera-facing';
const FIXTURE_PLAYBACK_TRACES: Record<string, PullupFixtureFrame[]> = {
  'camera-facing': cameraFacingFixture as PullupFixtureFrame[],
  'back-turned': backTurnedFixture as PullupFixtureFrame[],
  'occlusion-brief': occlusionBriefFixture as PullupFixtureFrame[],
  'occlusion-long': occlusionLongFixture as PullupFixtureFrame[],
  'bounce-noise': bounceNoiseFixture as PullupFixtureFrame[],
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MEDIAPIPE_LITE_MODEL_ASSET = require('../../assets/models/pose_landmarker_lite.task');
const QUALITY_STORAGE_KEY = 'ff.recordingQuality';
const QUALITY_LABELS: Record<RecordingQuality, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
};

type BaselineLatencyBucket = 'lt4' | 'lt8' | 'lt16' | 'gte16';

type BaselineDebugMetrics = {
  cueFlipCount: number;
  cueSamples: number;
  lastCue: string | null;
  latencyBuckets: Record<BaselineLatencyBucket, number>;
  frameLatencyTotalMs: number;
  frameLatencyCount: number;
};

type PullupComponentIndicator = {
  key: PullupScoringResult['missing_components'][number];
  label: string;
};

const PULLUP_COMPONENT_INDICATORS: PullupComponentIndicator[] = [
  { key: 'rom_score', label: 'ROM' },
  { key: 'symmetry_score', label: 'SYM' },
  { key: 'tempo_score', label: 'TMP' },
  { key: 'torso_stability_score', label: 'TOR' },
];

const createBaselineDebugMetrics = (): BaselineDebugMetrics => ({
  cueFlipCount: 0,
  cueSamples: 0,
  lastCue: null,
  latencyBuckets: {
    lt4: 0,
    lt8: 0,
    lt16: 0,
    gte16: 0,
  },
  frameLatencyTotalMs: 0,
  frameLatencyCount: 0,
});

const nowMs = (): number => {
  const perfNow = globalThis.performance?.now;
  if (typeof perfNow === 'function') {
    return perfNow.call(globalThis.performance);
  }
  return Date.now();
};

// Metrics types are now imported from workout definitions (PullUpMetrics, PushUpMetrics)

// Explicit alias map for skeleton overlay joint lookup.
// Keys are lowercased display names used in drawLine(); values are ordered
// fallback aliases (also lowercased) matching native ARKit joint names.
const SKELETON_JOINT_ALIASES: Record<string, string[]> = {
  root: ['root', 'hips_joint'],
  hips_joint: ['hips_joint', 'root'],
  spine_1_joint: ['spine_1_joint'],
  spine_2_joint: ['spine_2_joint'],
  spine_3_joint: ['spine_3_joint'],
  spine_4_joint: ['spine_4_joint', 'spine_3_joint'],
  spine_5_joint: ['spine_5_joint'],
  spine_6_joint: ['spine_6_joint'],
  spine_7_joint: ['spine_7_joint'],
  neck_1_joint: ['neck_1_joint', 'neck_2_joint', 'neck_3_joint', 'neck_4_joint'],
  neck_2_joint: ['neck_2_joint', 'neck_1_joint'],
  neck_3_joint: ['neck_3_joint'],
  neck_4_joint: ['neck_4_joint'],
  head_joint: ['head_joint'],
  left_shoulder_1_joint: ['left_shoulder_1_joint'],
  left_arm_joint: ['left_arm_joint'],
  left_forearm_joint: ['left_forearm_joint'],
  left_hand_joint: ['left_hand_joint'],
  right_shoulder_1_joint: ['right_shoulder_1_joint'],
  right_arm_joint: ['right_arm_joint'],
  right_forearm_joint: ['right_forearm_joint'],
  right_hand_joint: ['right_hand_joint'],
  left_upleg_joint: ['left_upleg_joint'],
  left_leg_joint: ['left_leg_joint'],
  left_foot_joint: ['left_foot_joint'],
  right_upleg_joint: ['right_upleg_joint'],
  right_leg_joint: ['right_leg_joint'],
  right_foot_joint: ['right_foot_joint'],
};

let ARKitView: any = View;
if (Platform.OS === 'ios') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ARKitView = require('@/lib/arkit/ARKitBodyView').default;
}

const formatBytes = (bytes?: number | null) => {
  if (bytes === null || bytes === undefined) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
};

const getMetricValue = (source: Record<string, unknown> | null | undefined, key: string): number | null => {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const formatMetricValue = (format: 'deg' | 'percent', value: number | null): string => {
  if (value === null) return '--';
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  return `${value.toFixed(1)}°`;
};

const formatDuration = (startIso: string | null | undefined, endIso: string | null | undefined): string => {
  if (!startIso || !endIso) return '--';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '--';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
};

const PreviewPlayer = ({ uri }: { uri: string }) => {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.play();
  });

  useEffect(() => {
    return () => {
      try {
        player.release();
      } catch {
        // Player may already be released
      }
    };
  }, [player]);

  return (
    <VideoView
      player={player}
      style={styles.previewVideo}
      contentFit="cover"
      nativeControls
    />
  );
};

export default function ScanARKitScreen() {
  const DEV = __DEV__;
  const router = useRouter();
  const { show: showToast } = useToast();
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
  
  const {
    pose,
    pose2D,
    isSupported: nativeSupported,
    isTracking,
    startTracking: startNativeTracking,
    stopTracking: stopNativeTracking,
  } = useBodyTracking(60);
  const [supportStatus, setSupportStatus] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');
  const [jointAngles, setJointAngles] = useState<JointAngles | null>(null);
  const [fps, setFps] = useState(0);
  const textOpacity = React.useRef(new Animated.Value(1)).current;
  const frameStatsRef = React.useRef({ lastTimestamp: 0, frameCount: 0 });
  const useNewTrackingPipeline = useMemo(() => readUseNewTrackingPipelineFlag(), []);
  const createRealtimeEngineState = useMemo(
    () => (useNewTrackingPipeline ? createTrackingQualityPipelineState : createRealtimeFormEngineState),
    [useNewTrackingPipeline]
  );
  const processRealtimeEngineAngles = useMemo(
    () => (useNewTrackingPipeline ? processTrackingQualityAngles : processRealtimeAngles),
    [useNewTrackingPipeline]
  );
  const realtimeFormEngineRef = React.useRef(createRealtimeEngineState());
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
  const activeFormTargetsRef = React.useRef<FormTargets>(activeFormTargets);
  useEffect(() => {
    activeFormTargetsRef.current = activeFormTargets;
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
  const [uploading, setUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [recordPreview, setRecordPreview] = useState<RecordedPreview | null>(null);
  const [recordingQuality, setRecordingQuality] = useState<RecordingQuality>('medium');
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
  const lastLivePartialBadgeRef = React.useRef<PullupScoringResult['visibility_badge'] | null>(null);
  const [showPartialTrackingBadge, setShowPartialTrackingBadge] = useState(false);
  const baselineDebugEnabled = DEV && showDebugStats;
  const baselineDebugEnabledRef = React.useRef(baselineDebugEnabled);
  const baselineDebugMetricsRef = React.useRef<BaselineDebugMetrics>(createBaselineDebugMetrics());
  const [savingRecording, setSavingRecording] = useState(false);
  const recordingStopInFlightRef = React.useRef(false);
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
  const preSetPreview = usePreSetPreview();
  const isScreenFocused = useIsFocused();
  const sessionIdRef = React.useRef(generateSessionId());
  const sessionStartRef = React.useRef(new Date().toISOString());
  const cueCountersRef = React.useRef({ total: 0, spoken: 0, droppedRepeat: 0, droppedDisabled: 0 });
  const fpsStatsRef = React.useRef<{ count: number; sum: number; min: number }>({ count: 0, sum: 0, min: Number.POSITIVE_INFINITY });
  // Wall-clock of the last FPS publish so we can throttle to 500ms intervals
  // independent of the ARKit frame timestamp clock.
  const lastFpsPublishMsRef = React.useRef<number>(0);

  // ---------------------------------------------------------------
  // W3-A form-tracking resilience (#445) — all behind the AR_OVERLAYS_V2
  // master feature flag so the legacy tree stays byte-identical until
  // EXPO_PUBLIC_AR_OVERLAYS_V2=on flips the whole package on.
  // ---------------------------------------------------------------
  const arOverlaysV2 = useMemo(() => isAROverlaysV2Enabled(), []);
  const subjectIdentity = useSubjectIdentity({ enabled: arOverlaysV2 && isTracking });
  const cameraPermission = useCameraPermissionGuard();
  const appStatePause = useAppStatePause({ enabled: arOverlaysV2 && isTracking });
  const adaptiveFps = useAdaptiveFps({ enabled: arOverlaysV2 });
  const [sustainedOcclusionHint, setSustainedOcclusionHint] =
    useState<SustainedOcclusionEvent | null>(null);
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
  const watchMirrorInFlightRef = React.useRef(false);
  const watchTrackingPublishAtRef = React.useRef(0);
  const watchTrackingSignatureRef = React.useRef<string | null>(null);
  const lastTrackingQualityRef = React.useRef<number | null>(null);
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
  const mediaPipePollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaPipePollInFlightRef = React.useRef(false);
  const partialTrackingHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const partialTrackingVisibleUntilMsRef = React.useRef(0);
  const trackingDebugEnabledRef = React.useRef(trackingDebugEnabled);

  useEffect(() => {
    trackingDebugEnabledRef.current = trackingDebugEnabled;
  }, [trackingDebugEnabled]);

  const logTrackingDebug = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!trackingDebugEnabledRef.current) return;
    logWithTs(`[ScanARKit][tracking-debug] ${event}`, payload);
  }, []);

  const resetBaselineDebugMetrics = useCallback(() => {
    baselineDebugMetricsRef.current = createBaselineDebugMetrics();
  }, []);

  const resetCueHysteresis = useCallback(() => {
    cueHysteresisControllerRef.current.resetAll();
    cueHysteresisLastTickRef.current = null;
    stablePrimaryCueRef.current = null;
  }, []);

  const updatePartialTrackingBadgeVisibility = useCallback((
    visibilityBadge: PullupScoringResult['visibility_badge'],
    source: 'frame-live' | 'onPullupScoring-rep-complete' | 'unknown' = 'unknown'
  ) => {
    if (partialTrackingHideTimerRef.current) {
      clearTimeout(partialTrackingHideTimerRef.current);
      partialTrackingHideTimerRef.current = null;
    }

    const now = Date.now();
    logTrackingDebug('partial-badge-update', {
      ts: now,
      source,
      visibilityBadge,
      fixturePlaybackEnabled,
      repCount,
      activePhase: activePhaseRef.current,
    });

    if (visibilityBadge === 'partial') {
      partialTrackingVisibleUntilMsRef.current = now + PARTIAL_TRACKING_BADGE_MIN_VISIBLE_MS;
      setShowPartialTrackingBadge(true);
      return;
    }

    const hideInMs = Math.max(0, partialTrackingVisibleUntilMsRef.current - now) + PARTIAL_TRACKING_BADGE_HIDE_DELAY_MS;
    partialTrackingHideTimerRef.current = setTimeout(() => {
      setShowPartialTrackingBadge(false);
      partialTrackingHideTimerRef.current = null;
    }, hideInMs);
  }, [fixturePlaybackEnabled, logTrackingDebug, repCount]);

  useEffect(() => {
    return () => {
      if (partialTrackingHideTimerRef.current) {
        clearTimeout(partialTrackingHideTimerRef.current);
        partialTrackingHideTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    baselineDebugEnabledRef.current = baselineDebugEnabled;
    if (!baselineDebugEnabled) {
      resetBaselineDebugMetrics();
    }
  }, [baselineDebugEnabled, resetBaselineDebugMetrics]);

  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(QUALITY_STORAGE_KEY)
      .then((value) => {
        if (!isMounted || !value) return;
        if (value === 'low' || value === 'medium' || value === 'high') {
          setRecordingQuality(value);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    shadowModeEnabledRef.current = shadowModeEnabled;
  }, [shadowModeEnabled]);

  useEffect(() => {
    shadowProviderRuntimeRef.current = shadowProviderRuntime;
  }, [shadowProviderRuntime]);

  useEffect(() => {
    BodyTracker.setSubjectLockEnabled(subjectLockEnabled);
  }, [subjectLockEnabled]);

  useEffect(() => {
    let cancelled = false;

    if (Platform.OS !== 'ios') {
      setMediaPipeModelPath(null);
      return () => {
        cancelled = true;
      };
    }

    const loadBundledModelPath = async () => {
      try {
        const modelAsset = Asset.fromModule(MEDIAPIPE_LITE_MODEL_ASSET);
        await modelAsset.downloadAsync();

        if (cancelled) {
          return;
        }

        const resolvedPath = modelAsset.localUri ?? modelAsset.uri ?? null;
        setMediaPipeModelPath(resolvedPath);

        if (DEV && resolvedPath) {
          logWithTs('[ScanARKit] MediaPipe model resolved', resolvedPath);
        }
      } catch (error) {
        if (!cancelled && DEV) {
          warnWithTs('[ScanARKit] Failed to resolve bundled MediaPipe model asset', error);
        }
        if (!cancelled) {
          setMediaPipeModelPath(null);
        }
      }
    };

    void loadBundledModelPath();

    return () => {
      cancelled = true;
    };
  }, [DEV]);

  useEffect(() => {
    let cancelled = false;

    if (Platform.OS !== 'ios' || !shadowModeEnabled || !isTracking) {
      setShadowProviderRuntime('mediapipe_proxy');
      mediaPipePoseRef.current = null;
      return () => {
        cancelled = true;
      };
    }

    const configure = async () => {
      const configured = await BodyTracker.configureMediaPipeShadow({
        modelPath: mediaPipeModelPath ?? undefined,
        modelName: 'pose_landmarker_lite',
        modelVersion: MEDIAPIPE_POSE_LANDMARKER_VERSION,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      if (cancelled) {
        return;
      }

      if (configured) {
        setShadowProviderRuntime('mediapipe');
        if (DEV) {
          logWithTs('[ScanARKit] MediaPipe shadow configured');
        }
      } else {
        setShadowProviderRuntime('mediapipe_proxy');
        mediaPipePoseRef.current = null;
        if (DEV) {
          warnWithTs('[ScanARKit] MediaPipe shadow unavailable, falling back to proxy provider');
        }
        // Surface the fallback to the user. Previously this was DEV-only,
        // so prod users would silently drop onto the proxy provider with
        // no explanation for the accuracy regression.
        showToast('Pose tracking degraded — using fallback.', { type: 'info' });
      }
    };

    configure().catch((error) => {
      if (!cancelled && DEV) {
        warnWithTs('[ScanARKit] Failed to configure MediaPipe shadow', error);
      }
      if (!cancelled) {
        setShadowProviderRuntime('mediapipe_proxy');
        showToast('Pose tracking degraded — using fallback.', { type: 'info' });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [DEV, isTracking, mediaPipeModelPath, shadowModeEnabled, showToast]);

  useEffect(() => {
    const shouldPollMediaPipe =
      Platform.OS === 'ios' &&
      isTracking &&
      shadowModeEnabled &&
      shadowProviderRuntime === 'mediapipe';

    // Shared teardown helper — called unconditionally from the effect
    // cleanup so the interval + in-flight flag reset always fire on
    // unmount regardless of which branch of the effect ran. Previously the
    // cleanup duplicated this logic and could drift from the guard-block
    // version if only one site was updated during a refactor.
    const teardownPoll = () => {
      if (mediaPipePollTimerRef.current) {
        clearInterval(mediaPipePollTimerRef.current);
        mediaPipePollTimerRef.current = null;
      }
      mediaPipePollInFlightRef.current = false;
    };

    if (!shouldPollMediaPipe) {
      teardownPoll();
      mediaPipePoseRef.current = null;
      return teardownPoll;
    }

    let active = true;

    const poll = async () => {
      if (!active || mediaPipePollInFlightRef.current) {
        return;
      }

      // Skip heavy native poll while the user is in the resting/idle phase
      // between reps — shadow comparison only matters during the active rep.
      if (activePhaseRef.current === restPhaseRef.current) {
        return;
      }

      mediaPipePollInFlightRef.current = true;
      try {
        const payload = await BodyTracker.getCurrentMediaPipePose2D();
        if (!active || !payload || payload.landmarks.length === 0) {
          return;
        }
        mediaPipePoseRef.current = payload;
        if (payload.modelVersion) {
          mediaPipeModelVersionRef.current = payload.modelVersion;
        }
      } catch (error) {
        if (DEV) {
          warnWithTs('[ScanARKit] MediaPipe shadow poll failed', error);
        }
      } finally {
        mediaPipePollInFlightRef.current = false;
      }
    };

    void poll();
    mediaPipePollTimerRef.current = setInterval(() => {
      void poll();
    }, MEDIAPIPE_SHADOW_POLL_INTERVAL_MS);

    return () => {
      active = false;
      // Always run teardown, unconditionally, outside any guard — a
      // leaked interval keeps waking the native bridge after the user
      // leaves the scan tab and tanks battery/thermal.
      teardownPoll();
    };
  }, [DEV, isTracking, shadowModeEnabled, shadowProviderRuntime]);

  const updateRecordingQuality = useCallback(async (value: RecordingQuality) => {
    setRecordingQuality(value);
    try {
      await AsyncStorage.setItem(QUALITY_STORAGE_KEY, value);
    } catch {}
  }, []);

  const repIndexTrackerRef = React.useRef(new RepIndexTracker());

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
        repCount,
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
  }, [audioFeedbackEnabled, stopSpeech, isTracking]);

  useEffect(() => {
    if (!isScreenFocused) {
      lastSpokenCueRef.current = null;
      stopSpeech();
    }
  }, [isScreenFocused, stopSpeech]);

  // Each new tracking session starts cue rotation at variant 0 so support
  // debugging is deterministic and users always hear the most familiar
  // phrasing first.
  useEffect(() => {
    if (isTracking) {
      cueRotatorRef.current.reset();
    }
  }, [isTracking]);

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
    realtimeFormEngineRef.current = createRealtimeEngineState();
    lastShadowMeanAbsDeltaRef.current = null;
    resetBaselineDebugMetrics();
  }, [createRealtimeEngineState, resetBaselineDebugMetrics, showToast]);

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
        ? summarizeShadowProvider(shadowProviderCountsRef.current, shadowProviderRuntimeRef.current)
        : undefined;
      const shadowModelVersion = shadowModeEnabledRef.current
        ? shadowProvider === 'mediapipe'
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
  }, []);

  const transitionPhase = useCallback((next: string) => {
    if (activePhaseRef.current !== next) {
      activePhaseRef.current = next;
      setActivePhase(next);
    }
  }, []);

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
      repIndexTrackerRef.current.endRep();
      // Clear the in-flight rep timestamp; live partial scoring between
      // reps will fall back to the 1000ms safe default until the next
      // rep-start phase transition captures a fresh epoch.
      repStartTsRef.current = 0;
      if (Number.isFinite(fqi)) {
        sessionFqiScoresRef.current.push(fqi);
      }
      if (recordingActiveRef.current && Date.now() >= recordingStartEpochMsRef.current) {
        recordingFqiScoresRef.current.push(fqi);
      }
      // Additive rep-complete haptic: the workout controller already fires
      // a Light impact through the shared haptic bus, but testers reported
      // that in noisy gym environments the light tap is easy to miss. When
      // the user has audio/cue feedback enabled we also fire a Heavy impact
      // here so successful reps register unambiguously. Gated by
      // audioFeedbackEnabledRef.current (mirrors the cue-audio toggle) so
      // users who explicitly silenced cues don't get a phantom extra buzz.
      if (audioFeedbackEnabledRef.current) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {
          /* native bridge unavailable — silent */
        });
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
  }), [activeWorkoutDef, repCount, transitionPhase, updatePartialTrackingBadgeVisibility]);

  const workoutController = useWorkoutController(detectionMode, {
    sessionId: sessionIdRef.current,
    callbacks: workoutControllerCallbacks,
    enableHaptics: true,
  });

  const {
    processFrame: processWorkoutFrame,
    reset: resetWorkoutController,
    setWorkout: setWorkoutController,
    addRepCue: addWorkoutRepCue,
  } = workoutController;

  useEffect(() => {
    const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
    activePhaseRef.current = nextInitialPhase;
    restPhaseRef.current = nextInitialPhase;
    setActivePhase(nextInitialPhase);
    setRepCount(0);
    setActiveMetrics(null);
    setLivePullupPartialStatus(null);
    lastLivePartialBadgeRef.current = null;
    repIndexTrackerRef.current.reset();
    shadowStatsRef.current = createShadowStatsAccumulator();
    shadowStatsPerRepRef.current = createShadowStatsAccumulator();
    shadowProviderCountsRef.current = createShadowProviderCounts();
    mediaPipePoseRef.current = null;
    realtimeFormEngineRef.current = createRealtimeEngineState();
    lastShadowMeanAbsDeltaRef.current = null;
    resetBaselineDebugMetrics();
    setWorkoutController(detectionMode);
  }, [createRealtimeEngineState, detectionMode, resetBaselineDebugMetrics, setWorkoutController]);

  useEffect(() => {
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
      if (DEV) logWithTs('[ScanARKit] Device NOT supported');
      setSupportStatus('unsupported');
    }
  }, [nativeSupported, fixturePlaybackRequested, fixturePlaybackEnabled, fixtureName, DEV]);

  useEffect(() => {
    setLatestPullupScoring(null);
    setShowPartialTrackingBadge(false);
    partialTrackingVisibleUntilMsRef.current = 0;
    if (partialTrackingHideTimerRef.current) {
      clearTimeout(partialTrackingHideTimerRef.current);
      partialTrackingHideTimerRef.current = null;
    }
  }, [detectionMode]);

  // Auto-start tracking when supported
  useEffect(() => {
    if (DEV) {
      logWithTs('[ScanARKit] Auto-start check:', {
        supportStatus,
        isTracking,
        cameraPosition,
        willStart: supportStatus === 'supported' && !isTracking && cameraPosition === 'back'
      });
    }
    
    if (fixturePlaybackEnabled) {
      return;
    }

    if (supportStatus === 'supported' && !isTracking && cameraPosition === 'back') {
      if (DEV) logWithTs('[ScanARKit] ✅ Auto-starting tracking...');
      startTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportStatus, isTracking, cameraPosition, fixturePlaybackEnabled]);

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
    setActiveMetrics(null);
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
  }, [
    fixturePlaybackEnabled,
    fixtureFrames,
    fixtureName,
    detectionMode,
    transitionPhase,
    resetWorkoutController,
    processWorkoutFrame,
    DEV,
    resetBaselineDebugMetrics,
    resetCueHysteresis,
  ]);

  // Debug pose updates (throttled logging)
  useEffect(() => {
    const frameProcessStartMs = baselineDebugEnabledRef.current ? nowMs() : null;
    if (!pose) {
      if (baselineDebugEnabledRef.current) {
        logWithTs('[ScanARKit] ℹ️ No pose data');
      }
      // Track pose lost if we were previously tracking
      if (jointAnglesStateRef.current !== null && isTracking) {
        incrementPoseLost();
      }
      frameStatsRef.current = { lastTimestamp: 0, frameCount: 0 };
      lastFpsPublishMsRef.current = 0;
      setJointAngles(null);
      jointAnglesStateRef.current = null;
      realtimeFormEngineRef.current = createRealtimeEngineState();
      lastShadowMeanAbsDeltaRef.current = null;
      setFps(0);
      setSmoothedPose2DJoints(null);
      smoothedPose2DRef.current = null;
      pose2DCacheRef.current.clear();
      pose2DCacheKeysRef.current = null;
      setActiveMetrics(null);
      setLivePullupPartialStatus(null);
      lastLivePartialBadgeRef.current = null;
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      repIndexTrackerRef.current.reset();
      resetWorkoutController({ preserveRepCount: true });
      resetCueHysteresis();
      return;
    }

    lastPoseTimestampRef.current = pose.timestamp;

    // Only log every 30 frames (once per second at 30fps)
    const shouldLog = frameStatsRef.current.frameCount % 30 === 0;
    
    if (shouldLog && baselineDebugEnabledRef.current) {
      logWithTs('[ScanARKit] 📊 Pose update:', {
        joints: pose.joints.length,
        timestamp: pose.timestamp,
        isTracking: pose.isTracking,
        frameCount: frameStatsRef.current.frameCount
      });
    }

    try {
      const angles = BodyTracker.calculateAllAngles(pose);
      const jointLookupDebug: Record<string, unknown> = {};
      const get = (n: string) => {
        const selected = BodyTracker.findJoint(pose, n);
        if (trackingDebugEnabledRef.current) {
          const normalized = n.toLowerCase();
          const candidates = pose.joints
            .filter((joint) => joint.name.toLowerCase().includes(normalized))
            .map((joint) => ({
              name: joint.name,
              isTracked: joint.isTracked,
              x: Number(joint.x.toFixed(4)),
              y: Number(joint.y.toFixed(4)),
            }));
          jointLookupDebug[n] = {
            candidates,
            selected: selected
              ? {
                  name: selected.name,
                  isTracked: selected.isTracked,
                  x: Number(selected.x.toFixed(4)),
                  y: Number(selected.y.toFixed(4)),
                }
              : null,
          };
        }
        return selected;
      };
      const lh = get('left_upLeg');
      const lk = get('left_leg');
      const la = get('left_foot');
      const rh = get('right_upLeg');
      const rk = get('right_leg');
      const ra = get('right_foot');
      const ls = get('left_shoulder');
      const le = get('left_forearm');
      const lw = get('left_hand');
      const rs = get('right_shoulder');
      const re = get('right_forearm');
      const rw = get('right_hand');
      const spine = get('spine_4');
      const neck = get('neck');
      const valid = {
        leftKnee: !!(lh?.isTracked && lk?.isTracked && la?.isTracked),
        rightKnee: !!(rh?.isTracked && rk?.isTracked && ra?.isTracked),
        leftElbow: !!(ls?.isTracked && le?.isTracked && lw?.isTracked),
        rightElbow: !!(rs?.isTracked && re?.isTracked && rw?.isTracked),
        leftHip: !!(spine?.isTracked && lh?.isTracked && lk?.isTracked),
        rightHip: !!(spine?.isTracked && rh?.isTracked && rk?.isTracked),
        leftShoulder: !!(neck?.isTracked && ls?.isTracked && le?.isTracked),
        rightShoulder: !!(neck?.isTracked && rs?.isTracked && re?.isTracked),
      } as const;
      if (trackingDebugEnabledRef.current) {
        logTrackingDebug('joint-lookup-and-visibility', {
          ts: Date.now(),
          frameSource: fixturePlaybackEnabled ? 'fixture' : 'live',
          poseTimestamp: pose.timestamp,
          jointLookup: jointLookupDebug,
          valid,
          confidence: {
            neck: neck?.isTracked ?? false,
            leftShoulder: ls?.isTracked ?? false,
            rightShoulder: rs?.isTracked ?? false,
            leftForearm: le?.isTracked ?? false,
            rightForearm: re?.isTracked ?? false,
            leftHand: lw?.isTracked ?? false,
            rightHand: rw?.isTracked ?? false,
          },
        });
      }
      const smoothingResult =
        angles
          ? processRealtimeEngineAngles({
              state: realtimeFormEngineRef.current,
              angles,
              valid,
              timestampSec: pose.timestamp,
              shadowMeanAbsDelta: lastShadowMeanAbsDeltaRef.current,
            })
          : null;
      const next: JointAngles | null = smoothingResult?.angles ?? realtimeFormEngineRef.current.smoothed;

      if (shouldLog && next && baselineDebugEnabledRef.current) {
        logWithTs('[ScanARKit] 📐 Joint angles:', {
          leftKnee: next.leftKnee.toFixed(1),
          rightKnee: next.rightKnee.toFixed(1),
          leftElbow: next.leftElbow.toFixed(1),
          rightElbow: next.rightElbow.toFixed(1),
          smoothingAlpha: smoothingResult?.alpha?.toFixed(2) ?? null,
          trackingQuality: smoothingResult?.trackingQuality?.toFixed(2) ?? null,
        });
      }
      
      if (next) {
        const existingAngles = jointAnglesStateRef.current;
        const angleDrift =
          !existingAngles ||
          Math.abs(existingAngles.leftElbow - next.leftElbow) > 0.25 ||
          Math.abs(existingAngles.rightElbow - next.rightElbow) > 0.25 ||
          Math.abs(existingAngles.leftShoulder - next.leftShoulder) > 0.35 ||
          Math.abs(existingAngles.rightShoulder - next.rightShoulder) > 0.35 ||
          Math.abs(existingAngles.leftKnee - next.leftKnee) > 0.5 ||
          Math.abs(existingAngles.rightKnee - next.rightKnee) > 0.5;

        if (angleDrift) {
          jointAnglesStateRef.current = next;
          setJointAngles(next);
        }

        const jointsMap = new Map<string, { x: number; y: number; isTracked: boolean }>();
        pose.joints.forEach((joint) => {
          jointsMap.set(joint.name, { x: joint.x, y: joint.y, isTracked: joint.isTracked });
        });

        const canonicalFrame = buildArkitCanonicalFrame({
          angles: next,
          pose2D,
          timestamp: pose.timestamp,
        });

        let shadowFrame = null;
        if (shadowModeEnabledRef.current) {
          const latestMediaPipePose = mediaPipePoseRef.current;
           const selectedProvider = selectShadowProvider({
             preferredProvider: shadowProviderRuntimeRef.current,
             primaryTimestamp: pose.timestamp,
             mediaPipeTimestamp: latestMediaPipePose?.timestamp,
             maxTimestampSkewSec: MEDIAPIPE_MAX_TIMESTAMP_SKEW_SEC,
             isInActiveRep: repIndexTrackerRef.current.current() !== null,
           });
           logTrackingDebug('shadow-provider-selection', {
             ts: Date.now(),
             primaryTimestamp: pose.timestamp,
             mediaPipeTimestamp: latestMediaPipePose?.timestamp ?? null,
             selectedProvider,
             preferredProvider: shadowProviderRuntimeRef.current,
             isInActiveRep: repIndexTrackerRef.current.current() !== null,
           });

          if (selectedProvider === 'mediapipe' && latestMediaPipePose?.landmarks?.length) {
            shadowFrame = buildMediaPipeShadowFrameFromLandmarks({
              primaryAngles: next,
              landmarks: latestMediaPipePose.landmarks,
              timestamp: pose.timestamp,
              inferenceMs: latestMediaPipePose.inferenceMs,
              modelVersion: latestMediaPipePose.modelVersion ?? mediaPipeModelVersionRef.current,
            });
            if (latestMediaPipePose.modelVersion) {
              mediaPipeModelVersionRef.current = latestMediaPipePose.modelVersion;
            }
          } else {
            shadowFrame = buildMediaPipeShadowFrameFromArkit2D({
              primaryAngles: next,
              arkitJointMap: canonicalFrame.joints,
              timestamp: pose.timestamp,
            });
          }
        }

        const shadowComparison = shadowFrame
          ? compareJointAngles(next, shadowFrame.angles, {
              provider: shadowFrame.provider,
              modelVersion: shadowFrame.modelVersion,
              inferenceMs: shadowFrame.inferenceMs,
              coverageRatio: shadowFrame.coverageRatio,
            })
          : null;

        if (shadowComparison) {
          accumulateShadowStats(shadowStatsRef.current, shadowComparison);
          accumulateShadowStats(shadowStatsPerRepRef.current, shadowComparison);
          lastShadowMeanAbsDeltaRef.current = shadowComparison.meanAbsDelta;
          if (shadowFrame) {
            bumpShadowProviderCount(shadowProviderCountsRef.current, shadowFrame.provider);
          }
        } else {
          lastShadowMeanAbsDeltaRef.current = null;
        }

        // Log pose sample for ML modeling (only when tracking is active)
        if (next && isTracking) {
          const currentRepIndex = repIndexTrackerRef.current.current();

          logPoseSample({
            sessionId: sessionIdRef.current,
            frameTimestamp: pose.timestamp,
            exerciseMode: detectionMode,
            phase: activePhaseRef.current,
            repNumber: currentRepIndex,
            angles: next,
            fpsAtCapture: fps,
            shadowProvider: shadowFrame?.provider,
            shadowModelVersion: shadowFrame?.modelVersion,
            shadowAngles: shadowComparison?.shadowAngles,
            shadowAngleDelta: shadowComparison?.deltaByJoint,
            shadowMeanAbsDelta: shadowComparison?.meanAbsDelta,
            shadowP95AbsDelta: shadowComparison?.p95AbsDelta,
            shadowInferenceMs: shadowComparison?.inferenceMs,
            shadowComparedJoints: shadowComparison?.comparedJoints,
            shadowCoverageRatio: shadowComparison?.coverageRatio,
          }).catch((error) => {
            if (__DEV__) {
              warnWithTs('[ScanARKit] Failed to log pose sample', error);
            }
          });
        }

        const metrics = activeWorkoutDef.calculateMetrics(next, jointsMap) as WorkoutMetrics;
        setActiveMetrics(metrics);

        const shouldComputeLivePartial = detectionMode === 'pullup' && (isTracking || fixturePlaybackEnabled);
        if (shouldComputeLivePartial) {
          const livePartialScoring = scorePullupWithComponentAvailability({
            repAngles: {
              start: {
                leftElbow: next.leftElbow,
                rightElbow: next.rightElbow,
                leftShoulder: next.leftShoulder,
                rightShoulder: next.rightShoulder,
              },
              end: {
                leftElbow: next.leftElbow,
                rightElbow: next.rightElbow,
                leftShoulder: next.leftShoulder,
                rightShoulder: next.rightShoulder,
              },
              min: {
                leftElbow: next.leftElbow,
                rightElbow: next.rightElbow,
                leftShoulder: next.leftShoulder,
                rightShoulder: next.rightShoulder,
              },
              max: {
                leftElbow: next.leftElbow,
                rightElbow: next.rightElbow,
                leftShoulder: next.leftShoulder,
                rightShoulder: next.rightShoulder,
              },
            },
            // Use real elapsed time for the in-flight rep when available so
            // the live partial scoring (visibility badge + component
            // availability) reflects actual tempo instead of a 1s constant.
            // Fall back to 1000ms before the first rep-start transition.
            durationMs: repStartTsRef.current > 0
              ? Math.max(1, Date.now() - repStartTsRef.current)
              : 1000,
            joints: canonicalFrame.joints,
          });

          setLivePullupPartialStatus({
            visibility_badge: livePartialScoring.visibility_badge,
            missing_components: livePartialScoring.missing_components,
          });

          if (lastLivePartialBadgeRef.current !== livePartialScoring.visibility_badge) {
            lastLivePartialBadgeRef.current = livePartialScoring.visibility_badge;
            updatePartialTrackingBadgeVisibility(livePartialScoring.visibility_badge, 'frame-live');
          }
        } else {
          setLivePullupPartialStatus(null);
          lastLivePartialBadgeRef.current = null;
        }

        processWorkoutFrame(next, jointsMap, {
          trackingQuality: smoothingResult?.trackingQuality,
          shadowMeanAbsDelta: shadowComparison?.meanAbsDelta,
        });
        if (typeof smoothingResult?.trackingQuality === 'number') {
          lastTrackingQualityRef.current = smoothingResult.trackingQuality;
        }
      } else {
        lastTrackingQualityRef.current = null;
        repIndexTrackerRef.current.reset();
        resetWorkoutController({ preserveRepCount: true });
        setActiveMetrics(null);
        setLivePullupPartialStatus(null);
        lastLivePartialBadgeRef.current = null;
        activePhaseRef.current = activeWorkoutDef.initialPhase;
        transitionPhase(activeWorkoutDef.initialPhase);
      }
    } catch (error) {
      errorWithTs('[ScanARKit] ❌ Error calculating angles:', error);
    } finally {
      if (frameProcessStartMs !== null) {
        const elapsedMs = Math.max(0, nowMs() - frameProcessStartMs);
        const baselineMetrics = baselineDebugMetricsRef.current;
        baselineMetrics.frameLatencyCount += 1;
        baselineMetrics.frameLatencyTotalMs += elapsedMs;
        if (elapsedMs < 4) {
          baselineMetrics.latencyBuckets.lt4 += 1;
        } else if (elapsedMs < 8) {
          baselineMetrics.latencyBuckets.lt8 += 1;
        } else if (elapsedMs < 16) {
          baselineMetrics.latencyBuckets.lt16 += 1;
        } else {
          baselineMetrics.latencyBuckets.gte16 += 1;
        }
      }
    }

    frameStatsRef.current.frameCount += 1;
    if (frameStatsRef.current.lastTimestamp === 0) {
      frameStatsRef.current.lastTimestamp = pose.timestamp;
      lastFpsPublishMsRef.current = Date.now();
      return;
    }

    // Publish FPS on a fixed 500ms wall-clock cadence instead of
    // per-frame. Still use the pose timestamp delta to compute the rate so
    // the reported number reflects actual frame arrival (not clock skew).
    const nowWall = Date.now();
    if (nowWall - lastFpsPublishMsRef.current >= FPS_PUBLISH_INTERVAL_MS) {
      const elapsed = pose.timestamp - frameStatsRef.current.lastTimestamp;
      if (elapsed > 0) {
        const newFps = Math.round(frameStatsRef.current.frameCount / elapsed);
        if (baselineDebugEnabledRef.current) {
          logWithTs('[ScanARKit] 🎯 Performance:', {
            fps: newFps,
            totalFrames: frameStatsRef.current.frameCount
          });
        }
        setFps(newFps);
        fpsStatsRef.current.count += 1;
        fpsStatsRef.current.sum += newFps;
        fpsStatsRef.current.min = Math.min(fpsStatsRef.current.min, newFps);
        frameStatsRef.current = { lastTimestamp: pose.timestamp, frameCount: 0 };
      }
      lastFpsPublishMsRef.current = nowWall;
    }
  // Intentionally scoped to frame-driven inputs to avoid hot-path dependency churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, transitionPhase, detectionMode, activeWorkoutDef, processWorkoutFrame, resetWorkoutController, resetCueHysteresis]);

  // Debug pose2D updates
  useEffect(() => {
    if (pose2D && baselineDebugEnabledRef.current) {
      logWithTs('[ScanARKit] 📍 pose2D update:', {
        joints: pose2D.joints.length,
        tracked: pose2D.joints.filter(j => j.isTracked).length,
        isTracking: pose2D.isTracking
      });
    }
  }, [pose2D]);

  useEffect(() => {
    if (!pose2D || pose2D.joints.length === 0) {
      pose2DCacheRef.current.clear();
      pose2DCacheKeysRef.current = null;
      smoothedPose2DRef.current = null;
      setSmoothedPose2DJoints(null);
      return;
    }

    const alpha = 0.55;
    const cache = pose2DCacheRef.current;
    const joints = pose2D.joints;
    const seenKeys = new Set<string>();
    const nextJoints = joints.map((joint) => {
      if (!joint.isTracked) {
        return { ...joint };
      }
      const key = joint.name.toLowerCase();
      seenKeys.add(key);
      let prev = cache.get(key);
      // Drop any cached entry that was ever poisoned with a non-finite
      // component (NaN / +-Infinity). Without this guard a single bad
      // incoming frame would contaminate every subsequent eased value
      // because `prev.x + (target - prev.x) * alpha` === NaN, and the
      // result gets written back into the cache forever.
      if (prev && (!Number.isFinite(prev.x) || !Number.isFinite(prev.y))) {
        cache.delete(key);
        prev = undefined;
      }
      const targetX = joint.x;
      const targetY = joint.y;
      const safeTargetX = Number.isFinite(targetX) ? targetX : prev?.x ?? 0;
      const safeTargetY = Number.isFinite(targetY) ? targetY : prev?.y ?? 0;
      const easedX = prev ? prev.x + (safeTargetX - prev.x) * alpha : safeTargetX;
      const easedY = prev ? prev.y + (safeTargetY - prev.y) * alpha : safeTargetY;
      // Reinsert to move this key to the tail (most-recently-used) slot; Map
      // preserves insertion order so the head is always the oldest entry.
      if (prev) cache.delete(key);
      cache.set(key, { x: easedX, y: easedY });
      return { ...joint, x: easedX, y: easedY };
    });

    // Drop any untracked/stale aliases still lingering from a previous frame.
    for (const key of Array.from(cache.keys())) {
      if (!seenKeys.has(key)) {
        cache.delete(key);
      }
    }

    // Hard cap: evict oldest insertions beyond the bound. 30 covers every
    // joint we render on the skeleton overlay with room for alias spillover.
    while (cache.size > POSE2D_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    pose2DCacheKeysRef.current = cache.size;

    // The smoothed joints always live in a ref — the skeleton SVG below
    // reads from the ref during render, and `pose` state changes each frame
    // already force the containing component to re-render. We intentionally
    // avoid bumping React state on every pose tick; only flip
    // smoothedPose2DJoints state when the partial-tracking badge visibility
    // (i.e. whether we have *any* renderable tracked joints) changes, so
    // downstream gestureRecordingEnabled-style effects still fire on the
    // visible/hidden transition without re-running each frame.
    smoothedPose2DRef.current = nextJoints;
    const hasAnyTracked = nextJoints.some((joint) => joint.isTracked);
    setSmoothedPose2DJoints((prev) => {
      const prevHasAny = prev !== null && prev.length > 0 && prev.some((j) => j.isTracked);
      if (prevHasAny === hasAnyTracked) {
        return prev;
      }
      return hasAnyTracked ? nextJoints : null;
    });

    // W3-A resilience (#445): feed joints into the subject-identity
    // tracker + occlusion manager. Both are no-ops when AR_OVERLAYS_V2
    // is off thanks to `enabled` gating inside the hooks.
    if (arOverlaysV2 && hasAnyTracked) {
      subjectIdentity.step(nextJoints);
      const occMap: Record<string, { x: number; y: number; isTracked: boolean; confidence?: number } | null> = {};
      for (const j of nextJoints) {
        if (!j?.name) continue;
        occMap[j.name] = j.isTracked
          ? { x: j.x, y: j.y, isTracked: true, confidence: 0.9 }
          : null;
      }
      occlusionManagerRef.current?.update(occMap);
    }

    return undefined;
    // Intentionally keep dep list tight: adding subjectIdentity/arOverlaysV2
    // here would churn this frame-driven effect every snapshot change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose2D]);

  // Start tracking
  const startTracking = useCallback(async () => {
    if (DEV) logWithTs('[ScanARKit] Starting tracking...');
    if (cameraPosition !== 'back') {
      if (DEV) warnWithTs('[ScanARKit] Skipping tracking start: ARKit requires back camera');
      Alert.alert('Back camera required', 'ARKit body tracking only works with the back camera.');
      return;
    }
    try {
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      repIndexTrackerRef.current.reset();
      resetWorkoutController();
      setRepCount(0);
      setActiveMetrics(null);
      resetBaselineDebugMetrics();
      resetCueHysteresis();
      repCountdownFiredRef.current = false;
      sessionFqiScoresRef.current = [];
      repStartTsRef.current = 0;

      const startTime = Date.now();
      shadowStatsRef.current = createShadowStatsAccumulator();
      shadowProviderCountsRef.current = createShadowProviderCounts();
      mediaPipePoseRef.current = null;
      realtimeFormEngineRef.current = createRealtimeEngineState();
      lastShadowMeanAbsDeltaRef.current = null;
      await startNativeTracking();
      const elapsed = Date.now() - startTime;

      if (DEV) logWithTs('[ScanARKit] Tracking started successfully in', elapsed, 'ms');

      if (Platform.OS === 'ios') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Fire the 3-2-1 pre-announce once per tracking start. Gated on the
      // user preference + the EXPO_PUBLIC_REP_COUNTDOWN env flag inside
      // playRepCountdown itself. Errors are swallowed — countdown is a
      // nice-to-have, not a blocker for the tracking loop.
      if (!repCountdownFiredRef.current) {
        repCountdownFiredRef.current = true;
        playRepCountdown().catch((error) => {
          if (DEV) warnWithTs('[ScanARKit] rep countdown failed', error);
        });
      }
    } catch (error) {
      errorWithTs('[ScanARKit] ❌ Failed to start tracking:', error);
      if (DEV) {
        errorWithTs('[ScanARKit] Error details:', {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startNativeTracking,
    transitionPhase,
    cameraPosition,
    logWithTs,
    detectionMode,
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
  }, [isRecording]);

  // Stop tracking
  const stopTracking = useCallback(async () => {
    if (DEV) logWithTs('[ScanARKit] Stopping tracking...');

    // Snapshot the session data before the cleanup below wipes the refs.
    // Used for post-session milestone detection (#494).
    const sessionScoresAtStop = sessionFqiScoresRef.current.slice();
    const exerciseKeyAtStop = detectionMode;
    const sessionIdAtStop = sessionIdRef.current;

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
      setActiveMetrics(null);
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      repIndexTrackerRef.current.reset();
      resetWorkoutController();
      setRepCount(0);
      setFps(0);
      realtimeFormEngineRef.current = createRealtimeEngineState();
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

      if (DEV) logWithTs('[ScanARKit] Tracking stopped');

      if (Platform.OS === 'ios') {
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
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

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
  }, []);

  const isMidSession = useCallback((): boolean => {
    if (!isTracking) return false;
    const initialPhase = getWorkoutByMode(detectionMode).initialPhase;
    return repCount > 0 || activePhaseRef.current !== initialPhase;
  }, [isTracking, detectionMode, repCount]);

  const handleCloseScan = useCallback(() => {
    if (isMidSession()) {
      setIsExitMidSessionSheetVisible(true);
      return;
    }
    router.back();
  }, [isMidSession, router]);

  const handleExitDiscard = useCallback(async () => {
    setIsExitMidSessionSheetVisible(false);
    try {
      await stopTracking();
    } catch (error) {
      if (DEV) warnWithTs('[ScanARKit] stopTracking during discard failed', error);
    }
    router.back();
  }, [stopTracking, router, DEV]);

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
    router.back();
  }, [computeAverageFqi, detectionMode, repCount, stopTracking, router, DEV]);

  const handleExitCancel = useCallback(() => {
    setIsExitMidSessionSheetVisible(false);
  }, []);

  const handleOverlayLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    overlayLayout.current = { width, height };
    if (__DEV__) {
      logWithTs(`[ScanARKit] Overlay layout: ${width.toFixed(1)}x${height.toFixed(1)} (compare with native ARView bounds)`);
    }
  }, []);

  const openWorkoutInsights = useCallback(() => {
    const sessionId = encodeURIComponent(sessionIdRef.current);
    router.push(`/(modals)/workout-insights?sessionId=${sessionId}`);
  }, [router]);

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
	    }, [fixturePlaybackEnabled, fixturePlaybackFramesProcessed, isTracking, orderedActiveCues, poseTimestamp]);
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
  }, [primaryCue, audioFeedbackEnabled, speakCue, addWorkoutRepCue]);

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
  }, [primaryCue]);

    const canMirrorFromArkit =
      Platform.OS === 'ios' &&
      watchMirrorEnabled &&
      isScreenFocused &&
      isTracking &&
      cameraPosition === 'back';
    const watchMirrorActive =
      canMirrorFromArkit &&
      watchPaired &&
      watchInstalled &&
      watchReachable;
    const watchReady = watchPaired && watchInstalled;
    const handleWatchMirrorToggle = useCallback(
      (value: boolean) => {
        if (!watchReady) {
          Alert.alert('Watch not ready', 'Pair your Apple Watch and install the watch app first.');
          return;
        }
        setWatchMirrorEnabled(value);
      },
      [watchReady]
    );

    const captureAndSendWatchMirror = useCallback(async () => {
      if (watchMirrorInFlightRef.current) {
        return;
      }

      watchMirrorInFlightRef.current = true;

      // INVARIANT: every exit path below (success, early return, any
      // synchronous throw from BodyTracker.getCurrentFrameSnapshot or
      // sendMessage, and any rejection from the awaited native promise)
      // MUST fall through to the outer finally so the in-flight flag is
      // reset — otherwise a single failed snapshot wedges the watch-mirror
      // timer forever. If this function is ever refactored to split the
      // snapshot call into a helper, wrap that helper in its own
      // try-finally as well.
      try {
        let base64: string | null = null;
        let width: number | undefined;
        let height: number | undefined;
        let orientation: string | undefined;
        let mirrored: boolean | undefined;

        if (!canMirrorFromArkit) {
          logTrackingDebug('watch-mirror-branch', {
            ts: Date.now(),
            canMirrorFromArkit: false,
            cameraPosition,
          });
          return;
        }

        const arkitSnapshot = await BodyTracker.getCurrentFrameSnapshot({
          maxWidth: WATCH_MIRROR_MAX_WIDTH,
          quality: WATCH_MIRROR_AR_QUALITY,
        });
        if (!arkitSnapshot?.frame) {
          return;
        }
        base64 = arkitSnapshot.frame;
        width = arkitSnapshot.width;
        height = arkitSnapshot.height;
        orientation = arkitSnapshot.orientation;
        mirrored = arkitSnapshot.mirrored;

        if (!base64) {
          logTrackingDebug('watch-mirror-branch', {
            ts: Date.now(),
            canMirrorFromArkit: true,
            hasFrame: false,
            cameraPosition,
          });
          return;
        }

        logTrackingDebug('watch-mirror-orientation', {
          ts: Date.now(),
          canMirrorFromArkit: true,
          hasFrame: true,
          orientation: orientation ?? null,
          mirrored: mirrored ?? null,
          cameraPosition,
        });

        sendMessage({
          type: 'mirror',
          frame: base64,
          width,
          height,
          orientation,
          mirrored,
          cameraPosition,
          ts: Date.now(),
        });
      } catch (error) {
        if (DEV) warnWithTs('[ScanARKit] Watch mirror snapshot failed', error);
      } finally {
        watchMirrorInFlightRef.current = false;
      }
    }, [cameraPosition, canMirrorFromArkit, DEV, logTrackingDebug]);

    useEffect(() => {
      if (Platform.OS !== 'ios') {
        return;
      }

      let isMounted = true;

      const refreshWatchStatus = async () => {
        try {
          const [paired, installed, reachable] = await Promise.all([
            getIsPaired(),
            getIsWatchAppInstalled(),
            getReachability(),
          ]);
          if (!isMounted) return;
          setWatchPaired(!!paired);
          setWatchInstalled(!!installed);
          setWatchReachable(!!reachable);
        } catch (error) {
          if (DEV) warnWithTs('[ScanARKit] Watch status check failed', error);
        }
      };

      refreshWatchStatus();

      const unsubscribeReach = watchEvents.addListener('reachability', (reachable: boolean) => {
        setWatchReachable(!!reachable);
      });
      const unsubscribePaired = watchEvents.addListener('paired', (paired: boolean) => {
        setWatchPaired(!!paired);
      });
      const unsubscribeInstalled = watchEvents.addListener('installed', (installed: boolean) => {
        setWatchInstalled(!!installed);
      });

      return () => {
        isMounted = false;
        unsubscribeReach();
        unsubscribePaired();
        unsubscribeInstalled();
      };
    }, [DEV]);

    useEffect(() => {
      if (!watchMirrorActive) {
        if (watchMirrorTimerRef.current) {
          clearInterval(watchMirrorTimerRef.current);
          watchMirrorTimerRef.current = null;
        }
        return;
      }

      const tick = () => {
        // Skip the mirror snapshot while the user is resting between reps —
        // the watch already shows the last frame, and capturing another is
        // pure battery waste during idle/setup phases.
        if (activePhaseRef.current === restPhaseRef.current) {
          return;
        }
        captureAndSendWatchMirror();
      };

      tick();
      watchMirrorTimerRef.current = setInterval(tick, WATCH_MIRROR_INTERVAL_MS);

      return () => {
        if (watchMirrorTimerRef.current) {
          clearInterval(watchMirrorTimerRef.current);
          watchMirrorTimerRef.current = null;
        }
      };
    }, [watchMirrorActive, captureAndSendWatchMirror]);

    // Watch Connectivity: Listen for commands
    //
    // The watch channel is asynchronous: a user can tap "start" on the
    // watch, foreground-background the phone, and the message still
    // arrives ~1s later. Without a focus + latest-ref guard the handler
    // would call startTracking()/stopTracking() closures captured at the
    // time the effect ran, which may reference stale props (for example
    // isTracking=false even though tracking already started via a
    // concurrent tap on the phone). Reading from refs at call time keeps
    // the decision based on current state, and the isScreenFocused check
    // prevents late messages arriving after the user navigated away from
    // the scan tab from kicking the camera back on.
    const isTrackingRef = useRef(isTracking);
    const supportStatusRef = useRef(supportStatus);
    const isScreenFocusedRef = useRef(isScreenFocused);
    useEffect(() => { isTrackingRef.current = isTracking; }, [isTracking]);
    useEffect(() => { supportStatusRef.current = supportStatus; }, [supportStatus]);
    useEffect(() => { isScreenFocusedRef.current = isScreenFocused; }, [isScreenFocused]);

    useEffect(() => {
      const unsubscribe = watchEvents.addListener('message', (message: { command?: string }) => {
        // Ignore late messages arriving after the screen unfocused /
        // unmounted; see the comment block above for rationale.
        if (!isScreenFocusedRef.current) {
          return;
        }
        if (message.command === 'start') {
          if (!isTrackingRef.current && supportStatusRef.current === 'supported') {
            startTracking();
          }
        } else if (message.command === 'stop') {
          if (isTrackingRef.current) {
            stopTracking();
          }
        }
      });

      return () => unsubscribe();
    }, [startTracking, stopTracking]);

    // Watch Connectivity: Sync state
    useEffect(() => {
      if (Platform.OS !== 'ios') {
        return;
      }
      if (!watchPaired || !watchInstalled) {
        return;
      }

	      const now = Date.now();
	      if (now - watchTrackingPublishAtRef.current < 250) {
	        return;
	      }

	      const reps = repCount;
	      const phase = activePhase;
	      const metrics = activeWorkoutDef.ui?.buildWatchMetrics(activeMetrics as never) ?? {};
	      const confidence = lastTrackingQualityRef.current;
	      const partialBadge = livePullupPartialStatus?.visibility_badge;
	      const isDegraded = partialBadge != null && partialBadge !== 'full';
	      const quality =
	        typeof confidence === 'number'
	          ? { trackingConfidence: confidence, isDegraded, degradationReason: isDegraded ? partialBadge : undefined }
	          : undefined;

	      const payload = buildWatchTrackingPayload({
	        now,
	        isTracking: !!isTracking,
	        mode: detectionMode,
        phase,
        reps,
        primaryCue: primaryCue ?? null,
        metrics,
        quality,
      });

      const signature = JSON.stringify(payload.tracking);
      if (signature === watchTrackingSignatureRef.current) {
        return;
      }

      watchTrackingSignatureRef.current = signature;
      watchTrackingPublishAtRef.current = now;

      sendMessage(payload);
      updateWatchContext(payload);
	    }, [
	      activePhase,
	      activeMetrics,
	      activeWorkoutDef,
	      detectionMode,
	      isTracking,
	      livePullupPartialStatus,
	      primaryCue,
	      repCount,
	      watchInstalled,
	      watchPaired,
	    ]);

    const uploadRecordedVideo = useCallback(async (payload: { uri: string; exercise: string; metrics: ClipUploadMetrics }) => {
      if (uploading) return false;
      // Stash the payload up-front so a post-failure Retry can re-invoke
      // without requiring the preview sheet to stay mounted.
      lastUploadPayloadRef.current = payload;
      try {
        setPreviewError(null);
        const info = await FileSystem.getInfoAsync(payload.uri);
        if (!info.exists) {
          const message = 'Recorded file is not accessible.';
          setPreviewError(message);
          Alert.alert('Recording missing', message);
          return false;
        }
        if (info.size && info.size > MAX_UPLOAD_BYTES) {
          const message = 'Max file size is 250MB.';
          setPreviewError(message);
          Alert.alert('File too large', message);
          return false;
        }
        setUploading(true);
        await uploadWorkoutVideo({
          fileUri: payload.uri,
          exercise: payload.exercise,
          metrics: payload.metrics,
        });
        // Clear any retry affordance on success.
        setUploadRetryPayload(null);
        return true;
      } catch (error) {
        errorWithTs('[ScanARKit] Upload recorded video failed', error);
        const message = error instanceof Error ? error.message : 'Could not upload recording.';
        setPreviewError(message);
        // Keep the Alert for the active preview flow, but also surface a
        // persistent banner with a Retry button that stays visible after
        // the user dismisses the Alert and closes the preview.
        setUploadRetryPayload({
          uri: payload.uri,
          exercise: payload.exercise,
          metrics: payload.metrics,
          message,
        });
        Alert.alert('Upload failed', message);
        return false;
      } finally {
        setUploading(false);
      }
    }, [uploading]);

    const retryUploadRecordedVideo = useCallback(() => {
      const pending = uploadRetryPayload ?? lastUploadPayloadRef.current;
      if (!pending) {
        setUploadRetryPayload(null);
        return;
      }
      // Clear the banner optimistically; uploadRecordedVideo will
      // re-arm it on a subsequent failure and will clear on success.
      setUploadRetryPayload(null);
      void uploadRecordedVideo({
        uri: pending.uri,
        exercise: pending.exercise,
        metrics: pending.metrics,
      });
    }, [uploadRetryPayload, uploadRecordedVideo]);

    const dismissUploadRetry = useCallback(() => {
      setUploadRetryPayload(null);
    }, []);

    const autoUploadAnalysisVideo = useCallback(async (payload: { uri: string; exercise: string; metrics: ClipUploadMetrics }) => {
      try {
        const uploadAllowed = await shouldUploadVideo();
        if (!uploadAllowed) {
          warnWithTs('[ScanARKit] Auto upload skipped: video consent disabled', {
            exercise: payload.exercise,
            uri: payload.uri,
          });
          return;
        }

        const info = await FileSystem.getInfoAsync(payload.uri);
        if (!info.exists) {
          warnWithTs('[ScanARKit] Auto upload skipped: recording file missing', { uri: payload.uri });
          return;
        }
        if (info.size && info.size > MAX_UPLOAD_BYTES) {
          warnWithTs('[ScanARKit] Auto upload skipped: file exceeds max size', {
            size: info.size,
            max: MAX_UPLOAD_BYTES,
          });
          return;
        }

        logWithTs('[ScanARKit] Auto analysis upload starting', {
          exercise: payload.exercise,
          sizeBytes: info.size ?? null,
        });

        await uploadWorkoutVideo({
          fileUri: payload.uri,
          exercise: payload.exercise,
          metrics: payload.metrics,
          analysisOnly: true,
        });

        logWithTs('[ScanARKit] Auto analysis upload succeeded', { exercise: payload.exercise });
      } catch (error) {
        warnWithTs('[ScanARKit] Auto analysis upload failed', error);
      }
    }, []);

    const saveRecordingToCameraRoll = useCallback(async (uri: string) => {
      if (Platform.OS === 'web') return false;
      const hasAccess = await ensureMediaLibraryPermission();
      if (!hasAccess) {
        Alert.alert(
          'Photos permission needed',
          'Enable Photos access to save recordings to your camera roll.'
        );
        return false;
      }
      try {
        await MediaLibrary.saveToLibraryAsync(uri);
        return true;
      } catch (error) {
        errorWithTs('[ScanARKit] Failed to save recording to camera roll', error);
        return false;
      }
    }, [ensureMediaLibraryPermission]);

    const cleanupLocalRecording = useCallback(async (uri: string) => {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch (error) {
        warnWithTs('[ScanARKit] Failed to delete local recording', error);
      }
    }, []);

    const startRecordingVideo = useCallback(async () => {
      if (isRecording || isFinalizingRecording || recordingStopInFlightRef.current) return;
      if (recordPreview) {
        Alert.alert('Finish review', 'Save or discard the previous recording before starting a new one.');
        return;
      }
      if (fixturePlaybackEnabled) {
        Alert.alert('Fixture playback enabled', 'Disable fixturePlayback query param to record live tracking.');
        return;
      }
      if (!isTracking) {
        Alert.alert('Start tracking first', 'Begin tracking before recording your set.');
        return;
      }
      if (Platform.OS !== 'ios') {
        Alert.alert('Recording unavailable', 'Native AR recording is only available on iOS.');
        return;
      }
      try {
        if (DEV) logWithTs('[ScanARKit] Starting recording...');
        setPreviewError(null);
        recordingActiveRef.current = true;
        recordingStartAtRef.current = new Date().toISOString();
        recordingStartEpochMsRef.current = Date.now();
        recordingStartFrameTimestampRef.current = lastPoseTimestampRef.current;
        recordingStartRepsRef.current = repCount;
        recordingFqiScoresRef.current = [];
        setIsRecording(true);
        await BodyTracker.startRecording({ quality: recordingQuality });
      } catch (error) {
        errorWithTs('[ScanARKit] Failed to start ARKit recording', error);
        recordingActiveRef.current = false;
        setIsRecording(false);
        Alert.alert('Recording error', error instanceof Error ? error.message : 'Could not start recording.');
      }
    }, [DEV, fixturePlaybackEnabled, isRecording, isFinalizingRecording, isTracking, recordPreview, recordingQuality, repCount]);

  const stopRecordingVideo = useCallback(async () => {
    if (!isRecording || recordingStopInFlightRef.current) return;
    try {
        if (DEV) logWithTs('[ScanARKit] Stopping recording...');
        const recordingEndAt = new Date().toISOString();
          const uri = await stopRecordingCore();
          if (uri) {
            const info = await FileSystem.getInfoAsync(uri);
            const sizeBytes = info.exists ? info.size ?? null : null;
          const repsAtStop = repCount;
          const repsInClip = Math.max(0, repsAtStop - recordingStartRepsRef.current);

          const metricsSnapshot: ClipUploadMetrics = buildVideoMetricsForClip({
            baseMetrics: { ...latestMetricsForUpload, reps: repsInClip },
            sessionId: sessionIdRef.current,
            recordingQuality,
            recordingStartAt: recordingStartAtRef.current ?? recordingEndAt,
            recordingEndAt,
            recordingStartFrameTimestamp: recordingStartFrameTimestampRef.current,
            recordingEndFrameTimestamp: lastPoseTimestampRef.current,
            repFqiScores: recordingFqiScoresRef.current,
          });
          setRecordPreview({
            uri,
            exercise: activeWorkoutDef.displayName,
            metrics: metricsSnapshot,
            sizeBytes,
            savedToLibrary: false,
          });
          setPreviewError(null);
          setIsPreviewVisible(true);
          void autoUploadAnalysisVideo({
            uri,
            exercise: activeWorkoutDef.displayName,
            metrics: metricsSnapshot,
          });
        } else {
          Alert.alert('Recording', 'No video file was generated.');
        }
    } catch (error) {
      errorWithTs('[ScanARKit] Failed to stop ARKit recording', error);
      setIsRecording(false);
      Alert.alert('Recording error', error instanceof Error ? error.message : 'Could not stop recording.');
    } finally {
      recordingActiveRef.current = false;
    }
  }, [
    DEV,
    isRecording,
    stopRecordingCore,
    latestMetricsForUpload,
    recordingQuality,
    repCount,
    activeWorkoutDef.displayName,
    autoUploadAnalysisVideo,
  ]);

  useEffect(() => {
    if (!gestureRecordingEnabled || isRecording || isFinalizingRecording) {
      gestureHoldStartRef.current = null;
      return;
    }

    // Read joints from the ref (kept fresh each frame) rather than from the
    // smoothedPose2DJoints state, which now only flips on partial-tracking
    // badge visibility change. Re-key the effect on `pose` so hand-hold
    // detection still samples every frame.
    const joints = smoothedPose2DRef.current;
    if (!joints || joints.length === 0) {
      gestureHoldStartRef.current = null;
      return;
    }

    const findJoint = (needle: string) =>
      joints.find(
        (joint) => joint.isTracked && joint.name.toLowerCase().includes(needle)
      );

    const leftHand = findJoint('left_hand');
    const rightHand = findJoint('right_hand');
    const leftShoulder = findJoint('left_shoulder');
    const rightShoulder = findJoint('right_shoulder');

    const bothHandsAboveShoulders =
      leftHand &&
      rightHand &&
      leftShoulder &&
      rightShoulder &&
      leftHand.y < leftShoulder.y - 0.05 &&
      rightHand.y < rightShoulder.y - 0.05;

    if (bothHandsAboveShoulders) {
      const now = Date.now();
      if (!gestureHoldStartRef.current) {
        gestureHoldStartRef.current = now;
      } else if (
        now - gestureHoldStartRef.current >= 500 &&
        now - lastGestureTriggerRef.current > 2000
      ) {
        lastGestureTriggerRef.current = now;
        gestureHoldStartRef.current = null;
        startRecordingVideo();
        const message = 'Gesture recording started';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } else {
      gestureHoldStartRef.current = null;
    }
  }, [
    gestureRecordingEnabled,
    pose,
    isRecording,
    isFinalizingRecording,
    startRecordingVideo,
  ]);

  const handlePreSetPreviewCheck = useCallback(async () => {
    setPreSetPreviewVisible(true);
    const snapshot = await BodyTracker.getCurrentFrameSnapshot({
      maxWidth: WATCH_MIRROR_MAX_WIDTH,
      quality: WATCH_MIRROR_AR_QUALITY,
    });
    if (!snapshot || !jointAngles) {
      return;
    }
    await preSetPreview.check(snapshot, activeWorkoutDef.displayName, jointAngles);
  }, [activeWorkoutDef.displayName, jointAngles, preSetPreview]);

  const handleDiscardRecording = useCallback(async () => {
    if (uploading || savingRecording) return;
    if (!recordPreview) {
      setIsPreviewVisible(false);
      return;
    }
    await cleanupLocalRecording(recordPreview.uri);
    setRecordPreview(null);
    setPreviewError(null);
    setIsPreviewVisible(false);
  }, [recordPreview, cleanupLocalRecording, uploading, savingRecording]);

  const handleReacquireSubject = useCallback(() => {
    BodyTracker.resetSubjectLock();
    const message = 'Subject lock reset';
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

    const handleSaveOnlyRecording = useCallback(async () => {
      if (!recordPreview || uploading || savingRecording) return;
      setPreviewError(null);
      let saved = recordPreview.savedToLibrary;
      if (!saved) {
        setSavingRecording(true);
        saved = await saveRecordingToCameraRoll(recordPreview.uri);
        setSavingRecording(false);
        if (saved) {
          setRecordPreview((prev) => (prev ? { ...prev, savedToLibrary: true } : prev));
        }
      }
      if (!saved) return;
      const message = 'Saved to Photos.';
      if (Platform.OS === 'android') {
        ToastAndroid.show(message, ToastAndroid.SHORT);
      } else {
        Alert.alert('Saved', message);
      }
      await cleanupLocalRecording(recordPreview.uri);
      setRecordPreview(null);
      setPreviewError(null);
      setIsPreviewVisible(false);
    }, [recordPreview, uploading, savingRecording, saveRecordingToCameraRoll, cleanupLocalRecording]);

    const handlePublishRecording = useCallback(async () => {
      if (!recordPreview || uploading || savingRecording) return;
      setPreviewError(null);
      let saved = recordPreview.savedToLibrary;
      if (!saved) {
        setSavingRecording(true);
        saved = await saveRecordingToCameraRoll(recordPreview.uri);
        setSavingRecording(false);
        if (saved) {
          setRecordPreview((prev) => (prev ? { ...prev, savedToLibrary: true } : prev));
        }
      }
      if (!saved) return;

      const uploaded = await uploadRecordedVideo({
        uri: recordPreview.uri,
        exercise: recordPreview.exercise,
        metrics: recordPreview.metrics,
      });
      if (uploaded) {
        const message = 'Published to your feed and saved to Photos.';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
          Alert.alert('Published', message);
        }
        await cleanupLocalRecording(recordPreview.uri);
        setRecordPreview(null);
        setPreviewError(null);
        setIsPreviewVisible(false);
      }
    }, [recordPreview, uploading, savingRecording, saveRecordingToCameraRoll, uploadRecordedVideo, cleanupLocalRecording]);

  if (supportStatus === 'unknown') {
    return (
      <SafeAreaView style={styles.container}>
        <View
          style={styles.loaderContainer}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading body tracking"
          accessibilityState={{ busy: true }}
          testID="scan-arkit-loader"
        >
          <View style={styles.loaderCard} accessibilityElementsHidden>
            <View style={styles.loaderLineShort} />
            <View style={styles.loaderLine} />
            <View style={styles.loaderLine} />
          </View>
          <View style={styles.loaderCard} accessibilityElementsHidden>
            <View style={styles.loaderLineShort} />
            <View style={styles.loaderLine} />
            <View style={styles.loaderLine} />
          </View>
          <Text style={styles.loaderCaption} accessibilityElementsHidden>
            Initializing form tracking…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (supportStatus === 'unsupported') {
    // Debug info: Check what BodyTracker reports (only surfaced in __DEV__).
    const nativeDiagnostics = BodyTracker.getSupportDiagnostics();
    const debugInfo = {
      platform: Platform.OS,
      platformVersion: Platform.Version,
      nativeSupported,
      nativeModuleLoaded: BodyTracker.isNativeModuleLoaded(),
      nativeDiagnostics,
      isSupportedResult: nativeDiagnostics?.finalSupported ?? nativeSupported,
    };

    return <ARKitUnsupportedPlaceholder debugInfo={debugInfo} />;
  }

  const telemetryReps = repCount;
  const showTelemetry = isTracking || fixturePlaybackEnabled || telemetryReps > 0;
	  const telemetryTitle = `${activeWorkoutDef.displayName} Tracker`;
	  const telemetryPhaseId = activePhase;
	  const telemetryPhaseLabel =
	    activeWorkoutDef.phases.find((phase) => phase.id === telemetryPhaseId)?.displayName ??
	    String(telemetryPhaseId);
	  const telemetryUi = activeWorkoutDef.ui;
	  const telemetryMetricValues = telemetryUi?.buildWatchMetrics(activeMetrics as never) ?? {};
	  const telemetryPrimaryMetric = telemetryUi?.primaryMetric;
	  const telemetrySecondaryMetric = telemetryUi?.secondaryMetric;
	  const telemetryPrimaryLabel = telemetryPrimaryMetric?.label ?? '--';
	  const telemetryPrimaryDisplay = telemetryPrimaryMetric
	    ? formatMetricValue(
	        telemetryPrimaryMetric.format,
	        getMetricValue(telemetryMetricValues, telemetryPrimaryMetric.key)
	      )
	    : '--';
	  const telemetrySecondaryLabel = telemetrySecondaryMetric?.label ?? '--';
	  const telemetrySecondaryDisplay = telemetrySecondaryMetric
	    ? formatMetricValue(
	        telemetrySecondaryMetric.format,
	        getMetricValue(telemetryMetricValues, telemetrySecondaryMetric.key)
	      )
	    : '--';
	  const previewMetrics = recordPreview?.metrics;
	  const previewReps = previewMetrics?.reps ?? 0;
	  const previewUi = previewMetrics ? getWorkoutByMode(previewMetrics.mode).ui : undefined;
	  const previewPrimaryMetric = previewUi?.primaryMetric;
	  const previewSecondaryMetric = previewUi?.secondaryMetric;
	  const previewPrimaryLabel = previewPrimaryMetric?.label ?? '--';
	  const previewPrimaryDisplay =
	    previewMetrics && previewPrimaryMetric
	      ? formatMetricValue(previewPrimaryMetric.format, getMetricValue(previewMetrics, previewPrimaryMetric.key))
	      : '--';
	  const previewSecondary = {
	    label: previewSecondaryMetric?.label ?? '--',
	    display:
	      previewMetrics && previewSecondaryMetric
	        ? formatMetricValue(previewSecondaryMetric.format, getMetricValue(previewMetrics, previewSecondaryMetric.key))
	        : '--',
	  };
	  const previewFormScore = previewMetrics?.avgFqi != null ? `${Math.round(previewMetrics.avgFqi)}` : '--';
	  const previewDuration = formatDuration(previewMetrics?.recordingStartAt, previewMetrics?.recordingEndAt);
	  const previewQuality = previewMetrics?.recordingQuality ? QUALITY_LABELS[previewMetrics.recordingQuality] : '--';
  const effectivePartialStatus =
    isTracking || fixturePlaybackEnabled
      ? livePullupPartialStatus ?? latestPullupScoring
      : latestPullupScoring;
  const shouldShowPartialTrackingBadge =
    detectionMode === 'pullup' &&
    (isTracking || fixturePlaybackEnabled) &&
    showPartialTrackingBadge &&
    effectivePartialStatus?.visibility_badge === 'partial';
  const missingComponentSet = new Set(effectivePartialStatus?.missing_components ?? []);
  const partialTrackingComponents = PULLUP_COMPONENT_INDICATORS.map((item) => ({
    ...item,
    missing: missingComponentSet.has(item.key),
  }));
  const baselineMetricsSnapshot = baselineDebugMetricsRef.current;
  const debugCueFlipRate =
    baselineMetricsSnapshot.cueSamples > 0
      ? baselineMetricsSnapshot.cueFlipCount / baselineMetricsSnapshot.cueSamples
      : 0;
  const debugMeanFrameLatencyMs =
    baselineMetricsSnapshot.frameLatencyCount > 0
      ? baselineMetricsSnapshot.frameLatencyTotalMs / baselineMetricsSnapshot.frameLatencyCount
      : 0;

  return (
    <CrashBoundary
      fallbackTitle="Camera error"
      fallbackMessage="The body tracking camera encountered a problem. Tap below to restart."
    >
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: topBarOffset }]}>
        <View style={styles.topBarContent}>
          <TouchableOpacity
            style={styles.topBarButton}
            onPress={handleCloseScan}
            accessibilityRole="button"
            accessibilityLabel="Close scan"
          >
            <Ionicons name="close" size={24} color="#F5F7FF" />
          </TouchableOpacity>

          <View style={styles.topBarCenter}>
            {/* Mode Selector (Dropdown) */}
            <View style={styles.workoutSelectorContainer}>
              <TouchableOpacity
                style={styles.workoutSelectorButton}
                onPress={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                <Ionicons
                  name={(activeWorkoutDef.ui?.iconName ?? 'barbell-outline') as any}
                  size={16}
                  color="#F5F7FF"
                />
                <Text style={styles.workoutSelectorText}>
                  {activeWorkoutDef.displayName}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#F5F7FF" />
              </TouchableOpacity>

              {isDropdownOpen && (
                <View style={styles.dropdownMenu}>
                  {getWorkoutIds()
                    .map((mode) => (
                      <TouchableOpacity
                        key={mode}
                        style={styles.dropdownItem}
                        onPress={() => {
                          setDetectionMode(mode);
                          setIsDropdownOpen(false);
                        }}
                      >
                        <Text style={styles.dropdownItemText}>
                          {getWorkoutByMode(mode).displayName}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              )}
              <TouchableOpacity
                style={styles.workoutSelectorButton}
                onPress={handlePreSetPreviewCheck}
                accessibilityRole="button"
                accessibilityLabel="Check my stance"
                testID="pre-set-preview-trigger"
              >
                <Ionicons name="sparkles-outline" size={14} color="#F5F7FF" />
                <Text style={styles.workoutSelectorText}>Check my stance</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.topBarActions}>
            <TouchableOpacity
              style={styles.topBarButton}
              onPress={openWorkoutInsights}
              accessibilityRole="button"
              accessibilityLabel="Open workout insights"
            >
              <Ionicons name="analytics-outline" size={18} color="#F5F7FF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.topBarButton}
              onPress={() => setIsSettingsVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Ionicons name="settings-outline" size={20} color="#F5F7FF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/*
        Camera-permission banner (#542) — renders only when the scan
        surface is mounted without live camera access. Banner self-gates
        via useCameraPermissionGuard and is absolutely positioned so the
        underlying tracking canvas is never obscured by an empty wrapper.
      */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: topBarBottom + 8,
          left: 12,
          right: 12,
          zIndex: 130,
        }}
      >
        <CameraPermissionBanner testID="scan-arkit-camera-permission-banner" />
      </View>

      {/* Tracking view */}
      <View style={styles.trackingContainer}>
        {/* ARKitView - always mount when back camera is selected (hidden when not tracking) so it's ready */}
        {cameraPosition === 'back' && (
          <ARKitView
            key={`arkit-${cameraPosition}`}
            style={[
              styles.fullFill,
              !isTracking && { opacity: 0, pointerEvents: 'none' }
            ]}
            pointerEvents={isTracking ? "box-none" : "none"}
          />
        )}

        {/* Overlay guides */}
        <View
          style={[styles.overlay, { zIndex: 100 }]}
          pointerEvents={isTracking ? 'none' : 'auto'}
          onStartShouldSetResponder={() => !isTracking}
          onLayout={handleOverlayLayout}
        >

          {/*
            Overlay-alignment diagnostic (dev only). If corner dots don't
            sit at the actual screen corners and the border doesn't trace
            the visible camera rect, the SVG container is not the same
            rect as the native ARView — that's the overlay misalignment bug.
          */}
          {DEV && (
            <Svg
              style={styles.fullFill}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              pointerEvents="none"
            >
              <Rect x="0" y="0" width="1" height="1" fill="none" stroke="#FF00FF" strokeWidth="0.004" />
              <Circle cx="0" cy="0" r="0.012" fill="#FF00FF" />
              <Circle cx="1" cy="0" r="0.012" fill="#FF00FF" />
              <Circle cx="0" cy="1" r="0.012" fill="#FF00FF" />
              <Circle cx="1" cy="1" r="0.012" fill="#FF00FF" />
              <Line x1="0.45" y1="0.5" x2="0.55" y2="0.5" stroke="#FFFF00" strokeWidth="0.004" />
              <Line x1="0.5" y1="0.45" x2="0.5" y2="0.55" stroke="#FFFF00" strokeWidth="0.004" />
              <Circle cx="0.5" cy="0.5" r="0.006" fill="#FFFF00" />
              <Line x1="0.25" y1="0.48" x2="0.25" y2="0.52" stroke="#00FFFF" strokeWidth="0.003" />
              <Line x1="0.75" y1="0.48" x2="0.75" y2="0.52" stroke="#00FFFF" strokeWidth="0.003" />
              <Line x1="0.48" y1="0.25" x2="0.52" y2="0.25" stroke="#00FFFF" strokeWidth="0.003" />
              <Line x1="0.48" y1="0.75" x2="0.52" y2="0.75" stroke="#00FFFF" strokeWidth="0.003" />
            </Svg>
          )}

          {!showTelemetry && (
            <Animated.View style={[styles.topGuide, { top: topBarBottom + 16, opacity: textOpacity }]}>
              <Text style={styles.guideText}>
                {isTracking ? 'Tracking Active' : 'Press Start to Begin'}
              </Text>
              <Text style={styles.guideSubtext}>
                Real-world 3D joint tracking • {fps} FPS
              </Text>
              {pose && (
                <View style={styles.qualityIndicator}>
                  <View style={styles.qualityBar} />
                </View>
              )}
            </Animated.View>
          )}

          {/* Skeleton Overlay (2D projected) */}
        {isTracking && cameraPosition === 'back' && smoothedPose2DJoints && smoothedPose2DJoints.length > 0 && (
            <Svg
              style={styles.fullFill}
              viewBox="0 0 1 1"
            preserveAspectRatio="none"
            pointerEvents="none"
            >
              {(() => {
                // Pull joints from the ref so per-frame pose updates paint
                // the skeleton without needing a state bump. The outer gate
                // above only flips when badge visibility changes.
                const liveJoints = smoothedPose2DRef.current ?? smoothedPose2DJoints;
                const jointsByName = new Map<string, Joint2D>();
                liveJoints.forEach((joint) => {
                  jointsByName.set(joint.name.toLowerCase(), joint);
                });

                const findJoint2D = (name: string) => {
                  const lower = name.toLowerCase();
                  const direct = jointsByName.get(lower);
                  if (direct?.isTracked) return direct;

                  // Strict alias fallback -- no substring matching
                  const aliases = SKELETON_JOINT_ALIASES[lower];
                  if (aliases) {
                    for (const alias of aliases) {
                      const j = jointsByName.get(alias);
                      if (j?.isTracked) return j;
                    }
                  }
                  return undefined;
                };

                const drawLine = (from: string, to: string, color: string = '#4C8CFF') => {
                  const j1 = findJoint2D(from);
                  const j2 = findJoint2D(to);
                  if (j1 && j2 && j1.isTracked && j2.isTracked) {
                    const x1 = j1.x;
                    const y1 = j1.y;
                    const x2 = j2.x;
                    const y2 = j2.y;

                    return (
                      <Line
                        key={`${from}-${to}`}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={color}
                        strokeWidth="0.004"
                        strokeLinecap="round"
                        strokeOpacity={0.9}
                      />
                    );
                  }
                  return null;
                };

                return (
                  <>
                    {/* Spine */}
                    {drawLine('hips_joint', 'spine_4_joint')}
                    {drawLine('spine_4_joint', 'neck_1_joint')}
                    {drawLine('neck_1_joint', 'head_joint')}

                    {/* Left arm */}
                    {drawLine('neck_1_joint', 'left_shoulder_1_joint', '#3CC8A9')}
                    {drawLine('left_shoulder_1_joint', 'left_arm_joint', '#3CC8A9')}
                    {drawLine('left_arm_joint', 'left_forearm_joint', '#3CC8A9')}
                    {drawLine('left_forearm_joint', 'left_hand_joint', '#3CC8A9')}

                    {/* Right arm */}
                    {drawLine('neck_1_joint', 'right_shoulder_1_joint', '#3CC8A9')}
                    {drawLine('right_shoulder_1_joint', 'right_arm_joint', '#3CC8A9')}
                    {drawLine('right_arm_joint', 'right_forearm_joint', '#3CC8A9')}
                    {drawLine('right_forearm_joint', 'right_hand_joint', '#3CC8A9')}

                    {/* Left leg */}
                    {drawLine('hips_joint', 'left_upLeg_joint', '#9B7EDE')}
                    {drawLine('left_upLeg_joint', 'left_leg_joint', '#9B7EDE')}
                    {drawLine('left_leg_joint', 'left_foot_joint', '#9B7EDE')}

                    {/* Right leg */}
                    {drawLine('hips_joint', 'right_upLeg_joint', '#9B7EDE')}
                    {drawLine('right_upLeg_joint', 'right_leg_joint', '#9B7EDE')}
                    {drawLine('right_leg_joint', 'right_foot_joint', '#9B7EDE')}
                  </>
                );
              })()}

              {/* Draw joints — read from the same ref for consistency */}
              {(smoothedPose2DRef.current ?? smoothedPose2DJoints).map(
                (joint: Joint2D, index: number) => {
                  if (!joint.isTracked) return null;
                  return (
                      <Circle
                        key={`joint-${index}-${joint.name}`}
                        cx={joint.x}
                        cy={joint.y}
                        r="0.006"
                        fill="#FFFFFF"
                        opacity={0.9}
                      />
                  );
                }
              )}
            </Svg>
          )}

          {/*
           * =============================================================
           * AR Overlays v2 (#445) — W3-A resilience UX + W3-D SVG overlays.
           * ALL of this is gated by isAROverlaysV2Enabled(); legacy tree
           * unchanged when the flag is off.
           * =============================================================
           */}
          {arOverlaysV2 && isTracking && cameraPosition === 'back' && overlayLayout.current && smoothedPose2DJoints && smoothedPose2DJoints.length > 0 ? (
            <ARScanOverlaysV2
              joints={smoothedPose2DRef.current ?? smoothedPose2DJoints}
              width={overlayLayout.current.width}
              height={overlayLayout.current.height}
              angles={jointAngles}
              activeFormTargets={activeFormTargets}
              activePhase={activePhase}
            />
          ) : null}

          {/* Subject-identity switch banner */}
          {arOverlaysV2 && subjectIdentity.snapshot.switchDetected ? (
            <View style={scanArV2Styles.banner} accessibilityRole="alert">
              <Ionicons name="person-circle-outline" size={18} color="#FDE047" />
              <Text style={scanArV2Styles.bannerText}>
                Subject changed — step back into frame
              </Text>
              <TouchableOpacity
                onPress={subjectIdentity.recalibrate}
                style={scanArV2Styles.bannerAction}
                accessibilityRole="button"
                accessibilityLabel="Reset subject tracking"
              >
                <Text style={scanArV2Styles.bannerActionText}>Reset</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Camera-permission revoked banner */}
          {arOverlaysV2 && cameraPermission.revoked ? (
            <View
              style={[scanArV2Styles.banner, scanArV2Styles.bannerError]}
              accessibilityRole="alert"
            >
              <Ionicons name="videocam-off-outline" size={18} color="#FCA5A5" />
              <Text style={scanArV2Styles.bannerText}>
                Camera access disabled
              </Text>
              <TouchableOpacity
                onPress={() => {
                  void cameraPermission.openSettings();
                }}
                style={scanArV2Styles.bannerAction}
                accessibilityRole="button"
                accessibilityLabel="Open Settings to re-enable camera"
              >
                <Text style={scanArV2Styles.bannerActionText}>Settings</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Resume? prompt after AppState foreground return */}
          {arOverlaysV2 && appStatePause.needsResume ? (
            <View
              style={[scanArV2Styles.banner, scanArV2Styles.bannerInfo]}
              accessibilityRole="alert"
            >
              <Ionicons name="pause-circle-outline" size={18} color="#93C5FD" />
              <Text style={scanArV2Styles.bannerText}>
                Paused — resume tracking?
              </Text>
              <TouchableOpacity
                onPress={appStatePause.resume}
                style={scanArV2Styles.bannerAction}
                accessibilityRole="button"
                accessibilityLabel="Resume tracking"
              >
                <Text style={scanArV2Styles.bannerActionText}>Resume</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/*
           * Video-upload retry banner (#551).
           *
           * When uploadRecordedVideo rejects, the try-catch already fires
           * an Alert and sets previewError, but the user loses the
           * affordance once they dismiss the Alert and close the preview.
           * This banner persists with a Retry pill that re-invokes the
           * upload using the stored URI — no re-encoding, no re-navigate.
           */}
          {uploadRetryPayload ? (
            <View
              style={[scanArV2Styles.banner, scanArV2Styles.bannerError]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="scan-arkit-upload-retry-banner"
            >
              <Ionicons name="cloud-offline-outline" size={18} color="#FCA5A5" />
              <Text style={scanArV2Styles.bannerText}>
                Upload failed — {uploadRetryPayload.message}
              </Text>
              <TouchableOpacity
                onPress={retryUploadRecordedVideo}
                style={scanArV2Styles.bannerAction}
                accessibilityRole="button"
                accessibilityLabel="Retry video upload"
                disabled={uploading}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="scan-arkit-upload-retry-button"
              >
                <Text style={scanArV2Styles.bannerActionText}>
                  {uploading ? 'Retrying…' : 'Retry'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={dismissUploadRetry}
                accessibilityRole="button"
                accessibilityLabel="Dismiss upload retry banner"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={scanArV2Styles.bannerDismiss}
                testID="scan-arkit-upload-retry-dismiss"
              >
                <Ionicons name="close" size={14} color="#F5F7FF" />
              </TouchableOpacity>
            </View>
          ) : null}

          {/*
           * Persistent sustained-occlusion banner (#551).
           *
           * Replaces the 3.2s micro-toast. The banner sticks until the
           * user taps "Got it" or the OcclusionHoldManager clears the
           * sustained state by calling handleSustainedOcclusion(null).
           * A dismiss button is essential — on long-limb occlusion (e.g.
           * squat with arms crossed over camera) the old toast faded
           * before the user could read what joint was hidden.
           */}
          {arOverlaysV2 && sustainedOcclusionHint ? (
            <View
              style={[scanArV2Styles.banner, scanArV2Styles.bannerError]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="scan-arkit-sustained-occlusion-banner"
            >
              <Ionicons name="eye-off-outline" size={18} color="#FCA5A5" />
              <Text style={scanArV2Styles.bannerText}>
                Adjust clothing — {sustainedOcclusionHint.jointNames.length} joint
                {sustainedOcclusionHint.jointNames.length === 1 ? '' : 's'} hidden
              </Text>
              <TouchableOpacity
                onPress={dismissSustainedOcclusion}
                style={scanArV2Styles.bannerAction}
                accessibilityRole="button"
                accessibilityLabel="Dismiss occlusion warning"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="scan-arkit-sustained-occlusion-dismiss"
              >
                <Text style={scanArV2Styles.bannerActionText}>Got it</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Thermal/FPS debug badge (DEV-only) */}
          {arOverlaysV2 && DEV && adaptiveFps.throttled ? (
            <View style={scanArV2Styles.fpsBadge}>
              <Text style={scanArV2Styles.fpsBadgeText}>
                {adaptiveFps.fps}fps · {adaptiveFps.state}
              </Text>
            </View>
          ) : null}
        </View>

	        {/* Workout telemetry display */}
	        {showTelemetry && (
          <View style={[styles.anglesDisplay, { top: topBarBottom + 8 }]}>
	            <Text style={styles.anglesTitle}>{telemetryTitle}</Text>
	            <View style={styles.anglesGrid}>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>Reps</Text>
                <Text style={styles.angleValue}>{telemetryReps}</Text>
              </View>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>Phase</Text>
                <Text style={styles.angleValue}>{telemetryPhaseLabel}</Text>
              </View>
	              <View style={styles.angleItem}>
	                <Text style={styles.angleLabel}>{telemetryPrimaryLabel}</Text>
	                <Text style={styles.angleValue}>{telemetryPrimaryDisplay}</Text>
	              </View>
	              <View style={styles.angleItem}>
	                <Text style={styles.angleLabel}>{telemetrySecondaryLabel}</Text>
	                <Text style={styles.angleValue}>{telemetrySecondaryDisplay}</Text>
	              </View>
	            </View>
	          </View>
	        )}

        {/* Form feedback */}
        {feedback && (
          <View style={styles.feedbackContainer}>
            {feedback.map((msg, idx) => (
              <Text key={idx} style={styles.feedbackText}>
                {msg}
              </Text>
            ))}
          </View>
        )}
      </View>

      {/* Controls */}
      <View style={[styles.controls, { bottom: insets.bottom + 24 }]}>
        {isTracking && (
          <TouchableOpacity
            style={[
              styles.controlButton,
              styles.recordButton,
              isRecording && styles.recordButtonActive,
              isFinalizingRecording && styles.recordButtonDisabled
            ]}
            onPress={() => {
              if (isFinalizingRecording) return;
              if (isRecording) {
                stopRecordingVideo();
              } else {
                startRecordingVideo();
              }
            }}
            disabled={isFinalizingRecording}
          >
            {isFinalizingRecording ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons
                name={isRecording ? 'stop-circle' : 'radio-button-on'}
                size={isRecording ? 22 : 20}
                color="#FFFFFF"
              />
            )}
            <Text style={styles.controlButtonText}>
              {isFinalizingRecording ? 'Finalizing...' : isRecording ? 'Stop Recording' : 'Record Set'}
            </Text>
          </TouchableOpacity>
        )}

        {!isTracking && (
           <TouchableOpacity
             style={styles.controlButton}
             onPress={startTracking}
           >
             <Ionicons name="play" size={24} color="#FFFFFF" />
             <Text style={styles.controlButtonText}>Start Tracking</Text>
           </TouchableOpacity>
        )}
      </View>

      {/* Status badge */}
      {showDebugStats && (
        <View style={[styles.statusBadge, { top: topBarBottom + 8 }]}> 
          <View style={[styles.statusDot, isTracking && styles.statusDotActive]} />
          <View>
            <Text style={styles.statusText}>
              {fixturePlaybackEnabled
                ? `Fixture Playback (${fixtureName}) • ${fixturePlaybackFramesProcessed}/${fixtureFrames?.length ?? 0} frames`
                : `${isTracking ? 'Tracking' : 'Inactive'} • ${pose?.joints.length || 0} joints • ${fps} FPS`}
            </Text>
            <Text style={styles.statusSubtext}>
              {Platform.OS === 'ios' ? 'GPU: Metal' : Platform.OS === 'android' ? 'GPU: OpenGL/Vulkan' : 'GPU: WebGL'}
            </Text>
            {baselineDebugEnabled && (
              <Text style={styles.statusSubtext}>
                {`cueFlipRate=${(debugCueFlipRate * 100).toFixed(1)}% meanFrameLatency=${debugMeanFrameLatencyMs.toFixed(2)}ms buckets[<4:${baselineMetricsSnapshot.latencyBuckets.lt4} <8:${baselineMetricsSnapshot.latencyBuckets.lt8} <16:${baselineMetricsSnapshot.latencyBuckets.lt16} >=16:${baselineMetricsSnapshot.latencyBuckets.gte16}]`}
              </Text>
            )}
          </View>
        </View>
      )}

      {shouldShowPartialTrackingBadge && (
        <View style={[styles.partialTrackingBadge, { top: topBarBottom + 8 }]}> 
          <Text style={styles.partialTrackingBadgeText}>Partial tracking</Text>
          <View style={styles.partialTrackingComponentRow}>
            {partialTrackingComponents.map((component) => (
              <View
                key={component.key}
                style={[
                  styles.partialTrackingComponentPill,
                  component.missing ? styles.partialTrackingComponentPillMissing : styles.partialTrackingComponentPillAvailable,
                ]}
              >
                <Text
                  style={[
                    styles.partialTrackingComponentLabel,
                    component.missing
                      ? styles.partialTrackingComponentLabelMissing
                      : styles.partialTrackingComponentLabelAvailable,
                  ]}
                >
                  {component.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* PR celebration badge (issue #447 W3-C #2). Surgical mount — renders
          only when usePRDetection has a hit. Safe no-op when pr is null. */}
      <PRCelebrationBadge pr={currentPR} onDismiss={clearCurrentPR} />

      {/* Progression suggestion badge (issue #447 W3-C #3). Hidden until the
          data-feed wiring lands (see TODO near useProgressionSuggestion). */}
      {progressionSuggestion ? (
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <ProgressionSuggestionBadge suggestion={progressionSuggestion} />
        </View>
      ) : null}

      <Modal
        visible={isSettingsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsSettingsVisible(false)}
      >
        <View style={styles.settingsOverlay}>
          <TouchableOpacity
            style={styles.settingsBackdrop}
            activeOpacity={1}
            onPress={() => setIsSettingsVisible(false)}
          />
          <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>Settings</Text>
              <TouchableOpacity
                style={styles.settingsCloseButton}
                onPress={() => setIsSettingsVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close settings"
              >
                <Ionicons name="close" size={20} color="#F5F7FF" />
              </TouchableOpacity>
            </View>

            <View style={styles.settingsSection}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Audio feedback</Text>
                <Switch value={audioFeedbackEnabled} onValueChange={setAudioFeedbackEnabled} />
              </View>

              <View style={styles.settingsRow}>
                <View style={styles.settingsLabelGroup}>
                  <Text style={styles.settingsLabel}>MediaPipe shadow</Text>
                  <Text style={styles.settingsHint}>Compare ARKit primary with shadow angles</Text>
                </View>
                <Switch value={shadowModeEnabled} onValueChange={setShadowModeEnabled} />
              </View>

              {Platform.OS === 'ios' && (
                <View style={styles.settingsRow}>
                  <View style={styles.settingsLabelGroup}>
                    <Text style={styles.settingsLabel}>Watch mirroring</Text>
                    <Text style={styles.settingsHint}>
                      {watchReady ? 'Mirror to Apple Watch' : 'Pair watch to enable'}
                    </Text>
                  </View>
                  <Switch
                    value={watchMirrorEnabled}
                    onValueChange={handleWatchMirrorToggle}
                    disabled={!watchReady}
                  />
                </View>
              )}
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.settingsSection}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Subject lock</Text>
                <Switch value={subjectLockEnabled} onValueChange={setSubjectLockEnabled} />
              </View>
              <TouchableOpacity
                style={[
                  styles.settingsButton,
                  !subjectLockEnabled && styles.settingsButtonDisabled,
                ]}
                onPress={handleReacquireSubject}
                disabled={!subjectLockEnabled}
              >
                <Text style={styles.settingsButtonText}>Reacquire subject</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.settingsSection}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Gesture recording</Text>
                <Switch value={gestureRecordingEnabled} onValueChange={setGestureRecordingEnabled} />
              </View>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Quality</Text>
                <View style={styles.qualityButtons}>
                  {(Object.keys(QUALITY_LABELS) as RecordingQuality[]).map((quality) => {
                    const isActive = recordingQuality === quality;
                    return (
                      <TouchableOpacity
                        key={quality}
                        style={[
                          styles.qualityButton,
                          isActive && styles.qualityButtonActive,
                          (isRecording || isFinalizingRecording) && styles.qualityButtonDisabled,
                        ]}
                        onPress={() => updateRecordingQuality(quality)}
                        disabled={isRecording || isFinalizingRecording}
                      >
                        <Text style={[styles.qualityButtonText, isActive && styles.qualityButtonTextActive]}>
                          {QUALITY_LABELS[quality]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.settingsSection}>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Debug stats</Text>
                <Switch value={showDebugStats} onValueChange={setShowDebugStats} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isPreviewVisible}
        animationType="slide"
        onRequestClose={handleDiscardRecording}
        statusBarTranslucent
      >
        <SafeAreaView style={styles.previewOverlay}>
          <View style={styles.previewContent}>
            <View style={styles.previewVideoWrap}>
              {recordPreview?.uri ? (
                <PreviewPlayer uri={recordPreview.uri} />
              ) : (
                <View style={styles.previewVideoPlaceholder}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              )}
              <TouchableOpacity
                style={[styles.previewCloseButton, { top: insets.top + spacing.sm }]}
                onPress={handleDiscardRecording}
                disabled={uploading || savingRecording}
              >
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>Review</Text>
              <View style={styles.previewExerciseBadge}>
                <Text style={styles.previewExerciseBadgeText}>{recordPreview?.exercise ?? '--'}</Text>
              </View>
            </View>

            <View style={styles.previewMetricsGrid}>
              <View style={styles.previewMetricCard}>
                <Text style={styles.previewMetaLabel}>Reps</Text>
                <Text style={styles.previewMetaValue}>{previewReps}</Text>
              </View>
              <View style={styles.previewMetricCard}>
                <Text style={styles.previewMetaLabel}>Form Score</Text>
                <Text style={styles.previewMetaValue}>{previewFormScore}</Text>
              </View>
              <View style={styles.previewMetricCard}>
                <Text style={styles.previewMetaLabel}>Duration</Text>
                <Text style={styles.previewMetaValue}>{previewDuration}</Text>
              </View>
              <View style={styles.previewMetricCard}>
                <Text style={styles.previewMetaLabel}>{previewPrimaryLabel}</Text>
                <Text style={styles.previewMetaValue}>{previewPrimaryDisplay}</Text>
              </View>
              {previewSecondary.label !== '--' && (
                <View style={styles.previewMetricCard}>
                  <Text style={styles.previewMetaLabel}>{previewSecondary.label}</Text>
                  <Text style={styles.previewMetaValue}>{previewSecondary.display}</Text>
                </View>
              )}
              <View style={styles.previewMetricCard}>
                <Text style={styles.previewMetaLabel}>Quality</Text>
                <Text style={styles.previewMetaValue}>{previewQuality}</Text>
              </View>
              <View style={styles.previewMetricCard}>
                <Text style={styles.previewMetaLabel}>Size</Text>
                <Text style={styles.previewMetaValue}>{formatBytes(recordPreview?.sizeBytes)}</Text>
              </View>
            </View>

            {previewError ? (
              <Text style={styles.previewErrorText}>{previewError}</Text>
            ) : null}

            <View style={[styles.previewActions, { paddingBottom: insets.bottom + spacing.md }]}>
              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonPrimary]}
                onPress={handlePublishRecording}
                disabled={uploading || savingRecording}
              >
                {uploading || savingRecording ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.previewButtonText, styles.previewButtonTextPrimary]}>
                    Publish + Save
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonSecondary]}
                onPress={handleSaveOnlyRecording}
                disabled={uploading || savingRecording}
              >
                {savingRecording && !uploading ? (
                  <ActivityIndicator color="#0B1F3A" />
                ) : (
                  <Text style={[styles.previewButtonText, styles.previewButtonTextSecondary]}>
                    Save only
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonGhost]}
                onPress={handleDiscardRecording}
                disabled={uploading || savingRecording}
              >
                <Text style={[styles.previewButtonText, styles.previewButtonTextGhost]}>
                  Discard
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
      <PreSetPreviewCard visible={preSetPreviewVisible} isChecking={preSetPreview.isChecking} verdict={preSetPreview.verdict} error={preSetPreview.error} exerciseName={activeWorkoutDef.displayName} onRetry={handlePreSetPreviewCheck} onDismiss={() => { setPreSetPreviewVisible(false); preSetPreview.reset(); }} />
      <ExitMidSessionSheet
        visible={isExitMidSessionSheetVisible}
        exerciseDisplayName={activeWorkoutDef.displayName}
        repCount={repCount}
        currentFqi={computeAverageFqi()}
        onDiscard={handleExitDiscard}
        onSaveSnapshot={handleExitSaveSnapshot}
        onCancel={handleExitCancel}
      />
      <VoiceCommandFeedback />
</View>
    </CrashBoundary>
  );
}

// =============================================================
// AR Overlays v2 sub-component (#445 W3-D) — extracted so the main
// scan screen stays readable. All SVG overlays live here; parent
// gates the whole tree with isAROverlaysV2Enabled().
// =============================================================
type ARScanOverlaysV2Props = {
  joints: Joint2D[];
  width: number;
  height: number;
  angles: JointAngles | null;
  activeFormTargets: FormTargets;
  activePhase: string;
};

function findJointByNames(joints: Joint2D[], names: string[]): Joint2D | null {
  const lowered = new Set(names.map((n) => n.toLowerCase()));
  for (const j of joints) {
    if (j?.name && lowered.has(j.name.toLowerCase()) && j.isTracked) return j;
  }
  return null;
}

function angleFromAngles(
  angles: JointAngles | null,
  keys: string[],
): number | null {
  if (!angles) return null;
  const rec = angles as unknown as Record<string, number | undefined>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function ARScanOverlaysV2({
  joints,
  width,
  height,
  angles,
  activeFormTargets,
  activePhase,
}: ARScanOverlaysV2Props) {
  const elbow = findJointByNames(joints, [
    'left_forearm_joint',
    'left_elbow',
    'right_forearm_joint',
    'right_elbow',
  ]);
  const shoulder = findJointByNames(joints, [
    'left_shoulder_1_joint',
    'left_shoulder',
    'right_shoulder_1_joint',
    'right_shoulder',
  ]);
  const hip = findJointByNames(joints, [
    'hips_joint',
    'left_hip',
    'right_hip',
  ]);

  const armAngle =
    angleFromAngles(angles, [
      'leftElbow',
      'rightElbow',
      'leftArm',
      'rightArm',
    ]) ?? 90;

  // Use targets from the active form-target record when available.
  const minROM = Number.isFinite(activeFormTargets?.romMin)
    ? (activeFormTargets.romMin as number)
    : 30;
  const maxROM = Number.isFinite(activeFormTargets?.romMax)
    ? (activeFormTargets.romMax as number)
    : 170;

  // Derive a rough progress value and phase classification for the ROM bar.
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const romProgress = clamp01(
    (armAngle - minROM) / Math.max(1, maxROM - minROM),
  );
  const isConcentric =
    activePhase.toLowerCase().includes('up') ||
    activePhase.toLowerCase().includes('concentric') ||
    activePhase.toLowerCase().includes('pull') ||
    activePhase.toLowerCase().includes('ascend');

  return (
    <View pointerEvents="none" style={{ position: 'absolute', width, height }}>
      <FramingGuide joints={joints} width={width} height={height} />
      {elbow ? (
        <JointArcOverlay
          activeJoint={elbow}
          currentAngle={armAngle}
          minROM={minROM}
          maxROM={maxROM}
          width={width}
          height={height}
        />
      ) : null}
      {shoulder ? (
        <CueArrowOverlay
          joint={shoulder}
          direction={{ x: 0, y: -1 }}
          severity={('info' as CueSeverity)}
          width={width}
          height={height}
        />
      ) : null}
      {hip ? (
        <ROMProgressBar
          anchor={hip}
          progress={romProgress}
          phase={isConcentric ? 'concentric' : 'eccentric'}
          width={width}
          height={height}
        />
      ) : null}
      <FaultHighlight
        joints={joints}
        faultJointNames={[]}
        width={width}
        height={height}
      />
    </View>
  );
}

const scanArV2Styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE047',
    backgroundColor: 'rgba(17,17,17,0.78)',
  },
  bannerError: {
    borderColor: '#FCA5A5',
  },
  bannerInfo: {
    borderColor: '#93C5FD',
  },
  bannerText: {
    flex: 1,
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '600',
  },
  bannerAction: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bannerActionText: {
    color: '#F5F7FF',
    fontSize: 12,
    fontWeight: '700',
  },
  bannerDismiss: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginLeft: 6,
  },
  microToast: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  microToastText: {
    color: '#F5F7FF',
    fontSize: 12,
    fontWeight: '600',
  },
  fpsBadge: {
    position: 'absolute',
    top: 8,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(248,113,113,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.6)',
  },
  fpsBadgeText: {
    color: '#FCA5A5',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
