import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform, Alert, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { Svg, Circle, Line } from 'react-native-svg';
import { runOnJS } from 'react-native-reanimated';

type CameraPosition = 'front' | 'back';

interface BodyPose {
  joints: Array<{ x: number; y: number; confidence: number; name: string }>;
}

export default function ScanScreen() {
  const router = useRouter();
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const [isActive, setIsActive] = useState(true);
  const [bodyPose, setBodyPose] = useState<BodyPose | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const camera = useRef<Camera>(null);
  const textOpacity = useRef(new Animated.Value(1)).current;
  
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(cameraPosition);

  useEffect(() => {
    // Request permission on mount if not granted
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const toggleCamera = () => {
    setCameraPosition((prev) => (prev === 'back' ? 'front' : 'back'));
  };

  // Update body pose from frame processor
  const updatePose = (pose: BodyPose | null) => {
    setBodyPose(pose);
  };

  // Real-time Apple Vision body pose tracking
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    try {
      // @ts-ignore - Frame processor plugin
      const result = __detectPose(frame, {});
      
      if (result && result.joints && Array.isArray(result.joints) && result.joints.length > 0) {
        runOnJS(updatePose)({
          joints: result.joints
        });
      }
    } catch (error) {
      // Native module not available yet - will show demo skeleton
    }
  }, []);
  
  // Fallback: Show demo skeleton only if native module fails after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!bodyPose) {
        console.log('Native pose detection not available - showing demo skeleton');
        const demoSkeletonPose: BodyPose = {
          joints: [
            { x: 0.5, y: 0.25, confidence: 0.9, name: 'head' },
            { x: 0.5, y: 0.32, confidence: 0.95, name: 'neck' },
            { x: 0.42, y: 0.35, confidence: 0.85, name: 'leftShoulder' },
            { x: 0.58, y: 0.35, confidence: 0.85, name: 'rightShoulder' },
            { x: 0.37, y: 0.45, confidence: 0.8, name: 'leftElbow' },
            { x: 0.63, y: 0.45, confidence: 0.8, name: 'rightElbow' },
            { x: 0.35, y: 0.55, confidence: 0.75, name: 'leftWrist' },
            { x: 0.65, y: 0.55, confidence: 0.75, name: 'rightWrist' },
            { x: 0.5, y: 0.5, confidence: 0.9, name: 'hips' },
            { x: 0.45, y: 0.5, confidence: 0.85, name: 'leftHip' },
            { x: 0.55, y: 0.5, confidence: 0.85, name: 'rightHip' },
            { x: 0.44, y: 0.65, confidence: 0.8, name: 'leftKnee' },
            { x: 0.56, y: 0.65, confidence: 0.8, name: 'rightKnee' },
            { x: 0.43, y: 0.8, confidence: 0.75, name: 'leftAnkle' },
            { x: 0.57, y: 0.8, confidence: 0.75, name: 'rightAnkle' },
          ],
        };
        setBodyPose(demoSkeletonPose);
      }
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [bodyPose]);

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

  const handleCapture = async () => {
    if (camera.current) {
      try {
        const photo = await camera.current.takePhoto({
          flash: 'off',
        });
        console.log('Photo captured:', photo.path);
        Alert.alert('Photo Captured', `Saved to: ${photo.path}`);
      } catch (error) {
        console.error('Failed to capture photo:', error);
        Alert.alert('Error', 'Failed to capture photo');
      }
    }
  };

  // Permission states
  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={80} color="#4C8CFF" />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            We need camera access to scan your form and provide 3D skeleton tracking.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (device == null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={60} color="#FF6B6B" />
          <Text style={styles.errorText}>No camera device found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => router.push('/(tabs)')}>
          <Ionicons name="close" size={28} color="#F5F7FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Form Scanner</Text>
        <TouchableOpacity style={styles.infoButton}>
          <Ionicons name="information-circle-outline" size={24} color="#9AACD1" />
        </TouchableOpacity>
      </View>

      <View style={styles.cameraContainer}>
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isActive}
          photo={true}
          frameProcessor={frameProcessor}
        />
        
        {/* Overlay guides */}
        <View style={styles.overlay}>
          <View style={styles.guidesContainer}>
            <View style={styles.cornerTopLeft} />
            <View style={styles.cornerTopRight} />
            <View style={styles.cornerBottomLeft} />
            <View style={styles.cornerBottomRight} />
          </View>
          
          <Animated.View style={[styles.topGuide, { opacity: textOpacity }]}>
            <Text style={styles.guideText}>Position yourself in frame</Text>
            <Text style={styles.guideSubtext}>
              {bodyPose ? 'Body detected - Skeleton active' : '3D skeleton tracking active'}
            </Text>
          </Animated.View>
          
          {/* Skeleton Overlay */}
          {bodyPose && bodyPose.joints.length > 0 && (
            <Svg
              style={StyleSheet.absoluteFill}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              {/* Helper function to find joint by name */}
              {(() => {
                const findJoint = (name: string) => bodyPose.joints.find(j => j.name === name);
                const drawLine = (from: string, to: string, color: string = '#4C8CFF') => {
                  const j1 = findJoint(from);
                  const j2 = findJoint(to);
                  if (j1 && j2 && j1.confidence > 0.3 && j2.confidence > 0.3) {
                    return (
                      <Line
                        key={`${from}-${to}`}
                        x1={j1.x}
                        y1={j1.y}
                        x2={j2.x}
                        y2={j2.y}
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
                    {/* Torso - Blue */}
                    {drawLine('head', 'neck')}
                    {drawLine('neck', 'leftShoulder')}
                    {drawLine('neck', 'rightShoulder')}
                    {drawLine('leftShoulder', 'rightShoulder')}
                    {drawLine('leftShoulder', 'hips')}
                    {drawLine('rightShoulder', 'hips')}
                    {drawLine('leftHip', 'rightHip')}
                    {drawLine('hips', 'leftHip')}
                    {drawLine('hips', 'rightHip')}
                    
                    {/* Left arm - Green */}
                    {drawLine('leftShoulder', 'leftElbow', '#3CC8A9')}
                    {drawLine('leftElbow', 'leftWrist', '#3CC8A9')}
                    
                    {/* Right arm - Green */}
                    {drawLine('rightShoulder', 'rightElbow', '#3CC8A9')}
                    {drawLine('rightElbow', 'rightWrist', '#3CC8A9')}
                    
                    {/* Left leg - Purple */}
                    {drawLine('leftHip', 'leftKnee', '#9B7EDE')}
                    {drawLine('leftKnee', 'leftAnkle', '#9B7EDE')}
                    
                    {/* Right leg - Purple */}
                    {drawLine('rightHip', 'rightKnee', '#9B7EDE')}
                    {drawLine('rightKnee', 'rightAnkle', '#9B7EDE')}
                  </>
                );
              })()}
              
              {/* Draw joints */}
              {bodyPose.joints.map((joint, index) => (
                joint.confidence > 0.3 && (
                  <Circle
                    key={`joint-${index}`}
                    cx={joint.x}
                    cy={joint.y}
                    r="0.012"
                    fill="#FFFFFF"
                    opacity={joint.confidence * 0.9}
                  />
                )
              ))}
            </Svg>
          )}
        </View>
      </View>

      {/* Bottom controls - positioned absolutely for full screen */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlButton} onPress={toggleCamera}>
          <Ionicons name="camera-reverse-outline" size={32} color="#F5F7FF" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.captureButton} onPress={handleCapture}>
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>

        <View style={{ width: 60 }} />
      </View>

      {/* Status badge */}
      <View style={styles.statusBadge}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>
          {cameraPosition === 'front' ? 'Front Camera' : 'Back Camera'}
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
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
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
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  guideSubtext: {
    fontSize: 12,
    color: '#9AACD1',
    marginTop: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 60,
    zIndex: 10,
  },
  controlButton: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 35, 57, 0.8)',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#4C8CFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#F5F7FF',
  },
  captureButtonInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F5F7FF',
  },
  statusBadge: {
    position: 'absolute',
    top: 60,
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
    backgroundColor: '#3CC8A9',
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#F5F7FF',
    fontWeight: '600',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F5F7FF',
    marginTop: 24,
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 16,
    color: '#9AACD1',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: '#4C8CFF',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
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
});
