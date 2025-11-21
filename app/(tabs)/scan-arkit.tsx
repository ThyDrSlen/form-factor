import React, { useState, useEffect, useCallback } from 'react';
import { Alert, Text, TouchableOpacity, View, Platform, Animated, ActivityIndicator, ToastAndroid, LayoutChangeEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Svg, Circle, Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

// Import ARKit module - Metro auto-resolves to .ios.ts or .web.ts
import { BodyTracker, useBodyTracking, type JointAngles, type Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import { useSpeechFeedback } from '@/hooks/use-speech-feedback';
import { uploadWorkoutVideo } from '@/lib/services/video-service';
import { styles } from './scan-arkit.styles';

type PullUpPhase = 'idle' | 'hang' | 'pull' | 'top';
type PushUpPhase = 'setup' | 'plank' | 'lowering' | 'bottom' | 'press';
type DetectionMode = 'pullup' | 'pushup';
type UploadMetrics =
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

const PULL_UP_THRESHOLDS = {
  hang: 150,
  engage: 135,
  top: 85,
  release: 145,
} as const;

const PUSH_UP_THRESHOLDS = {
  readyElbow: 155,     // Arms nearly locked out
  loweringStart: 140,  // Begin counting a descent
  bottom: 90,          // Bottom position
  press: 120,          // On the way up
  finish: 155,         // Completed press
  hipSagMax: 0.18,     // Meters of allowed hip drop vs shoulders
} as const;

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

interface PullUpMetrics {
  avgElbow: number;
  avgShoulder: number;
  headToHand: number | null;
  armsTracked: boolean;
}

interface PushUpMetrics {
  avgElbow: number;
  hipDrop: number | null;
  armsTracked: boolean;
  wristsTracked: boolean;
}

let Camera: any = View;
let useCameraDevice: any = () => null;
let useCameraPermission: any = () => ({ hasPermission: false, requestPermission: async () => {} });

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const VisionCamera = require('react-native-vision-camera');
  Camera = VisionCamera.Camera;
  useCameraDevice = VisionCamera.useCameraDevice;
  useCameraPermission = VisionCamera.useCameraPermission;
}

let ARKitView: any = View;
if (Platform.OS === 'ios') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ARKitView = require('@/lib/arkit/ARKitBodyView').default;
}

export default function ScanARKitScreen() {
  const DEV = __DEV__;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(cameraPosition);
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = React.useRef<any>(null);
  const [zoom, setZoom] = useState(1);
  const clampZoom = useCallback((z: number) => {
    const min = (device as any)?.minZoom ?? 1;
    const max = (device as any)?.maxZoom ?? 8;
    return Math.max(min, Math.min(max, z));
  }, [device]);
  const stepZoom = useCallback((delta: number) => {
    setZoom((z) => clampZoom(z + delta));
  }, [clampZoom]);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  
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
  const [pullUpPhase, setPullUpPhase] = useState<PullUpPhase>('idle');
  const [detectionMode, setDetectionMode] = useState<DetectionMode>('pullup');
  const [audioFeedbackEnabled, setAudioFeedbackEnabled] = useState(true);
  const phaseRef = React.useRef<PullUpPhase>('idle');
  const repStateRef = React.useRef<PullUpPhase>('idle');
  const lastRepTimestampRef = React.useRef(0);
  const [pullUpMetrics, setPullUpMetrics] = useState<PullUpMetrics | null>(null);
  const pullUpMetricsThrottleRef = React.useRef(0);
  const [pushUpPhase, setPushUpPhase] = useState<PushUpPhase>('setup');
  const [pushUpReps, setPushUpReps] = useState(0);
  const [pushUpMetrics, setPushUpMetrics] = useState<PushUpMetrics | null>(null);
  const pushUpStateRef = React.useRef<PushUpPhase>('setup');
  const lastPushUpRepRef = React.useRef(0);
  const [uploading, setUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recordedUriRef = React.useRef<string | null>(null);
  const [smoothedPose2DJoints, setSmoothedPose2DJoints] = useState<Joint2D[] | null>(null);
  const smoothedPose2DRef = React.useRef<Joint2D[] | null>(null);
  const pose2DCacheRef = React.useRef<Record<string, { x: number; y: number }>>({});
  const lastSpokenCueRef = React.useRef<{ cue: string; timestamp: number } | null>(null);
  const overlayLayout = React.useRef<{ width: number; height: number } | null>(null);

  const { speak: speakCue, stop: stopSpeech } = useSpeechFeedback({
    enabled: audioFeedbackEnabled,
    voiceId: undefined, // Use default system voice
    rate: 0.52,
    pitch: 1.0,
    volume: 1,
    minIntervalMs: 2000,
  });

  useEffect(() => {
    if (!audioFeedbackEnabled) {
      lastSpokenCueRef.current = null;
      stopSpeech();
    }
  }, [audioFeedbackEnabled, stopSpeech]);

  useEffect(() => {
    if (detectionMode === 'pullup') {
      pushUpStateRef.current = 'setup';
      setPushUpPhase('setup');
      setPushUpReps(0);
      setPushUpMetrics(null);
      lastPushUpRepRef.current = 0;
    } else {
      repStateRef.current = 'idle';
      phaseRef.current = 'idle';
      setPullUpPhase('idle');
      setRepCount(0);
      setPullUpMetrics(null);
      lastRepTimestampRef.current = 0;
    }
  }, [detectionMode]);

  const transitionPhase = useCallback(
    (next: PullUpPhase) => {
      if (phaseRef.current !== next) {
        phaseRef.current = next;
        setPullUpPhase(next);
      }
    },
    []
  );

  const updatePullUpCycle = useCallback(
    (angles: JointAngles, metrics: PullUpMetrics) => {
      if (!metrics.armsTracked) {
        if (repStateRef.current !== 'idle') {
          repStateRef.current = 'idle';
          transitionPhase('idle');
        }
        return;
      }

      const avgElbow = metrics.avgElbow;
      const state = repStateRef.current;

      if (state === 'idle') {
        if (avgElbow >= PULL_UP_THRESHOLDS.hang) {
          repStateRef.current = 'hang';
          transitionPhase('hang');
        } else if (avgElbow <= PULL_UP_THRESHOLDS.engage) {
          repStateRef.current = 'pull';
          transitionPhase('pull');
        }
        return;
      }

      if (state === 'hang') {
        if (avgElbow <= PULL_UP_THRESHOLDS.engage) {
          repStateRef.current = 'pull';
          transitionPhase('pull');
        }
        return;
      }

      if (state === 'pull') {
        if (avgElbow <= PULL_UP_THRESHOLDS.top) {
          const now = Date.now();
          if (now - lastRepTimestampRef.current > 400) {
            repStateRef.current = 'top';
            transitionPhase('top');
            lastRepTimestampRef.current = now;
            setRepCount((prev) => prev + 1);
            if (Platform.OS === 'ios') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }
          }
        } else if (avgElbow >= PULL_UP_THRESHOLDS.hang) {
          repStateRef.current = 'hang';
          transitionPhase('hang');
        }
        return;
      }

      if (state === 'top') {
        if (avgElbow >= PULL_UP_THRESHOLDS.release) {
          repStateRef.current = 'hang';
          transitionPhase('hang');
        }
      }
    },
    [transitionPhase]
  );

  const updatePushUpCycle = useCallback((metrics: PushUpMetrics) => {
    if (!metrics.armsTracked || !metrics.wristsTracked) {
      pushUpStateRef.current = 'setup';
      setPushUpPhase('setup');
      return;
    }

    const now = Date.now();
    const state = pushUpStateRef.current;
    const hipStable = metrics.hipDrop === null ? true : metrics.hipDrop <= PUSH_UP_THRESHOLDS.hipSagMax;
    const elbow = metrics.avgElbow;

    if (state === 'setup') {
      if (elbow >= PUSH_UP_THRESHOLDS.readyElbow && hipStable) {
        pushUpStateRef.current = 'plank';
        setPushUpPhase('plank');
      }
      return;
    }

    if (state === 'plank') {
      if (elbow <= PUSH_UP_THRESHOLDS.loweringStart) {
        pushUpStateRef.current = 'lowering';
        setPushUpPhase('lowering');
      }
      return;
    }

    if (state === 'lowering') {
      if (elbow <= PUSH_UP_THRESHOLDS.bottom) {
        pushUpStateRef.current = 'bottom';
        setPushUpPhase('bottom');
      }
      return;
    }

    if (state === 'bottom') {
      if (elbow >= PUSH_UP_THRESHOLDS.press) {
        pushUpStateRef.current = 'press';
        setPushUpPhase('press');
      }
      return;
    }

    if (state === 'press') {
      if (elbow >= PUSH_UP_THRESHOLDS.finish && hipStable) {
        if (now - lastPushUpRepRef.current > 400) {
          lastPushUpRepRef.current = now;
          setPushUpReps((prev) => prev + 1);
          if (Platform.OS === 'ios') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          }
        }
        pushUpStateRef.current = 'plank';
        setPushUpPhase('plank');
      }
    }
  }, []);

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
        hasPermission,
        willStart: supportStatus === 'supported' && !isTracking && hasPermission
      });
    }
    
    if (supportStatus === 'supported' && !isTracking && hasPermission) {
      if (DEV) console.log('[ScanARKit] ✅ Auto-starting tracking...');
      startTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportStatus, isTracking, hasPermission]);

  // Request camera permission on mount
  useEffect(() => {
    if (DEV) {
      console.log('[ScanARKit] Camera permission check:', {
        hasPermission,
        device: !!device
      });
    }
    
    if (!hasPermission) {
      if (DEV) console.log('[ScanARKit] Requesting camera permission...');
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  // Debug pose updates (throttled logging)
  useEffect(() => {
    if (!pose) {
      if (DEV) console.log('[ScanARKit] ℹ️ No pose data');
      frameStatsRef.current = { lastTimestamp: 0, frameCount: 0 };
      setJointAngles(null);
      jointAnglesStateRef.current = null;
      smoothedAnglesRef.current = null;
      setFps(0);
      setSmoothedPose2DJoints(null);
      smoothedPose2DRef.current = null;
      pose2DCacheRef.current = {};
      setPullUpMetrics(null);
      setPushUpPhase('setup');
      setPushUpReps(0);
      setPushUpMetrics(null);
      repStateRef.current = 'idle';
      transitionPhase('idle');
      return;
    }

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
      const leftAnkle = get('left_foot');
      const rightAnkle = get('right_foot');
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

        const avgElbow = (next.leftElbow + next.rightElbow) / 2;
        const avgShoulder = (next.leftShoulder + next.rightShoulder) / 2;
        const head = get('head') ?? neck;
        let headToHand: number | null = null;
        if (head?.isTracked && lw?.isTracked && rw?.isTracked) {
          headToHand = head.y - (lw.y + rw.y) / 2;
        }

        if (detectionMode === 'pullup') {
          const metrics: PullUpMetrics = {
            avgElbow,
            avgShoulder,
            headToHand,
            armsTracked: !!(valid.leftElbow && valid.rightElbow),
          };
          const now = Date.now();
          const prevMetrics = pullUpMetricsThrottleRef.current;
          const metricsChanged =
            !pullUpMetrics ||
            Math.abs((pullUpMetrics.avgElbow ?? 0) - metrics.avgElbow) > 0.5 ||
            Math.abs((pullUpMetrics.avgShoulder ?? 0) - metrics.avgShoulder) > 0.5 ||
            pullUpMetrics.armsTracked !== metrics.armsTracked;
          if (metricsChanged || now - prevMetrics > 80) {
            pullUpMetricsThrottleRef.current = now;
            setPullUpMetrics(metrics);
          }
          updatePullUpCycle(next, metrics);
        } else if (detectionMode === 'pushup') {
          // Push-up metrics using elbow angle and hip drop vs shoulders
          const shouldersTracked = valid.leftShoulder && valid.rightShoulder;
          const hipsTracked = valid.leftHip && valid.rightHip;
          let hipDrop: number | null = null;
          if (shouldersTracked && hipsTracked && ls && rs && lh && rh && leftAnkle && rightAnkle) {
            const shoulderY = (ls.y + rs.y) / 2;
            const hipY = (lh.y + rh.y) / 2;
            const ankleY = (leftAnkle.y + rightAnkle.y) / 2;
            const torsoLength = Math.max(0.001, Math.abs(shoulderY - ankleY));
            hipDrop = Math.abs(hipY - shoulderY) / torsoLength;
          }
          const pushMetrics: PushUpMetrics = {
            avgElbow,
            hipDrop,
            armsTracked: !!(valid.leftElbow && valid.rightElbow),
            wristsTracked: !!(lw?.isTracked && rw?.isTracked),
          };
          setPushUpMetrics(pushMetrics);
          updatePushUpCycle(pushMetrics);
        }
      } else {
        setPullUpMetrics(null);
        repStateRef.current = 'idle';
        transitionPhase('idle');
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
      frameStatsRef.current = { lastTimestamp: pose.timestamp, frameCount: 0 };
    }
    // DEV is a stable constant; pullUpMetrics would cause infinite loop (read + set in same effect)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, transitionPhase, updatePullUpCycle, updatePushUpCycle, detectionMode]);

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
    if (DEV) console.log('[ScanARKit] 🎬 Starting tracking...');
    try {
      repStateRef.current = 'idle';
      phaseRef.current = 'idle';
      transitionPhase('idle');
      setRepCount(0);
      setPullUpMetrics(null);
      lastRepTimestampRef.current = 0;
      pushUpStateRef.current = 'setup';
      setPushUpPhase('setup');
      setPushUpReps(0);
      setPushUpMetrics(null);
      lastPushUpRepRef.current = 0;

      const startTime = Date.now();
      await startNativeTracking();
      const elapsed = Date.now() - startTime;
      
      if (DEV) console.log('[ScanARKit] ✅ Tracking started successfully in', elapsed, 'ms');

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
  }, [startNativeTracking, transitionPhase]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (DEV) console.log('[ScanARKit] ⏸️ Stopping tracking...');
    
    try {
      stopNativeTracking();
      frameStatsRef.current = { lastTimestamp: 0, frameCount: 0 };
      setJointAngles(null);
      setPullUpMetrics(null);
      repStateRef.current = 'idle';
      phaseRef.current = 'idle';
      transitionPhase('idle');
      lastRepTimestampRef.current = 0;
      pushUpStateRef.current = 'setup';
      setPushUpPhase('setup');
      setPushUpReps(0);
      setPushUpMetrics(null);
      lastPushUpRepRef.current = 0;
      setFps(0);
      
      if (DEV) console.log('[ScanARKit] ✅ Tracking stopped');

      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (error) {
      console.error('[ScanARKit] ❌ Error stopping tracking:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopNativeTracking, transitionPhase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  const toggleCamera = useCallback(() => {
    setCameraPosition((p) => (p === 'back' ? 'front' : 'back'));
  }, []);

  // Flip camera during tracking
  const flipCameraDuringTracking = useCallback(async () => {
    if (DEV) console.log('[ScanARKit] 🎥 Flipping camera...');
    
    const wasTracking = isTracking;
    const newPosition = cameraPosition === 'back' ? 'front' : 'back';
    
    // If currently tracking, stop it first
    if (wasTracking) {
      stopTracking();
      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    
    // Flip camera position
    setCameraPosition(newPosition);
    
    // Wait for device to update
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    // Only restart tracking if we're going back to back camera (ARKit only supports back camera)
    if (wasTracking && newPosition === 'back') {
      await startTracking();
    }
    
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    if (DEV) console.log('[ScanARKit] ✅ Camera flipped to', newPosition, wasTracking ? (newPosition === 'back' ? 'and tracking restarted' : 'and tracking stopped') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTracking, stopTracking, startTracking, cameraPosition]);

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
  const analyzePullUpForm = useCallback(() => {
    if (!jointAngles) return null;

    const messages: string[] = [];

    if (!pullUpMetrics) {
      messages.push('Move fully into frame so we can track your arms.');
      return messages;
    }

    const phasePrompts: Record<PullUpPhase, string> = {
      idle: 'Get set beneath the bar and brace your core.',
      hang: 'Engage your shoulders before you start the pull.',
      pull: 'Drive elbows toward your ribs and stay tight.',
      top: 'Squeeze at the top, then lower with control.',
    };

    messages.push(phasePrompts[pullUpPhase]);

    if (!pullUpMetrics.armsTracked) {
      messages.push('Keep both elbows and hands visible to the camera.');
      return messages;
    }

    const { avgElbow, avgShoulder } = pullUpMetrics;

    if (pullUpPhase === 'hang' && avgElbow < PULL_UP_THRESHOLDS.hang - 5) {
      messages.push('Fully extend your arms before the next rep.');
    }

    if (pullUpPhase === 'top' && avgElbow > PULL_UP_THRESHOLDS.top + 15) {
      messages.push('Pull higher to bring your chin past the bar.');
    }

    if (avgShoulder > 115) {
      messages.push('Draw your shoulders down to keep your lats engaged.');
    }

    if (messages.length < 2) {
      messages.push('Strong reps — keep the descent smooth.');
    }

    return messages;
  }, [jointAngles, pullUpMetrics, pullUpPhase]);

  const analyzePushUpForm = useCallback(() => {
    if (!jointAngles) return null;

    const messages: string[] = [];
    if (!pushUpMetrics) {
      messages.push('Step into frame and set a straight high plank.');
      return messages;
    }

    const phasePrompts: Record<PushUpPhase, string> = {
      setup: 'Set a strong plank: hands under shoulders, glutes tight.',
      plank: 'Lower under control; keep hips level.',
      lowering: 'Elbows ~45°; keep core braced.',
      bottom: 'Pause briefly, chest just above the floor.',
      press: 'Drive the floor away and lock out.',
    };
    messages.push(phasePrompts[pushUpPhase]);

    if (!pushUpMetrics.armsTracked || !pushUpMetrics.wristsTracked) {
      messages.push('Keep both hands and elbows visible to the camera.');
      return messages;
    }

    if (pushUpMetrics.hipDrop !== null && pushUpMetrics.hipDrop > PUSH_UP_THRESHOLDS.hipSagMax) {
      messages.push('Squeeze glutes to stop hip sag.');
    }

    if (pushUpPhase === 'plank' && pushUpMetrics.avgElbow < PUSH_UP_THRESHOLDS.readyElbow - 5) {
      messages.push('Start from a full lockout to count clean reps.');
    }

    if (pushUpPhase === 'bottom' && pushUpMetrics.avgElbow > PUSH_UP_THRESHOLDS.bottom + 10) {
      messages.push('Lower deeper until elbows hit ~90°.');
    }

    if (messages.length < 2) {
      messages.push('Smooth tempo — steady down, strong press up.');
    }

    return messages;
  }, [jointAngles, pushUpMetrics, pushUpPhase]);

    const feedback = detectionMode === 'pullup' ? analyzePullUpForm() : analyzePushUpForm();
    const primaryCue = feedback?.[0];
    const latestMetricsForUpload: UploadMetrics =
      detectionMode === 'pullup'
        ? {
            mode: 'pullup',
            reps: repCount,
            avgElbowDeg: pullUpMetrics?.avgElbow ?? null,
            avgShoulderDeg: pullUpMetrics?.avgShoulder ?? null,
            headToHand: pullUpMetrics?.headToHand ?? null,
          }
        : {
            mode: 'pushup',
            reps: pushUpReps,
            avgElbowDeg: pushUpMetrics?.avgElbow ?? null,
            hipDropRatio: pushUpMetrics?.hipDrop ?? null,
          };

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
    }, [primaryCue, audioFeedbackEnabled, speakCue]);

    const handleUploadWithMetrics = useCallback(async () => {
      if (uploading) return;
      try {
        const picked = await DocumentPicker.getDocumentAsync({
          type: 'video/*',
          copyToCacheDirectory: true,
          multiple: false,
        });

        if (picked.canceled || !picked.assets?.length) {
          return;
        }

        const asset = picked.assets[0];
        if (asset.mimeType && !asset.mimeType.toLowerCase().startsWith('video')) {
          Alert.alert('Invalid file', 'Please select a video file.');
          return;
        }

        const info = await FileSystem.getInfoAsync(asset.uri);
        if (!info.exists) {
          Alert.alert('Invalid file', 'Selected file is not accessible.');
          return;
        }
        if (info.size && info.size > MAX_UPLOAD_BYTES) {
          Alert.alert('File too large', 'Max file size is 250MB.');
          return;
        }

        if (latestMetricsForUpload.reps === 0) {
          Alert.alert('No reps detected', 'Track a set to attach metrics before uploading.');
          return;
        }

        setUploading(true);

        await uploadWorkoutVideo({
          fileUri: asset.uri,
          exercise: detectionMode === 'pullup' ? 'Pull-Up' : 'Push-Up',
          metrics: latestMetricsForUpload,
        });

        if (Platform.OS === 'android') {
          ToastAndroid.show('Uploaded with metrics', ToastAndroid.SHORT);
        } else {
          Alert.alert('Uploaded', 'Video saved with metrics attached.');
        }
      } catch (error) {
        console.error('[ScanARKit] Upload failed', error);
        Alert.alert('Upload failed', error instanceof Error ? error.message : 'Could not upload video.');
      } finally {
        setUploading(false);
      }
    }, [detectionMode, latestMetricsForUpload, uploading]);

    const uploadRecordedVideo = useCallback(async (uri: string) => {
      if (uploading) return;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) {
          Alert.alert('Recording missing', 'Recorded file is not accessible.');
          return;
        }
        if (info.size && info.size > MAX_UPLOAD_BYTES) {
          Alert.alert('File too large', 'Max file size is 250MB.');
          return;
        }
        setUploading(true);
        await uploadWorkoutVideo({
          fileUri: uri,
          exercise: detectionMode === 'pullup' ? 'Pull-Up' : 'Push-Up',
          metrics: latestMetricsForUpload,
        });
        if (Platform.OS === 'android') {
          ToastAndroid.show('Recorded set uploaded', ToastAndroid.SHORT);
        } else {
          Alert.alert('Uploaded', 'Recorded set saved with metrics.');
        }
      } catch (error) {
        console.error('[ScanARKit] Upload recorded video failed', error);
        Alert.alert('Upload failed', error instanceof Error ? error.message : 'Could not upload recording.');
      } finally {
        setUploading(false);
      }
    }, [detectionMode, latestMetricsForUpload, uploading]);

    const startRecordingVideo = useCallback(async () => {
      if (isRecording) return;
      if (!cameraRef.current) {
        Alert.alert('No camera', 'Camera is not ready to record.');
        return;
      }
      if (!isTracking) {
        Alert.alert('Start tracking first', 'Begin tracking before recording your set.');
        return;
      }
      try {
        setIsRecording(true);
        recordedUriRef.current = null;
        await cameraRef.current.startRecording({
          flash: 'off',
          onRecordingFinished: (video: any) => {
            setIsRecording(false);
            const uri = video?.path || video?.filePath || video?.outputURL || video?.uri;
            if (uri) {
              recordedUriRef.current = uri;
              uploadRecordedVideo(uri);
            } else {
              Alert.alert('Recording failed', 'No file path returned from camera.');
            }
          },
          onRecordingError: (error: any) => {
            console.error('[ScanARKit] Recording error', error);
            setIsRecording(false);
            Alert.alert('Recording error', error?.message || 'Could not record video.');
          },
        });
      } catch (error) {
        console.error('[ScanARKit] Failed to start recording', error);
        setIsRecording(false);
        Alert.alert('Recording error', error instanceof Error ? error.message : 'Could not start recording.');
      }
    }, [isRecording, isTracking, uploadRecordedVideo]);

    const stopRecordingVideo = useCallback(async () => {
      if (!isRecording || !cameraRef.current) return;
      try {
        await cameraRef.current.stopRecording();
      } catch (error) {
        console.error('[ScanARKit] Failed to stop recording', error);
        setIsRecording(false);
        Alert.alert('Recording error', error instanceof Error ? error.message : 'Could not stop recording.');
      }
    }, [isRecording]);

  if (supportStatus === 'unknown') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="time-outline" size={48} color="#9AACD1" />
          <Text style={styles.errorText}>Checking device capabilities...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (supportStatus === 'unsupported') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={60} color="#FF6B6B" />
          <Text style={styles.errorText}>Device not supported</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (supportStatus === 'supported' && !hasPermission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="camera" size={60} color="#4C8CFF" />
          <Text style={styles.errorText}>Camera permission is required</Text>
          <TouchableOpacity style={styles.controlButton} onPress={requestPermission}>
            <Text style={styles.controlButtonText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const showTelemetry = detectionMode === 'pullup' ? (isTracking || repCount > 0) : (isTracking || pushUpReps > 0);
  const telemetryTitle = detectionMode === 'pullup' ? 'Pull-Up Tracker' : 'Push-Up Tracker';
  const telemetryReps = detectionMode === 'pullup' ? repCount : pushUpReps;
  const telemetryPhaseLabel =
    detectionMode === 'pullup'
      ? pullUpPhase === 'idle'
        ? 'Waiting'
        : pullUpPhase === 'hang'
        ? 'Hang'
        : pullUpPhase === 'pull'
        ? 'Pull'
        : 'Top'
      : pushUpPhase === 'setup'
      ? 'Setup'
      : pushUpPhase === 'plank'
      ? 'Plank'
      : pushUpPhase === 'lowering'
      ? 'Lowering'
      : pushUpPhase === 'bottom'
      ? 'Bottom'
      : 'Press';
  const telemetryElbow =
    detectionMode === 'pullup'
      ? pullUpMetrics?.armsTracked
        ? `${pullUpMetrics.avgElbow.toFixed(1)}°`
        : '--'
      : pushUpMetrics?.armsTracked
      ? `${pushUpMetrics.avgElbow.toFixed(1)}°`
      : '--';
  const telemetrySecondaryLabel = detectionMode === 'pullup' ? 'Avg Shoulder' : 'Hip Drop';
  const telemetrySecondaryValue =
    detectionMode === 'pullup'
      ? pullUpMetrics?.armsTracked
        ? `${pullUpMetrics.avgShoulder.toFixed(1)}°`
        : '--'
      : pushUpMetrics?.hipDrop !== null && pushUpMetrics?.hipDrop !== undefined
      ? `${Math.round(pushUpMetrics.hipDrop * 100)}%`
      : '--';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top, height: 60 + insets.top }]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Form Tracking</Text>
        <TouchableOpacity style={styles.infoButton}>
          <Ionicons name="information-circle-outline" size={24} color="#9AACD1" />
        </TouchableOpacity>
      </View>

      {/* Tracking view */}
      <View style={styles.trackingContainer}>
        {/* VisionCamera preview - show when not tracking OR when front camera is selected (ARKit only supports back) */}
        {device && hasPermission && (!isTracking || cameraPosition === 'front') && (
          <Camera
            style={styles.fullFill}
            ref={cameraRef}
            device={device}
            isActive={true}
            zoom={zoom}
          />
        )}
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

        {/* Mode toggle */}
        <View style={[styles.modeToggle, { top: insets.top + 70 }]}>
          <TouchableOpacity
            onPress={() => setDetectionMode('pullup')}
            style={[styles.modeChip, detectionMode === 'pullup' && styles.modeChipActive]}
          >
            <Ionicons name="barbell-outline" size={16} color={detectionMode === 'pullup' ? '#0B1F3A' : '#9AACD1'} />
            <Text style={[styles.modeChipText, detectionMode === 'pullup' && styles.modeChipTextActive]}>Pull-Ups</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDetectionMode('pushup')}
            style={[styles.modeChip, detectionMode === 'pushup' && styles.modeChipActive]}
          >
            <Ionicons name="duplicate-outline" size={16} color={detectionMode === 'pushup' ? '#0B1F3A' : '#9AACD1'} />
            <Text style={[styles.modeChipText, detectionMode === 'pushup' && styles.modeChipTextActive]}>Push-Ups</Text>
          </TouchableOpacity>
        </View>
        
        {/* Overlay guides */}
        <View
          style={[styles.overlay, { zIndex: 100 }]}
          pointerEvents={isTracking ? 'none' : 'auto'}
          onStartShouldSetResponder={() => !isTracking}
          onLayout={handleOverlayLayout}
          onResponderRelease={async (e) => {
            if (isTracking) return;
            try {
              const { locationX, locationY } = e.nativeEvent;
              const size = overlayLayout.current;
              const width = size?.width && size.width > 0 ? size.width : 1;
              const height = size?.height && size.height > 0 ? size.height : 1;
              const nx = Math.max(0, Math.min(1, locationX / width));
              const ny = Math.max(0, Math.min(1, locationY / height));
              setFocusPoint({ x: locationX, y: locationY });
              setTimeout(() => setFocusPoint(null), 800);
              if (cameraRef.current && typeof cameraRef.current.focus === 'function') {
                await cameraRef.current.focus({ x: nx, y: ny });
              }
              if (cameraRef.current && typeof cameraRef.current.expose === 'function') {
                await cameraRef.current.expose({ x: nx, y: ny });
              }
            } catch (err) {
              if (DEV) console.warn('[ScanARKit] focus/expose not supported:', err);
            }
          }}
        >

          <Animated.View style={[styles.topGuide, { top: insets.top + 140, opacity: textOpacity }]}>
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

          {/* Focus ring */}
          {!isTracking && focusPoint && (
            <View style={[styles.focusRing, { left: focusPoint.x - 20, top: focusPoint.y - 20 }]} />
          )}

          {/* Skeleton Overlay (2D projected) */}
        {smoothedPose2DJoints && smoothedPose2DJoints.length > 0 && (
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
                        strokeWidth="0.008"
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
                    r="0.012"
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
          <View style={[styles.anglesDisplay, { top: insets.top + 130 }]}>
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
            <View style={styles.metricsUploadHint}>
              <Text style={styles.metricsUploadLabel}>Metrics ready for upload</Text>
              <Text style={styles.metricsUploadValue}>
                {latestMetricsForUpload.mode === 'pullup'
                  ? `${latestMetricsForUpload.reps} reps • elbow ${latestMetricsForUpload.avgElbowDeg ? latestMetricsForUpload.avgElbowDeg.toFixed(1) + '°' : '--'}`
                  : `${latestMetricsForUpload.reps} reps • elbow ${latestMetricsForUpload.avgElbowDeg ? latestMetricsForUpload.avgElbowDeg.toFixed(1) + '°' : '--'} • hip drop ${
                      latestMetricsForUpload.hipDropRatio !== null && latestMetricsForUpload.hipDropRatio !== undefined
                        ? `${Math.round(latestMetricsForUpload.hipDropRatio * 100)}%`
                        : '--'
                    }`}
              </Text>
              <Text style={styles.metricsUploadSubtext}>
                Select the set you just recorded to upload it with these metrics attached.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.uploadButton, uploading && styles.uploadButtonDisabled]}
              onPress={handleUploadWithMetrics}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator color="#0B1F3A" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color="#0B1F3A" />
                  <Text style={styles.uploadButtonText}>Upload video with metrics</Text>
                </>
              )}
            </TouchableOpacity>
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

      {/* Camera flip button - show always when tracking or when front camera is selected */}
      {(isTracking || cameraPosition === 'front') && (
        <TouchableOpacity
          style={[styles.cameraFlipButton, { top: insets.top + 130 }]}
          onPress={flipCameraDuringTracking}
          accessibilityRole="button"
          accessibilityLabel="Flip camera"
        >
          <Ionicons
            name="camera-reverse"
            size={24}
            color="#FFFFFF"
          />
        </TouchableOpacity>
      )}

      {/* Audio feedback toggle */}
      <TouchableOpacity
        style={[
          styles.audioToggleButton,
          { top: insets.top + 130 },
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
      <View style={[styles.controls, { bottom: insets.bottom + 16 }]}>
        {/**/}
        <TouchableOpacity
          style={[styles.controlButton, isTracking && styles.stopButton, isTracking && styles.controlButtonSmall]}
          onPress={isTracking ? stopTracking : (supportStatus === 'supported' && hasPermission ? startTracking : requestPermission)}
          disabled={!isTracking && !(supportStatus === 'supported' && hasPermission)}
          >
            <Ionicons
              name={isTracking ? 'stop' : 'play'}
              size={isTracking ? 24 : 32}
              color="#FFFFFF"
            />
            <Text style={styles.controlButtonText}>
              {isTracking ? 'Stop' : 'Start'} Tracking
            </Text>
          </TouchableOpacity>

        {isTracking && (
          <TouchableOpacity
            style={[
              styles.controlButton,
              styles.recordButton,
              isRecording && styles.recordButtonActive
            ]}
            onPress={isRecording ? stopRecordingVideo : startRecordingVideo}
          >
            <Ionicons
              name={isRecording ? 'stop-circle' : 'radio-button-on'}
              size={isRecording ? 22 : 20}
              color="#FFFFFF"
            />
            <Text style={styles.controlButtonText}>
              {isRecording ? 'Stop Recording' : 'Record Set'}
            </Text>
          </TouchableOpacity>
        )}

        {!isTracking && (
          <TouchableOpacity
            style={[styles.controlButton, styles.secondaryButton]}
            onPress={toggleCamera}
          >
            <Ionicons
              name="swap-horizontal"
              size={28}
              color="#FFFFFF"
            />
            <Text style={styles.controlButtonText}>
              {cameraPosition === 'back' ? 'Front Camera' : 'Back Camera'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Zoom Controls (only when camera preview shown) */}
        {!isTracking && (
          <View style={styles.zoomControls}>
            <TouchableOpacity style={[styles.zoomButton, styles.zoomButtonLeft]} onPress={() => stepZoom(-0.2)}>
              <Text style={styles.zoomButtonText}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.zoomButton, styles.zoomButtonRight]} onPress={() => stepZoom(+0.2)}>
              <Text style={styles.zoomButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Status badge */}
      <View style={[styles.statusBadge, { top: insets.top + 70 }]}>
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
</View>
  );
}

