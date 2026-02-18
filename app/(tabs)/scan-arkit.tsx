import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { Svg, Circle, Line } from 'react-native-svg';
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
import { useSpeechFeedback } from '@/hooks/use-speech-feedback';
import { generateSessionId, logCueEvent, upsertSessionMetrics } from '@/lib/services/cue-logger';
import { logPoseSample, flushPoseBuffer, resetFrameCounter } from '@/lib/services/pose-logger';
import { RepIndexTracker } from '@/lib/services/rep-index-tracker';
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
  const params = useLocalSearchParams<{ fixturePlayback?: string; fixture?: string; trackingDebug?: string }>();
  const fixturePlaybackRequested = params.fixturePlayback === '1';
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
  const [activePhase, setActivePhase] = useState<string>(getWorkoutByMode(DEFAULT_DETECTION_MODE).initialPhase);
  const [audioFeedbackEnabled, setAudioFeedbackEnabled] = useState(true);
  const activePhaseRef = React.useRef<string>(getWorkoutByMode(DEFAULT_DETECTION_MODE).initialPhase);
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
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
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
  const pose2DCacheRef = React.useRef<Record<string, { x: number; y: number }>>({});
  const lastSpokenCueRef = React.useRef<{ cue: string; timestamp: number } | null>(null);
  const cueHysteresisControllerRef = React.useRef(
    new CueHysteresisController<string>({ showFrames: SHOW_N_FRAMES, hideFrames: HIDE_N_FRAMES })
  );
  const cueHysteresisLastTickRef = React.useRef<string | null>(null);
  const stablePrimaryCueRef = React.useRef<string | null>(null);
  const gestureHoldStartRef = React.useRef<number | null>(null);
  const lastGestureTriggerRef = React.useRef(0);
  const overlayLayout = React.useRef<{ width: number; height: number } | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const isScreenFocused = useIsFocused();
  const sessionIdRef = React.useRef(generateSessionId());
  const sessionStartRef = React.useRef(new Date().toISOString());
  const cueCountersRef = React.useRef({ total: 0, spoken: 0, droppedRepeat: 0, droppedDisabled: 0 });
  const fpsStatsRef = React.useRef<{ count: number; sum: number; min: number }>({ count: 0, sum: 0, min: Number.POSITIVE_INFINITY });
  const [watchMirrorEnabled, setWatchMirrorEnabled] = useState(Platform.OS === 'ios');
  const [watchPaired, setWatchPaired] = useState(false);
  const [watchInstalled, setWatchInstalled] = useState(false);
  const [watchReachable, setWatchReachable] = useState(false);
  const watchMirrorTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const watchMirrorInFlightRef = React.useRef(false);
  const watchTrackingPublishAtRef = React.useRef(0);
  const watchTrackingSignatureRef = React.useRef<string | null>(null);
  const [shadowModeEnabled, setShadowModeEnabled] = useState(true);
  const shadowModeEnabledRef = React.useRef(true);
  const shadowStatsRef = React.useRef(createShadowStatsAccumulator());
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
      }
    };

    configure().catch((error) => {
      if (!cancelled && DEV) {
        warnWithTs('[ScanARKit] Failed to configure MediaPipe shadow', error);
      }
      if (!cancelled) {
        setShadowProviderRuntime('mediapipe_proxy');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [DEV, isTracking, mediaPipeModelPath, shadowModeEnabled]);

  useEffect(() => {
    const shouldPollMediaPipe =
      Platform.OS === 'ios' &&
      isTracking &&
      shadowModeEnabled &&
      shadowProviderRuntime === 'mediapipe';

    if (!shouldPollMediaPipe) {
      if (mediaPipePollTimerRef.current) {
        clearInterval(mediaPipePollTimerRef.current);
        mediaPipePollTimerRef.current = null;
      }
      mediaPipePollInFlightRef.current = false;
      mediaPipePoseRef.current = null;
      return;
    }

    let active = true;

    const poll = async () => {
      if (!active || mediaPipePollInFlightRef.current) {
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
      if (mediaPipePollTimerRef.current) {
        clearInterval(mediaPipePollTimerRef.current);
        mediaPipePollTimerRef.current = null;
      }
      mediaPipePollInFlightRef.current = false;
    };
  }, [DEV, isTracking, shadowModeEnabled, shadowProviderRuntime]);

  const updateRecordingQuality = useCallback(async (value: RecordingQuality) => {
    setRecordingQuality(value);
    try {
      await AsyncStorage.setItem(QUALITY_STORAGE_KEY, value);
    } catch {}
  }, []);

  const repIndexTrackerRef = React.useRef(new RepIndexTracker());

  const lastPoseTimestampRef = React.useRef<number | null>(null);
  const recordingActiveRef = React.useRef(false);
  const recordingStartAtRef = React.useRef<string | null>(null);
  const recordingStartEpochMsRef = React.useRef<number>(0);
  const recordingStartFrameTimestampRef = React.useRef<number | null>(null);
  const recordingStartRepsRef = React.useRef<number>(0);
  const recordingFqiScoresRef = React.useRef<number[]>([]);

  const { speak: speakCue, stop: stopSpeech } = useSpeechFeedback({
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

  // Initialize telemetry context on mount
  useEffect(() => {
    initSessionContext().catch((error) => {
      if (__DEV__) {
        warnWithTs('[ScanARKit] Failed to initialize session context', error);
      }
    });
    resetFrameCounter();
    shadowStatsRef.current = createShadowStatsAccumulator();
    shadowProviderCountsRef.current = createShadowProviderCounts();
    mediaPipePoseRef.current = null;
    realtimeFormEngineRef.current = createRealtimeEngineState();
    lastShadowMeanAbsDeltaRef.current = null;
    resetBaselineDebugMetrics();
  }, []);

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
      }
    },
    onRepComplete: (repNumber: number, fqi: number) => {
      setRepCount(repNumber);
      repIndexTrackerRef.current.endRep();
      if (recordingActiveRef.current && Date.now() >= recordingStartEpochMsRef.current) {
        recordingFqiScoresRef.current.push(fqi);
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
    setActivePhase(nextInitialPhase);
    setRepCount(0);
    setActiveMetrics(null);
    setLivePullupPartialStatus(null);
    lastLivePartialBadgeRef.current = null;
    repIndexTrackerRef.current.reset();
    shadowStatsRef.current = createShadowStatsAccumulator();
    shadowProviderCountsRef.current = createShadowProviderCounts();
    mediaPipePoseRef.current = null;
    realtimeFormEngineRef.current = createRealtimeEngineState();
    lastShadowMeanAbsDeltaRef.current = null;
    resetBaselineDebugMetrics();
    setWorkoutController(detectionMode);
  }, [detectionMode, resetBaselineDebugMetrics, setWorkoutController]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setJointAngles(null);
      jointAnglesStateRef.current = null;
      realtimeFormEngineRef.current = createRealtimeEngineState();
      lastShadowMeanAbsDeltaRef.current = null;
      setFps(0);
      setSmoothedPose2DJoints(null);
      smoothedPose2DRef.current = null;
      pose2DCacheRef.current = {};
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
            durationMs: 1000,
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
      } else {
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
      return;
    }

    const elapsed = pose.timestamp - frameStatsRef.current.lastTimestamp;
    if (elapsed >= 1) {
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
    // DEV is a stable constant; avoid dependency churn in hot loop
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose2D]);

  useEffect(() => {
    if (!pose2D || pose2D.joints.length === 0) {
      pose2DCacheRef.current = {};
      smoothedPose2DRef.current = null;
      setSmoothedPose2DJoints(null);
      return;
    }

    const alpha = 0.55;
    const cache = pose2DCacheRef.current;
    const joints = pose2D.joints;
    const nextJoints = joints.map((joint) => {
      if (!joint.isTracked) {
        return { ...joint };
      }
      const key = joint.name.toLowerCase();
      const prev = cache[key];
      const targetX = joint.x;
      const targetY = joint.y;
      const easedX = prev ? prev.x + (targetX - prev.x) * alpha : targetX;
      const easedY = prev ? prev.y + (targetY - prev.y) * alpha : targetY;
      cache[key] = { x: easedX, y: easedY };
      return { ...joint, x: easedX, y: easedY };
    });

    Object.keys(cache).forEach((key) => {
      if (!joints.some((joint) => joint.name.toLowerCase() === key && joint.isTracked)) {
        delete cache[key];
      }
    });

    const prevSmoothed = smoothedPose2DRef.current;
    const changed =
      !prevSmoothed ||
      prevSmoothed.length !== nextJoints.length ||
      nextJoints.some((joint, idx) => {
        const prev = prevSmoothed[idx];
        if (!prev) return true;
        if (prev.name !== joint.name) return true;
        if (joint.isTracked !== prev.isTracked) return true;
        return (
          Math.abs(prev.x - joint.x) > 0.001 ||
          Math.abs(prev.y - joint.y) > 0.001
        );
      });

    if (changed) {
      smoothedPose2DRef.current = nextJoints;
      let rafId = requestAnimationFrame(() => {
        setSmoothedPose2DJoints(nextJoints);
      });
      return () => cancelAnimationFrame(rafId);
    }

    return undefined;
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
      
      if (DEV) logWithTs('[ScanARKit] Tracking stopped');

      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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

	    const feedback = analyzeForm();
	    const orderedActiveCues = feedback?.filter((cue): cue is string => !!cue) ?? [];
	    const primaryCue = useMemo(() => {
	      if (!isTracking) {
	        return null;
	      }

	      const frameTick = pose
	        ? `pose:${pose.timestamp}`
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
	    }, [isTracking, pose?.timestamp, fixturePlaybackEnabled, fixturePlaybackFramesProcessed, orderedActiveCues]);
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
    speakCue(primaryCue);

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
    }, [cameraPosition, canMirrorFromArkit, DEV]);

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

      captureAndSendWatchMirror();
      watchMirrorTimerRef.current = setInterval(captureAndSendWatchMirror, WATCH_MIRROR_INTERVAL_MS);

      return () => {
        if (watchMirrorTimerRef.current) {
          clearInterval(watchMirrorTimerRef.current);
          watchMirrorTimerRef.current = null;
        }
      };
    }, [watchMirrorActive, captureAndSendWatchMirror]);

    // Watch Connectivity: Listen for commands
    useEffect(() => {
      const unsubscribe = watchEvents.addListener('message', (message: { command?: string }) => {
        if (message.command === 'start') {
          if (!isTracking && supportStatus === 'supported') {
            startTracking();
          }
        } else if (message.command === 'stop') {
          if (isTracking) {
            stopTracking();
          }
        }
      });

      return () => unsubscribe();
    }, [isTracking, supportStatus, startTracking, stopTracking]);

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

	      const payload = buildWatchTrackingPayload({
	        now,
	        isTracking: !!isTracking,
	        mode: detectionMode,
        phase,
        reps,
        primaryCue: primaryCue ?? null,
        metrics,
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
	      primaryCue,
	      repCount,
	      watchInstalled,
	      watchPaired,
	    ]);

    const uploadRecordedVideo = useCallback(async (payload: { uri: string; exercise: string; metrics: ClipUploadMetrics }) => {
      if (uploading) return false;
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
        return true;
      } catch (error) {
        errorWithTs('[ScanARKit] Upload recorded video failed', error);
        const message = error instanceof Error ? error.message : 'Could not upload recording.';
        setPreviewError(message);
        Alert.alert('Upload failed', message);
        return false;
      } finally {
        setUploading(false);
      }
    }, [uploading]);

    const autoUploadAnalysisVideo = useCallback(async (payload: { uri: string; exercise: string; metrics: ClipUploadMetrics }) => {
      try {
        const uploadAllowed = await shouldUploadVideo();
        if (!uploadAllowed) {
          return;
        }

        const info = await FileSystem.getInfoAsync(payload.uri);
        if (!info.exists) {
          return;
        }
        if (info.size && info.size > MAX_UPLOAD_BYTES) {
          return;
        }

        await uploadWorkoutVideo({
          fileUri: payload.uri,
          exercise: payload.exercise,
          metrics: payload.metrics,
          analysisOnly: true,
        });
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
    }, [DEV, isRecording, isFinalizingRecording, isTracking, recordPreview, recordingQuality, repCount]);

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

    if (!smoothedPose2DJoints || smoothedPose2DJoints.length === 0) {
      gestureHoldStartRef.current = null;
      return;
    }

    const findJoint = (needle: string) =>
      smoothedPose2DJoints.find(
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
    smoothedPose2DJoints,
    isRecording,
    isFinalizingRecording,
    startRecordingVideo,
  ]);

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
        <View style={styles.loaderContainer}>
          <View style={styles.loaderCard}>
            <View style={styles.loaderLineShort} />
            <View style={styles.loaderLine} />
            <View style={styles.loaderLine} />
          </View>
          <View style={styles.loaderCard}>
            <View style={styles.loaderLineShort} />
            <View style={styles.loaderLine} />
            <View style={styles.loaderLine} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (supportStatus === 'unsupported') {
    // Debug info: Check what BodyTracker reports
    const nativeDiagnostics = BodyTracker.getSupportDiagnostics();
    const debugInfo = {
      platform: Platform.OS,
      platformVersion: Platform.Version,
      nativeSupported,
      nativeModuleLoaded: BodyTracker.isNativeModuleLoaded(),
      nativeDiagnostics,
      isSupportedResult: nativeDiagnostics?.finalSupported ?? nativeSupported,
    };

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={60} color="#FF6B6B" />
          <Text style={styles.errorText}>Device not supported</Text>
          {__DEV__ ? (
            <Text style={{ color: '#666', fontSize: 10, marginTop: 20, textAlign: 'center' }}>
              Debug: {JSON.stringify(debugInfo, null, 2)}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
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
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: topBarOffset }]}>
        <View style={styles.topBarContent}>
          <TouchableOpacity
            style={styles.topBarButton}
            onPress={() => router.back()}
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
                const jointsByName = new Map<string, Joint2D>();
                smoothedPose2DJoints.forEach((joint) => {
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

              {/* Draw joints */}
              {smoothedPose2DJoints.map((joint: Joint2D, index: number) => {
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
              })}
            </Svg>
          )}
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
</View>
  );
}
