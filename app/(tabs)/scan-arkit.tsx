import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform, Alert, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Svg, Circle, Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

// Lazy load to prevent crash before prebuild
let BodyTracker: any;
try {
  const module = require('@/lib/arkit/ARKitBodyTracker');
  BodyTracker = module.BodyTracker;
} catch (error) {
  console.log('ARKit module not available yet - run prebuild');
}

// Type definitions (will be replaced by real types after prebuild)
type BodyPose = {
  joints: any[];
  timestamp: number;
  isTracking: boolean;
  estimatedHeight?: number;
} | null;

type JointAngles = {
  leftKnee: number;
  rightKnee: number;
  leftElbow: number;
  rightElbow: number;
  leftHip: number;
  rightHip: number;
  leftShoulder: number;
  rightShoulder: number;
} | null;

export default function ScanARKitScreen() {
  const router = useRouter();
  const [isSupported, setIsSupported] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [bodyPose, setBodyPose] = useState<BodyPose>(null);
  const [jointAngles, setJointAngles] = useState<JointAngles>(null);
  const [fps, setFps] = useState(0);
  const textOpacity = React.useRef(new Animated.Value(1)).current;
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  // Check support on mount
  useEffect(() => {
    if (!BodyTracker) {
      Alert.alert(
        'Module Not Ready',
        'ARKit module needs to be built. Run: npx expo prebuild --platform ios --clean',
        [{ text: 'OK', onPress: () => router.back() }]
      );
      return;
    }
    
    const supported = BodyTracker.isSupported();
    setIsSupported(supported);
    
    if (!supported) {
      Alert.alert(
        'Device Not Supported',
        'ARKit body tracking requires iPhone XS or newer with A12 Bionic chip or later.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    }
  }, [router]);

  // Start tracking
  const startTracking = useCallback(async () => {
    try {
      await BodyTracker.startTracking();
      setIsTracking(true);

      if (Platform.OS === 'ios') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Poll for poses at 30fps
      let frameCount = 0;
      const startTime = Date.now();
      
      intervalRef.current = setInterval(() => {
        const currentPose = BodyTracker.getCurrentPose();
        
        if (currentPose) {
          setBodyPose(currentPose);
          
          // Calculate joint angles for form analysis
          const angles = BodyTracker.calculateAllAngles(currentPose);
          if (angles) {
            setJointAngles(angles);
          }
          
          // Calculate FPS
          frameCount++;
          const elapsed = (Date.now() - startTime) / 1000;
          if (elapsed > 0) {
            setFps(Math.round(frameCount / elapsed));
          }
        }
      }, 1000 / 30); // 30fps
    } catch (error) {
      console.error('Failed to start tracking:', error);
      Alert.alert('Error', 'Failed to start body tracking');
    }
  }, []);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    BodyTracker.stopTracking();
    setIsTracking(false);
    setBodyPose(null);
    setJointAngles(null);
    setFps(0);

    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

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

  if (!isSupported) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={60} color="#FF6B6B" />
          <Text style={styles.errorText}>Device not supported</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ARKit Body Tracking</Text>
        <TouchableOpacity style={styles.infoButton}>
          <Ionicons name="information-circle-outline" size={24} color="#9AACD1" />
        </TouchableOpacity>
      </View>

      {/* Tracking view */}
      <View style={styles.trackingContainer}>
        {/* Overlay guides */}
        <View style={styles.overlay}>
          <View style={styles.guidesContainer}>
            <View style={styles.cornerTopLeft} />
            <View style={styles.cornerTopRight} />
            <View style={styles.cornerBottomLeft} />
            <View style={styles.cornerBottomRight} />
          </View>

          <Animated.View style={[styles.topGuide, { opacity: textOpacity }]}>
            <Text style={styles.guideText}>
              {isTracking ? 'Tracking Active' : 'Press Start to Begin'}
            </Text>
            <Text style={styles.guideSubtext}>
              Real-world 3D joint tracking • {fps} FPS
            </Text>
            {bodyPose && (
              <View style={styles.qualityIndicator}>
                <View style={styles.qualityBar} />
              </View>
            )}
          </Animated.View>

          {/* Skeleton Overlay */}
          {bodyPose && bodyPose.joints.length > 0 && (
            <Svg
              style={StyleSheet.absoluteFill}
              viewBox="0 0 1 1"
              preserveAspectRatio="xMidYMid meet"
            >
              {(() => {
                const findJoint = (name: string) =>
                  BodyTracker.findJoint(bodyPose, name);

                const drawLine = (from: string, to: string, color: string = '#4C8CFF') => {
                  const j1 = findJoint(from);
                  const j2 = findJoint(to);
                  if (j1 && j2 && j1.isTracked && j2.isTracked) {
                    // Convert from world space to screen space
                    // Normalize positions for display
                    const x1 = 0.5 + j1.x / 2;
                    const y1 = 0.5 - j1.y / 2;
                    const x2 = 0.5 + j2.x / 2;
                    const y2 = 0.5 - j2.y / 2;

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
                      />
                    );
                  }
                  return null;
                };

                return (
                  <>
                    {/* Spine */}
                    {drawLine('hips_joint', 'spine_4')}
                    {drawLine('spine_4', 'neck_1')}
                    {drawLine('neck_1', 'head')}

                    {/* Left arm */}
                    {drawLine('neck_1', 'left_shoulder', '#3CC8A9')}
                    {drawLine('left_shoulder', 'left_arm', '#3CC8A9')}
                    {drawLine('left_arm', 'left_forearm', '#3CC8A9')}
                    {drawLine('left_forearm', 'left_hand', '#3CC8A9')}

                    {/* Right arm */}
                    {drawLine('neck_1', 'right_shoulder', '#3CC8A9')}
                    {drawLine('right_shoulder', 'right_arm', '#3CC8A9')}
                    {drawLine('right_arm', 'right_forearm', '#3CC8A9')}
                    {drawLine('right_forearm', 'right_hand', '#3CC8A9')}

                    {/* Left leg */}
                    {drawLine('hips_joint', 'left_upLeg', '#9B7EDE')}
                    {drawLine('left_upLeg', 'left_leg', '#9B7EDE')}
                    {drawLine('left_leg', 'left_foot', '#9B7EDE')}

                    {/* Right leg */}
                    {drawLine('hips_joint', 'right_upLeg', '#9B7EDE')}
                    {drawLine('right_upLeg', 'right_leg', '#9B7EDE')}
                    {drawLine('right_leg', 'right_foot', '#9B7EDE')}
                  </>
                );
              })()}

              {/* Draw joints */}
              {bodyPose.joints.map((joint, index) => {
                if (!joint.isTracked) return null;
                const x = 0.5 + joint.x / 2;
                const y = 0.5 - joint.y / 2;
                return (
                  <Circle
                    key={`joint-${index}`}
                    cx={x}
                    cy={y}
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

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlButton, isTracking && styles.stopButton]}
          onPress={isTracking ? stopTracking : startTracking}
        >
          <Ionicons
            name={isTracking ? 'stop' : 'play'}
            size={32}
            color="#FFFFFF"
          />
          <Text style={styles.controlButtonText}>
            {isTracking ? 'Stop' : 'Start'} Tracking
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status badge */}
      <View style={styles.statusBadge}>
        <View style={[styles.statusDot, isTracking && styles.statusDotActive]} />
        <Text style={styles.statusText}>
          {isTracking ? 'Tracking' : 'Inactive'} • {bodyPose?.joints.length || 0} joints
        </Text>
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
    top: 50,
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
  },
  guidesContainer: {
    width: '80%',
    height: '60%',
    position: 'relative',
  },
  cornerTopLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 40,
    height: 40,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#4C8CFF',
    borderRadius: 4,
  },
  cornerTopRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 40,
    height: 40,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: '#4C8CFF',
    borderRadius: 4,
  },
  cornerBottomLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 40,
    height: 40,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#4C8CFF',
    borderRadius: 4,
  },
  cornerBottomRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: '#4C8CFF',
    borderRadius: 4,
  },
  topGuide: {
    position: 'absolute',
    top: 100,
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
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4C8CFF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 28,
    gap: 12,
    shadowColor: '#4C8CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  stopButton: {
    backgroundColor: '#FF6B6B',
    shadowColor: '#FF6B6B',
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
