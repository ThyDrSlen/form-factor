import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform, Animated } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Svg, Circle, Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

// Import ARKit module - Metro auto-resolves to .ios.ts or .web.ts
import { BodyTracker, useBodyTracking, type JointAngles, type Joint2D } from '@/lib/arkit/ARKitBodyTracker';

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
      smoothedAnglesRef.current = null;
      setFps(0);
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
        setJointAngles(next);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose]);

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

  // Start tracking
  const startTracking = useCallback(async () => {
    if (DEV) console.log('[ScanARKit] 🎬 Starting tracking...');
    try {
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
  }, [startNativeTracking]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (DEV) console.log('[ScanARKit] ⏸️ Stopping tracking...');
    
    try {
      stopNativeTracking();
      frameStatsRef.current = { lastTimestamp: 0, frameCount: 0 };
      setJointAngles(null);
      setFps(0);
      
      if (DEV) console.log('[ScanARKit] ✅ Tracking stopped');

      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (error) {
      console.error('[ScanARKit] ❌ Error stopping tracking:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopNativeTracking]);

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

    const feedback: string[] = [];

    // Check squat depth
    const avgKneeAngle = (jointAngles.leftKnee + jointAngles.rightKnee) / 2;
    if (avgKneeAngle > 90) {
      feedback.push('⚠️ Go deeper - aim for 90° or below');
    } else if (avgKneeAngle < 70) {
      feedback.push('✅ Great squat depth!');
    }

    // Check symmetry
    const kneeSymmetry = BodyTracker.checkSymmetry(
      jointAngles.leftKnee,
      jointAngles.rightKnee,
      10
    );
    if (!kneeSymmetry) {
      feedback.push('⚠️ Keep knees aligned');
    }

    // Check elbow position
    const avgElbowAngle = (jointAngles.leftElbow + jointAngles.rightElbow) / 2;
    if (avgElbowAngle < 160 && avgElbowAngle > 0) {
      feedback.push('💪 Arms engaged');
    }

    return feedback.length > 0 ? feedback : ['👍 Good form!'];
  }, [jointAngles]);

  const feedback = analyzeForm();

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

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { top: Math.max(0, insets.top - 48) }]}>
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
            style={StyleSheet.absoluteFill}
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
              StyleSheet.absoluteFill,
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
          onResponderRelease={async (e) => {
            if (isTracking) return;
            try {
              const { locationX, locationY } = e.nativeEvent;
              const view = e.target as any;
              // Fallback: compute normalized using layout if available
              const nx = Math.max(0, Math.min(1, (locationX) / (view?.width ?? 1)));
              const ny = Math.max(0, Math.min(1, (locationY) / (view?.height ?? 1)));
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

          <Animated.View style={[styles.topGuide, { opacity: textOpacity }]}>
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
          {pose2D && pose2D.joints.length > 0 && (
            <Svg
              style={StyleSheet.absoluteFill}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              pointerEvents="none"
            >
              {(() => {
                const findJoint2D = (name: string) => {
                  // Try exact match first, then partial match
                  const exactMatch = pose2D.joints.find(
                    (j: Joint2D) => j.isTracked && j.name.toLowerCase() === name.toLowerCase()
                  );
                  if (exactMatch) return exactMatch;
                  
                  // Try partial match (for joint names with/without _joint suffix)
                  return pose2D.joints.find(
                    (j: Joint2D) => j.isTracked && (
                      j.name.toLowerCase().includes(name.toLowerCase()) ||
                      name.toLowerCase().includes(j.name.toLowerCase().replace('_joint', ''))
                    )
                  );
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
              {pose2D.joints.map((joint: Joint2D, index: number) => {
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

        {/* Joint angles display */}
        {jointAngles && (
          <View style={styles.anglesDisplay}>
            <Text style={styles.anglesTitle}>Joint Angles</Text>
            <View style={styles.anglesGrid}>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>Left Knee</Text>
                <Text style={styles.angleValue}>{jointAngles.leftKnee.toFixed(1)}°</Text>
              </View>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>Right Knee</Text>
                <Text style={styles.angleValue}>{jointAngles.rightKnee.toFixed(1)}°</Text>
              </View>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>Left Elbow</Text>
                <Text style={styles.angleValue}>{jointAngles.leftElbow.toFixed(1)}°</Text>
              </View>
              <View style={styles.angleItem}>
                <Text style={styles.angleLabel}>Right Elbow</Text>
                <Text style={styles.angleValue}>{jointAngles.rightElbow.toFixed(1)}°</Text>
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

      {/* Camera flip button - show always when tracking or when front camera is selected */}
      {(isTracking || cameraPosition === 'front') && (
        <TouchableOpacity
          style={styles.cameraFlipButton}
          onPress={flipCameraDuringTracking}
        >
          <Ionicons
            name="camera-reverse"
            size={24}
            color="#FFFFFF"
          />
        </TouchableOpacity>
      )}

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
      <View style={[styles.statusBadge, { top: Math.max(8, insets.top + 8) }]}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050E1F',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 10,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F7FF',
  },
  infoButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  trackingContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  focusRing: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
    opacity: 0.8,
  },
  topGuide: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  guideText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
  },
  guideSubtext: {
    fontSize: 12,
    color: '#9AACD1',
    marginTop: 4,
  },
  qualityIndicator: {
    width: 100,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  qualityBar: {
    width: '100%',
    height: '100%',
    backgroundColor: '#3CC8A9',
    borderRadius: 2,
  },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 10,
  },
  zoomControls: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    gap: 8,
  },
  zoomButton: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 35, 57, 0.9)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    ...Platform.select({
      web: { boxShadow: '0 2px 6px rgba(0,0,0,0.3)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 4,
      },
    }),
  },
  zoomButtonLeft: {},
  zoomButtonRight: {},
  zoomButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4C8CFF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 28,
    gap: 12,
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 8px rgba(76, 140, 255, 0.4)',
      },
      default: {
        shadowColor: '#4C8CFF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 8,
      },
    }),
  },
  controlButtonSmall: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  stopButton: {
    backgroundColor: '#FF6B6B',
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 8px rgba(255, 107, 107, 0.4)',
      },
      default: {
        shadowColor: '#FF6B6B',
      },
    }),
  },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: 'rgba(15, 35, 57, 0.9)',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  disabledButton: {
    opacity: 0.6,
    borderColor: '#2A3F5A',
  },
  cameraFlipButton: {
    position: 'absolute',
    top: 120,
    right: 16,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 35, 57, 0.9)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    zIndex: 100,
    ...Platform.select({
      web: {
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 10,
      },
    }),
  },
  controlButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statusBadge: {
    position: 'absolute',
    top: 100,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 35, 57, 0.9)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    zIndex: 11,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9AACD1',
    marginRight: 6,
  },
  statusDotActive: {
    backgroundColor: '#3CC8A9',
  },
  statusText: {
    fontSize: 12,
    color: '#F5F7FF',
    fontWeight: '600',
  },
  statusSubtext: {
    fontSize: 10,
    color: '#9AACD1',
    marginTop: 2,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    color: '#FF6B6B',
    marginTop: 16,
    textAlign: 'center',
  },
  anglesDisplay: {
    position: 'absolute',
    top: 150,
    left: 16,
    backgroundColor: 'rgba(15, 35, 57, 0.9)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  anglesTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F5F7FF',
    marginBottom: 8,
  },
  anglesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  angleItem: {
    minWidth: 80,
  },
  angleLabel: {
    fontSize: 10,
    color: '#9AACD1',
    marginBottom: 2,
  },
  angleValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4C8CFF',
  },
  feedbackContainer: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15, 35, 57, 0.9)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  feedbackText: {
    fontSize: 14,
    color: '#F5F7FF',
    marginBottom: 4,
    lineHeight: 20,
  },
});
