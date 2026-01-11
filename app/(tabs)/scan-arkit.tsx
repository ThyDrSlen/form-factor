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
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Svg, Circle, Line } from 'react-native-svg';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  watchEvents,
  sendMessage,
  updateWatchContext,
  getIsPaired,
  getIsWatchAppInstalled,
  getReachability,
} from '@/lib/watch-connectivity';
import { buildWatchTrackingPayload } from '@/lib/watch-connectivity/tracking-payload';

// Import ARKit module - Metro auto-resolves to .ios.ts or .web.ts
import { BodyTracker, useBodyTracking, type JointAngles, type Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import { useSpeechFeedback } from '@/hooks/use-speech-feedback';
import { generateSessionId, logCueEvent, upsertSessionMetrics } from '@/lib/services/cue-logger';
import { logPoseSample, flushPoseBuffer, resetFrameCounter } from '@/lib/services/pose-logger';
import { RepIndexTracker } from '@/lib/services/rep-index-tracker';
import { shouldEndRep, shouldStartRep } from '@/lib/services/workout-runtime';
import {
  initSessionContext,
  incrementPoseLost,
  markCuesDisabled,
  getSessionQuality,
} from '@/lib/services/telemetry-context';
import { logRep } from '@/lib/services/rep-logger';
import { calculateFqi, extractRepFeatures, type RepAngles } from '@/lib/services/fqi-calculator';
import {
  getWorkoutById,
  getWorkoutByMode,
  getWorkoutIds,
  getPhaseStaticCue,
  isDetectionMode,
  type DetectionMode,
} from '@/lib/workouts';
import type { WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';
import { uploadWorkoutVideo } from '@/lib/services/video-service';
import { buildVideoMetricsForClip, type RecordingQuality } from '@/lib/services/video-metrics';
import { styles } from '../../styles/tabs/_scan-arkit.styles';

// Phase and detection mode types are now imported from lib/workouts
type BaseUploadMetrics =
  | {
      mode: 'pullup';
      reps: number;
      avgElbowDeg: number | null;
      avgShoulderDeg: number | null;
      headToHand: number | null;
    }
  | {
      mode: 'pushup';
      reps: number;
      avgElbowDeg: number | null;
      hipDropRatio: number | null;
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
const QUALITY_STORAGE_KEY = 'ff.recordingQuality';
const QUALITY_LABELS: Record<RecordingQuality, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
};

// Metrics types are now imported from workout definitions (PullUpMetrics, PushUpMetrics)

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

const PreviewPlayer = ({ uri }: { uri: string }) => {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  return (
    <VideoView
      player={player}
      style={styles.previewVideo}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture
    />
  );
};

export default function ScanARKitScreen() {
  const DEV = __DEV__;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const logWithTs = useCallback((...args: unknown[]) => {
    console.log(new Date().toISOString(), ...args);
  }, []);
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
      console.warn('[ScanARKit] Media library permission check failed', error);
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
  } = useBodyTracking(30);
  const [supportStatus, setSupportStatus] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');
  const [jointAngles, setJointAngles] = useState<JointAngles | null>(null);
  const [fps, setFps] = useState(0);
  const textOpacity = React.useRef(new Animated.Value(1)).current;
  const frameStatsRef = React.useRef({ lastTimestamp: 0, frameCount: 0 });
  const smoothedAnglesRef = React.useRef<JointAngles | null>(null);
  const jointAnglesStateRef = React.useRef<JointAngles | null>(null);
  const [repCount, setRepCount] = useState(0);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>('pullup');
  const activeWorkoutDef = useMemo(() => getWorkoutByMode(detectionMode), [detectionMode]);
  const [activePhase, setActivePhase] = useState<string>(getWorkoutByMode('pullup').initialPhase);
  const [audioFeedbackEnabled, setAudioFeedbackEnabled] = useState(true);
  const activePhaseRef = React.useRef<string>(getWorkoutByMode('pullup').initialPhase);
  const lastRepTimestampRef = React.useRef(0);
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
  const [savingRecording, setSavingRecording] = useState(false);
  const recordingStopInFlightRef = React.useRef(false);
  const [smoothedPose2DJoints, setSmoothedPose2DJoints] = useState<Joint2D[] | null>(null);
  const smoothedPose2DRef = React.useRef<Joint2D[] | null>(null);
  const pose2DCacheRef = React.useRef<Record<string, { x: number; y: number }>>({});
  const lastSpokenCueRef = React.useRef<{ cue: string; timestamp: number } | null>(null);
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
    BodyTracker.setSubjectLockEnabled(subjectLockEnabled);
  }, [subjectLockEnabled]);

  const updateRecordingQuality = useCallback(async (value: RecordingQuality) => {
    setRecordingQuality(value);
    try {
      await AsyncStorage.setItem(QUALITY_STORAGE_KEY, value);
    } catch {}
  }, []);

  // Rep tracking refs for FQI calculation and logging
  const repStartTsRef = React.useRef<number>(0);
  const repStartAnglesRef = React.useRef<JointAngles | null>(null);
  const repMinAnglesRef = React.useRef<JointAngles | null>(null);
  const repMaxAnglesRef = React.useRef<JointAngles | null>(null);
  const repCuesRef = React.useRef<{ type: string; ts: string }[]>([]);
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
        console.warn('[ScanARKit] Failed to initialize session context', error);
      }
    });
    resetFrameCounter();
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

      // Flush any remaining pose samples before session ends
      flushPoseBuffer().catch((error) => {
        if (__DEV__) {
          console.warn('[ScanARKit] Failed to flush pose buffer on cleanup', error);
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
      });
    };
  }, []);

  const transitionPhase = useCallback((next: string) => {
    if (activePhaseRef.current !== next) {
      activePhaseRef.current = next;
      setActivePhase(next);
    }
  }, []);

  // Helper: Start tracking a new rep
  const startRepTracking = useCallback((angles: JointAngles) => {
    repStartTsRef.current = Date.now();
    repStartAnglesRef.current = { ...angles };
    repMinAnglesRef.current = { ...angles };
    repMaxAnglesRef.current = { ...angles };
    repCuesRef.current = [];
  }, []);

  const resetRepTracking = useCallback(() => {
    repIndexTrackerRef.current.reset();
    repStartTsRef.current = 0;
    repStartAnglesRef.current = null;
    repMinAnglesRef.current = null;
    repMaxAnglesRef.current = null;
    repCuesRef.current = [];
  }, []);

  useEffect(() => {
    const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
    activePhaseRef.current = nextInitialPhase;
    setActivePhase(nextInitialPhase);
    setRepCount(0);
    setActiveMetrics(null);
    lastRepTimestampRef.current = 0;
    resetRepTracking();
  }, [detectionMode, resetRepTracking]);

  // Helper: Update min/max angles during rep
  const updateRepAngles = useCallback((angles: JointAngles) => {
    if (repStartTsRef.current === 0) return; // Not tracking a rep

    const min = repMinAnglesRef.current;
    const max = repMaxAnglesRef.current;

    if (min && max) {
      repMinAnglesRef.current = {
        leftKnee: Math.min(min.leftKnee, angles.leftKnee),
        rightKnee: Math.min(min.rightKnee, angles.rightKnee),
        leftElbow: Math.min(min.leftElbow, angles.leftElbow),
        rightElbow: Math.min(min.rightElbow, angles.rightElbow),
        leftHip: Math.min(min.leftHip, angles.leftHip),
        rightHip: Math.min(min.rightHip, angles.rightHip),
        leftShoulder: Math.min(min.leftShoulder, angles.leftShoulder),
        rightShoulder: Math.min(min.rightShoulder, angles.rightShoulder),
      };
      repMaxAnglesRef.current = {
        leftKnee: Math.max(max.leftKnee, angles.leftKnee),
        rightKnee: Math.max(max.rightKnee, angles.rightKnee),
        leftElbow: Math.max(max.leftElbow, angles.leftElbow),
        rightElbow: Math.max(max.rightElbow, angles.rightElbow),
        leftHip: Math.max(max.leftHip, angles.leftHip),
        rightHip: Math.max(max.rightHip, angles.rightHip),
        leftShoulder: Math.max(max.leftShoulder, angles.leftShoulder),
        rightShoulder: Math.max(max.rightShoulder, angles.rightShoulder),
      };
    }
  }, []);

  // Helper: Complete and log a rep
  const completeRepTracking = useCallback(async (
    exercise: string,
    repNumber: number,
    endAngles: JointAngles
  ) => {
    if (repStartTsRef.current === 0 || !repStartAnglesRef.current || !repMinAnglesRef.current || !repMaxAnglesRef.current) {
      return; // No rep was being tracked
    }

    const workoutDef = getWorkoutById(exercise);
    if (!workoutDef) {
      if (__DEV__) console.warn(`[ScanARKit] No workout definition for ${exercise}`);
      return;
    }

    const endTs = Date.now();
    const durationMs = endTs - repStartTsRef.current;

    const repAngles: RepAngles = {
      start: repStartAnglesRef.current,
      end: endAngles,
      min: repMinAnglesRef.current,
      max: repMaxAnglesRef.current,
    };

    // Calculate FQI and extract features
    const fqiResult = calculateFqi(repAngles, durationMs, repNumber, workoutDef);
    const features = extractRepFeatures(repAngles, durationMs);

    if (recordingActiveRef.current && endTs >= recordingStartEpochMsRef.current) {
      recordingFqiScoresRef.current.push(fqiResult.score);
    }

    // Log the rep
    try {
      await logRep({
        sessionId: sessionIdRef.current,
        repIndex: repNumber,
        exercise,
        startTs: new Date(repStartTsRef.current).toISOString(),
        endTs: new Date(endTs).toISOString(),
        features,
        fqi: fqiResult.score,
        faultsDetected: fqiResult.detectedFaults,
        cuesEmitted: repCuesRef.current,
      });

      if (__DEV__) {
        console.log(
          `[ScanARKit] Rep ${repNumber} logged: Form Score=${fqiResult.score}, faults=${fqiResult.detectedFaults.join(',')}`
        );
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[ScanARKit] Failed to log rep', error);
      }
    }

    // Reset tracking state
    repStartTsRef.current = 0;
    repStartAnglesRef.current = null;
    repMinAnglesRef.current = null;
    repMaxAnglesRef.current = null;
    repCuesRef.current = [];
  }, []);

  const updateWorkoutCycle = useCallback(
    (angles: JointAngles, metrics: WorkoutMetrics, workoutDef: WorkoutDefinition) => {
      const now = Date.now();
      const prevPhase = activePhaseRef.current;
      const nextPhase = workoutDef.getNextPhase(prevPhase as never, angles, metrics as never) as string;

      if (nextPhase !== prevPhase) {
        transitionPhase(nextPhase);
      }

      if (repStartTsRef.current > 0 && nextPhase === workoutDef.initialPhase && prevPhase !== nextPhase) {
        resetRepTracking();
      }

      if (shouldStartRep(workoutDef.repBoundary as never, prevPhase as never, nextPhase as never)) {
        repIndexTrackerRef.current.startRep(repCount);
        startRepTracking(angles);
      }

      if (repStartTsRef.current > 0) {
        updateRepAngles(angles);
      }

      const repActive = repStartTsRef.current > 0;
      const lastRepTimestampMs = lastRepTimestampRef.current;
      if (shouldEndRep(workoutDef.repBoundary as never, prevPhase as never, nextPhase as never, repActive, now, lastRepTimestampMs)) {
        lastRepTimestampRef.current = now;

        const newRepCount = repCount + 1;
        const activeRepIndex = repIndexTrackerRef.current.current() ?? newRepCount;

        setRepCount(newRepCount);

        if (Platform.OS === 'ios') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }

        completeRepTracking(workoutDef.id, activeRepIndex, angles);
        repIndexTrackerRef.current.endRep();
      }
    },
    [
      completeRepTracking,
      repCount,
      resetRepTracking,
      startRepTracking,
      transitionPhase,
      updateRepAngles,
    ]
  );

  useEffect(() => {
    if (DEV) {
      console.log('[ScanARKit] Component mounted - Platform:', Platform.OS);
      console.log('[ScanARKit] nativeSupported value:', nativeSupported);
    }
    
    if (Platform.OS === 'web') {
      setSupportStatus('unsupported');
      return;
    }

    if (nativeSupported) {
      if (DEV) console.log('[ScanARKit] Device is supported!');
      setSupportStatus('supported');
    } else {
      if (DEV) console.log('[ScanARKit] Device NOT supported');
      setSupportStatus('unsupported');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeSupported]);

  // Auto-start tracking when supported
  useEffect(() => {
    if (DEV) {
      console.log('[ScanARKit] Auto-start check:', {
        supportStatus,
        isTracking,
        cameraPosition,
        willStart: supportStatus === 'supported' && !isTracking && cameraPosition === 'back'
      });
    }
    
    if (supportStatus === 'supported' && !isTracking && cameraPosition === 'back') {
      if (DEV) console.log('[ScanARKit] ✅ Auto-starting tracking...');
      startTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportStatus, isTracking, cameraPosition]);

  // Debug pose updates (throttled logging)
  useEffect(() => {
    if (!pose) {
      if (DEV) console.log('[ScanARKit] ℹ️ No pose data');
      // Track pose lost if we were previously tracking
      if (jointAnglesStateRef.current !== null && isTracking) {
        incrementPoseLost();
      }
      frameStatsRef.current = { lastTimestamp: 0, frameCount: 0 };
      setJointAngles(null);
      jointAnglesStateRef.current = null;
      smoothedAnglesRef.current = null;
      setFps(0);
      setSmoothedPose2DJoints(null);
      smoothedPose2DRef.current = null;
      pose2DCacheRef.current = {};
      setActiveMetrics(null);
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      resetRepTracking();
      return;
    }

    lastPoseTimestampRef.current = pose.timestamp;

    // Only log every 30 frames (once per second at 30fps)
    const shouldLog = frameStatsRef.current.frameCount % 30 === 0;
    
    if (shouldLog && DEV) {
      console.log('[ScanARKit] 📊 Pose update:', {
        joints: pose.joints.length,
        timestamp: pose.timestamp,
        isTracking: pose.isTracking,
        frameCount: frameStatsRef.current.frameCount
      });
    }

    try {
      const angles = BodyTracker.calculateAllAngles(pose);
      const get = (n: string) => BodyTracker.findJoint(pose, n);
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
      const prev = smoothedAnglesRef.current;
      let next: JointAngles | null = null;
      if (angles) {
        if (prev) {
          const a = 0.2;
          next = {
            leftKnee: valid.leftKnee ? a * angles.leftKnee + (1 - a) * prev.leftKnee : prev.leftKnee,
            rightKnee: valid.rightKnee ? a * angles.rightKnee + (1 - a) * prev.rightKnee : prev.rightKnee,
            leftElbow: valid.leftElbow ? a * angles.leftElbow + (1 - a) * prev.leftElbow : prev.leftElbow,
            rightElbow: valid.rightElbow ? a * angles.rightElbow + (1 - a) * prev.rightElbow : prev.rightElbow,
            leftHip: valid.leftHip ? a * angles.leftHip + (1 - a) * prev.leftHip : prev.leftHip,
            rightHip: valid.rightHip ? a * angles.rightHip + (1 - a) * prev.rightHip : prev.rightHip,
            leftShoulder: valid.leftShoulder ? a * angles.leftShoulder + (1 - a) * prev.leftShoulder : prev.leftShoulder,
            rightShoulder: valid.rightShoulder ? a * angles.rightShoulder + (1 - a) * prev.rightShoulder : prev.rightShoulder,
          };
        } else {
          next = angles;
        }
      } else {
        next = prev;
      }

      if (shouldLog && next && DEV) {
        console.log('[ScanARKit] 📐 Joint angles:', {
          leftKnee: next.leftKnee.toFixed(1),
          rightKnee: next.rightKnee.toFixed(1),
          leftElbow: next.leftElbow.toFixed(1),
          rightElbow: next.rightElbow.toFixed(1)
        });
      }
      
      if (next) {
        smoothedAnglesRef.current = next;
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
          }).catch((error) => {
            if (__DEV__) {
              console.warn('[ScanARKit] Failed to log pose sample', error);
            }
          });
        }

        const jointsMap = new Map<string, { x: number; y: number; isTracked: boolean }>();
        pose.joints.forEach((joint) => {
          jointsMap.set(joint.name, { x: joint.x, y: joint.y, isTracked: joint.isTracked });
        });

        const workoutDef = getWorkoutById(detectionMode);
        if (workoutDef) {
          const metrics = workoutDef.calculateMetrics(next, jointsMap) as WorkoutMetrics;
          setActiveMetrics(metrics);
          updateWorkoutCycle(next, metrics, workoutDef);
        } else {
          setActiveMetrics(null);
        }
      } else {
        resetRepTracking();
        setActiveMetrics(null);
        const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
        activePhaseRef.current = nextInitialPhase;
        transitionPhase(nextInitialPhase);
      }
    } catch (error) {
      console.error('[ScanARKit] ❌ Error calculating angles:', error);
    }

    frameStatsRef.current.frameCount += 1;
    if (frameStatsRef.current.lastTimestamp === 0) {
      frameStatsRef.current.lastTimestamp = pose.timestamp;
      return;
    }

    const elapsed = pose.timestamp - frameStatsRef.current.lastTimestamp;
    if (elapsed >= 1) {
      const newFps = Math.round(frameStatsRef.current.frameCount / elapsed);
      if (DEV) {
        console.log('[ScanARKit] 🎯 Performance:', {
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
  }, [pose, transitionPhase, updateWorkoutCycle, resetRepTracking, detectionMode]);

  // Debug pose2D updates
  useEffect(() => {
    if (DEV && pose2D) {
      console.log('[ScanARKit] 📍 pose2D update:', {
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

    const alpha = 0.35;
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
          Math.abs(prev.x - joint.x) > 0.002 ||
          Math.abs(prev.y - joint.y) > 0.002
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
      if (DEV) console.warn('[ScanARKit] Skipping tracking start: ARKit requires back camera');
      Alert.alert('Back camera required', 'ARKit body tracking only works with the back camera.');
      return;
    }
    try {
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      resetRepTracking();
      setRepCount(0);
      setActiveMetrics(null);
      lastRepTimestampRef.current = 0;

      const startTime = Date.now();
      await startNativeTracking();
      const elapsed = Date.now() - startTime;
      
      if (DEV) logWithTs('[ScanARKit] Tracking started successfully in', elapsed, 'ms');

      if (Platform.OS === 'ios') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error('[ScanARKit] ❌ Failed to start tracking:', error);
      if (DEV) {
        console.error('[ScanARKit] Error details:', {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNativeTracking, transitionPhase, cameraPosition, logWithTs, detectionMode]);

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
      console.error('[ScanARKit] Failed to stop ARKit recording', error);
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
          console.error('[ScanARKit] ❌ Error stopping recording when stopping tracking:', error);
        }
      }

      stopNativeTracking();
      frameStatsRef.current = { lastTimestamp: 0, frameCount: 0 };
      setJointAngles(null);
      setActiveMetrics(null);
      const nextInitialPhase = getWorkoutByMode(detectionMode).initialPhase;
      activePhaseRef.current = nextInitialPhase;
      transitionPhase(nextInitialPhase);
      lastRepTimestampRef.current = 0;
      resetRepTracking();
      setRepCount(0);
      setFps(0);
      
      if (DEV) logWithTs('[ScanARKit] Tracking stopped');

      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (error) {
      console.error('[ScanARKit] ❌ Error stopping tracking:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopNativeTracking, transitionPhase, isRecording, stopRecordingCore, logWithTs, detectionMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  const handleOverlayLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    overlayLayout.current = { width, height };
  }, []);

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

    const wristsTracked = activeMetrics.wristsTracked ?? true;
    if (!activeMetrics.armsTracked || (activeWorkoutDef.id === 'pushup' && !wristsTracked)) {
      messages.push('Keep both hands and elbows visible to the camera.');
      return messages;
    }

    if (activeWorkoutDef.id === 'pullup') {
      const hangThreshold = activeWorkoutDef.thresholds.hang ?? 150;
      const topThreshold = activeWorkoutDef.thresholds.top ?? 85;
      const shoulderElevationThreshold = activeWorkoutDef.thresholds.shoulderElevation ?? 115;
      const avgElbow = activeMetrics.avgElbow;
      const avgShoulder = activeMetrics.avgShoulder;

      if (activePhase === 'hang' && typeof avgElbow === 'number' && avgElbow < hangThreshold - 5) {
        messages.push('Fully extend your arms before the next rep.');
      }

      if (activePhase === 'top' && typeof avgElbow === 'number' && avgElbow > topThreshold + 15) {
        messages.push('Pull higher to bring your chin past the bar.');
      }

      if (typeof avgShoulder === 'number' && avgShoulder > shoulderElevationThreshold) {
        messages.push('Draw your shoulders down to keep your lats engaged.');
      }

      if (messages.length < 2) {
        messages.push('Strong reps — keep the descent smooth.');
      }
    }

    if (activeWorkoutDef.id === 'pushup') {
      const hipSagMax = activeWorkoutDef.thresholds.hipSagMax ?? 0.18;
      const readyElbow = activeWorkoutDef.thresholds.readyElbow ?? 155;
      const bottomElbow = activeWorkoutDef.thresholds.bottom ?? 90;
      const hipDrop = (activeMetrics as { hipDrop?: number | null }).hipDrop ?? null;
      const avgElbow = activeMetrics.avgElbow;

      if (hipDrop !== null && hipDrop > hipSagMax) {
        messages.push('Squeeze glutes to stop hip sag.');
      }

      if (activePhase === 'plank' && typeof avgElbow === 'number' && avgElbow < readyElbow - 5) {
        messages.push('Start from a full lockout to count clean reps.');
      }

      if (activePhase === 'bottom' && typeof avgElbow === 'number' && avgElbow > bottomElbow + 10) {
        messages.push('Lower deeper until elbows hit ~90°.');
      }

      if (messages.length < 2) {
        messages.push('Smooth tempo — steady down, strong press up.');
      }
    }

    return messages.length ? messages : null;
  }, [jointAngles, activeMetrics, activePhase, activeWorkoutDef]);

    const feedback = analyzeForm();
    const primaryCue = feedback?.[0];
    const latestMetricsForUpload = useMemo<BaseUploadMetrics>(
      () =>
        detectionMode === 'pullup'
          ? {
              mode: 'pullup',
              reps: repCount,
              avgElbowDeg: activeMetrics?.avgElbow ?? null,
              avgShoulderDeg: activeMetrics?.avgShoulder ?? null,
              headToHand: activeMetrics?.headToHand ?? null,
            }
          : {
              mode: 'pushup',
              reps: repCount,
              avgElbowDeg: activeMetrics?.avgElbow ?? null,
              hipDropRatio: (activeMetrics as { hipDrop?: number | null }).hipDrop ?? null,
            },
      [detectionMode, repCount, activeMetrics]
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

      // Track cue for rep logging (if rep is being tracked)
      if (repStartTsRef.current > 0) {
        repCuesRef.current.push({
          type: primaryCue,
          ts: new Date(now).toISOString(),
        });
      }
    }, [primaryCue, audioFeedbackEnabled, speakCue]);

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
          return;
        }

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
        if (DEV) console.warn('[ScanARKit] Watch mirror snapshot failed', error);
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
          if (DEV) console.warn('[ScanARKit] Watch status check failed', error);
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
      let metrics: Record<string, number | null>;
      if (latestMetricsForUpload.mode === 'pullup') {
        metrics = {
          avgElbowDeg: latestMetricsForUpload.avgElbowDeg,
          avgShoulderDeg: latestMetricsForUpload.avgShoulderDeg,
          headToHand: latestMetricsForUpload.headToHand,
        };
      } else {
        metrics = {
          avgElbowDeg: latestMetricsForUpload.avgElbowDeg,
          hipDropRatio: latestMetricsForUpload.hipDropRatio,
        };
      }

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
      detectionMode,
      isTracking,
      latestMetricsForUpload,
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
        console.error('[ScanARKit] Upload recorded video failed', error);
        const message = error instanceof Error ? error.message : 'Could not upload recording.';
        setPreviewError(message);
        Alert.alert('Upload failed', message);
        return false;
      } finally {
        setUploading(false);
      }
    }, [uploading]);

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
        console.error('[ScanARKit] Failed to save recording to camera roll', error);
        return false;
      }
    }, [ensureMediaLibraryPermission]);

    const cleanupLocalRecording = useCallback(async (uri: string) => {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch (error) {
        console.warn('[ScanARKit] Failed to delete local recording', error);
      }
    }, []);

    const startRecordingVideo = useCallback(async () => {
      if (isRecording || isFinalizingRecording || recordingStopInFlightRef.current) return;
      if (recordPreview) {
        Alert.alert('Finish review', 'Save or discard the previous recording before starting a new one.');
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
        console.error('[ScanARKit] Failed to start ARKit recording', error);
        recordingActiveRef.current = false;
        setIsRecording(false);
        Alert.alert('Recording error', error instanceof Error ? error.message : 'Could not start recording.');
      }
    }, [DEV, isRecording, isFinalizingRecording, isTracking, recordPreview, recordingQuality, logWithTs, repCount]);

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
        } else {
          Alert.alert('Recording', 'No video file was generated.');
        }
    } catch (error) {
      console.error('[ScanARKit] Failed to stop ARKit recording', error);
      setIsRecording(false);
      Alert.alert('Recording error', error instanceof Error ? error.message : 'Could not stop recording.');
    } finally {
      recordingActiveRef.current = false;
    }
  }, [DEV, isRecording, stopRecordingCore, latestMetricsForUpload, logWithTs, recordingQuality, repCount, activeWorkoutDef.displayName]);

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
  const showTelemetry = isTracking || telemetryReps > 0;
  const telemetryTitle = `${activeWorkoutDef.displayName} Tracker`;
  const telemetryPhaseId = activePhase;
  const telemetryPhaseLabel =
    activeWorkoutDef.phases.find((phase) => phase.id === telemetryPhaseId)?.displayName ??
    String(telemetryPhaseId);
  const telemetryElbow =
    activeMetrics?.armsTracked && typeof activeMetrics.avgElbow === 'number'
      ? `${activeMetrics.avgElbow.toFixed(1)}°`
      : '--';
  const hipDrop = (activeMetrics as { hipDrop?: number | null })?.hipDrop;
  const showHipDrop = hipDrop !== null && hipDrop !== undefined;
  const showShoulder = typeof activeMetrics?.avgShoulder === 'number';
  const telemetrySecondaryLabel = showShoulder ? 'Avg Shoulder' : 'Hip Drop';
  const telemetrySecondaryValue = showShoulder
    ? `${(activeMetrics?.avgShoulder ?? 0).toFixed(1)}°`
    : showHipDrop
    ? `${Math.round((hipDrop ?? 0) * 100)}%`
    : '--';
  const previewMetrics = recordPreview?.metrics;
  const previewReps = previewMetrics?.reps ?? 0;
  const previewPrimaryValue = previewMetrics?.avgElbowDeg;
  const previewPrimaryDisplay =
    previewPrimaryValue === null || previewPrimaryValue === undefined
      ? '--'
      : `${previewPrimaryValue.toFixed(1)}°`;
  const previewSecondaryLabel = previewMetrics?.mode === 'pullup' ? 'Avg Shoulder' : 'Hip Drop';
  const previewSecondaryValue =
    previewMetrics?.mode === 'pullup'
      ? previewMetrics?.avgShoulderDeg
      : previewMetrics?.hipDropRatio;
  const previewSecondaryDisplay = previewMetrics
    ? previewMetrics.mode === 'pullup'
      ? previewSecondaryValue === null || previewSecondaryValue === undefined
        ? '--'
        : `${previewSecondaryValue.toFixed(1)}°`
      : previewSecondaryValue === null || previewSecondaryValue === undefined
      ? '--'
      : `${Math.round(previewSecondaryValue * 100)}%`
    : '--';

  return (
    <View style={styles.container}>
      {/* Header Controls (Absolute) */}
      <TouchableOpacity 
        style={[styles.closeButton, { top: insets.top + 8 }]} 
        onPress={() => router.back()}
      >
        <Ionicons name="close" size={28} color="#F5F7FF" />
      </TouchableOpacity>
      
      <TouchableOpacity 
        style={[styles.infoButton, { top: insets.top + 8 }]}
      >
        <Ionicons name="information-circle-outline" size={24} color="#9AACD1" />
      </TouchableOpacity>

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

        {/* Mode Selector (Dropdown) */}
        <View style={[styles.workoutSelectorContainer, { top: insets.top + 8 }]}>
          <TouchableOpacity
            style={styles.workoutSelectorButton}
            onPress={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <Ionicons 
              name={detectionMode === 'pullup' ? "barbell-outline" : "duplicate-outline"} 
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
                .filter(isDetectionMode)
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
        
        {/* Overlay guides */}
        <View
          style={[styles.overlay, { zIndex: 100 }]}
          pointerEvents={isTracking ? 'none' : 'auto'}
          onStartShouldSetResponder={() => !isTracking}
          onLayout={handleOverlayLayout}
        >

          {!showTelemetry && (
            <Animated.View style={[styles.topGuide, { top: insets.top + 60, opacity: textOpacity }]}>
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
                  if (direct && direct.isTracked) {
                    return direct;
                  }
                  for (const joint of smoothedPose2DJoints) {
                    const key = joint.name.toLowerCase();
                    if (!joint.isTracked) continue;
                    if (
                      key.includes(lower) ||
                      lower.includes(key.replace('_joint', ''))
                    ) {
                      return joint;
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

        {/* Pull-up telemetry display */}
        {showTelemetry && (
          <View style={[styles.anglesDisplay, { top: insets.top + 54 }]}>
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
                <Text style={styles.angleLabel}>Avg Elbow</Text>
                <Text style={styles.angleValue}>{telemetryElbow}</Text>
              </View>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>{telemetrySecondaryLabel}</Text>
                <Text style={styles.angleValue}>{telemetrySecondaryValue}</Text>
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

      {Platform.OS === 'ios' && (
        <TouchableOpacity
          style={[
            styles.watchMirrorButton,
            { top: insets.top + 96 },
            watchMirrorEnabled && styles.watchMirrorButtonActive,
            !watchReady && styles.watchMirrorButtonDisabled,
          ]}
          onPress={() => {
            if (!watchReady) {
              Alert.alert('Watch not ready', 'Pair your Apple Watch and install the watch app first.');
              return;
            }
            setWatchMirrorEnabled((value) => !value);
          }}
          accessibilityRole="button"
          accessibilityLabel={watchMirrorEnabled ? 'Disable watch mirror' : 'Enable watch mirror'}
        >
          <Ionicons
            name={watchMirrorEnabled ? 'watch' : 'watch-outline'}
            size={20}
            color={watchMirrorEnabled ? '#0B1F3A' : '#F5F7FF'}
          />
        </TouchableOpacity>
      )}

      {/* Audio feedback toggle */}
      <TouchableOpacity
        style={[
          styles.audioToggleButton,
          { top: insets.top + 96 },
          audioFeedbackEnabled && styles.audioToggleButtonActive
        ]}
        onPress={() => setAudioFeedbackEnabled((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={audioFeedbackEnabled ? 'Disable audio cues' : 'Enable audio cues'}
      >
        <Ionicons
          name={audioFeedbackEnabled ? 'volume-high' : 'volume-mute'}
          size={22}
          color={audioFeedbackEnabled ? '#0B1F3A' : '#F5F7FF'}
        />
      </TouchableOpacity>

      {/* Controls */}
      <View style={[styles.controls, { bottom: insets.bottom + 30 }]}>
        <View style={styles.gestureToggleRow}>
          <Text style={styles.gestureToggleLabel}>Auto-record gesture</Text>
          <Switch
            value={gestureRecordingEnabled}
            onValueChange={setGestureRecordingEnabled}
          />
        </View>
        <View style={styles.lockControls}>
          <View style={styles.lockToggleRow}>
            <Text style={styles.lockLabel}>Lock subject</Text>
            <Switch value={subjectLockEnabled} onValueChange={setSubjectLockEnabled} />
          </View>
          <TouchableOpacity style={styles.lockButton} onPress={handleReacquireSubject}>
            <Text style={styles.lockButtonText}>Reacquire</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.qualitySelector}>
          <Text style={styles.qualityLabel}>Quality</Text>
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
      <View style={[styles.statusBadge, { top: insets.top + 54 }]}>
        <View style={[styles.statusDot, isTracking && styles.statusDotActive]} />
        <View>
          <Text style={styles.statusText}>
            {isTracking ? 'Tracking' : 'Inactive'} • {pose?.joints.length || 0} joints • {fps} FPS
          </Text>
          <Text style={styles.statusSubtext}>
            {Platform.OS === 'ios' ? 'GPU: Metal' : Platform.OS === 'android' ? 'GPU: OpenGL/Vulkan' : 'GPU: WebGL'}
          </Text>
        </View>
      </View>

      <Modal
        visible={isPreviewVisible}
        transparent
        animationType="slide"
        onRequestClose={handleDiscardRecording}
      >
        <View style={styles.previewOverlay}>
          <View style={[styles.previewSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.previewHandle} />
            <Text style={styles.previewTitle}>Review recording</Text>
            <View style={styles.previewVideoWrap}>
              {recordPreview?.uri ? (
                <PreviewPlayer uri={recordPreview.uri} />
              ) : (
                <View style={styles.previewVideoPlaceholder}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              )}
            </View>
            <View style={styles.previewMetaRow}>
              <View style={styles.previewMetaItem}>
                <Text style={styles.previewMetaLabel}>Exercise</Text>
                <Text style={styles.previewMetaValue}>{recordPreview?.exercise ?? '--'}</Text>
              </View>
              <View style={styles.previewMetaItem}>
                <Text style={styles.previewMetaLabel}>Reps</Text>
                <Text style={styles.previewMetaValue}>{previewReps}</Text>
              </View>
              <View style={styles.previewMetaItem}>
                <Text style={styles.previewMetaLabel}>Size</Text>
                <Text style={styles.previewMetaValue}>{formatBytes(recordPreview?.sizeBytes)}</Text>
              </View>
            </View>
            <View style={styles.previewMetaRow}>
              <View style={styles.previewMetaItem}>
                <Text style={styles.previewMetaLabel}>Avg Elbow</Text>
                <Text style={styles.previewMetaValue}>{previewPrimaryDisplay}</Text>
              </View>
              <View style={styles.previewMetaItem}>
                <Text style={styles.previewMetaLabel}>{previewSecondaryLabel}</Text>
                <Text style={styles.previewMetaValue}>{previewSecondaryDisplay}</Text>
              </View>
              <View style={styles.previewMetaItem}>
                <Text style={styles.previewMetaLabel}>Library</Text>
                <Text style={styles.previewMetaValue}>
                  {recordPreview?.savedToLibrary ? 'Saved' : 'Not saved'}
                </Text>
              </View>
            </View>
            {previewError ? (
              <Text style={styles.previewErrorText}>{previewError}</Text>
            ) : null}
            <View style={styles.previewActions}>
              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonGhost]}
                onPress={handleDiscardRecording}
                disabled={uploading || savingRecording}
              >
                <Text style={[styles.previewButtonText, styles.previewButtonTextGhost]}>
                  Discard
                </Text>
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
            </View>
          </View>
        </View>
      </Modal>
</View>
  );
}
