import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform, Alert, Animated, PanResponder, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { Svg, Circle, Line } from 'react-native-svg';
import { runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

type CameraPosition = 'front' | 'back';

interface BodyPose {
  joints: { x: number; y: number; z?: number; confidence: number; name: string }[];
  is3D?: boolean;
  detectionQuality?: number;
  timestamp?: number;
}

export default function ScanScreen() {
  const router = useRouter();
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const [isActive] = useState(true);
  const [bodyPose, setBodyPose] = useState<BodyPose | null>(null);
  const [detectionQuality, setDetectionQuality] = useState<number>(0);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [capturePressed, setCapturePressed] = useState(false);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{x: number, y: number} | null>(null);
  const camera = useRef<Camera>(null);
  const textOpacity = useRef(new Animated.Value(1)).current;
  const captureScale = useRef(new Animated.Value(1)).current;
  const settingsOpacity = useRef(new Animated.Value(0)).current;
  const zoomIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const focusOpacity = useRef(new Animated.Value(0)).current;
  
  // Zoom slider pan responder
  const zoomPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        if (Platform.OS === 'ios') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        setShowZoomIndicator(true);
        Animated.timing(zoomIndicatorOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderMove: (_, gestureState) => {
        const screenWidth = Dimensions.get('window').width;
        const sliderWidth = screenWidth - 120; // Account for padding
        const progress = Math.max(0, Math.min(1, gestureState.moveX / sliderWidth));
        const newZoom = 1 + (progress * 3); // 1x to 4x zoom
        setZoomLevel(newZoom);
      },
      onPanResponderRelease: () => {
        Animated.timing(zoomIndicatorOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setShowZoomIndicator(false);
        });
      },
    })
  ).current;
  
  // Tap to focus functionality
  const handleCameraTap = (event: any) => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    const { locationX, locationY } = event.nativeEvent;
    setFocusPoint({ x: locationX, y: locationY });
    
    // Animate focus indicator
    focusOpacity.setValue(1);
    Animated.timing(focusOpacity, {
      toValue: 0,
      duration: 1000,
      useNativeDriver: true,
    }).start(() => {
      setFocusPoint(null);
    });
  };
  
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(cameraPosition);

  useEffect(() => {
    // Request permission on mount if not granted
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const toggleCamera = () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setCameraPosition((prev) => (prev === 'back' ? 'front' : 'back'));
  };

  const toggleFlash = () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setFlashEnabled((prev) => !prev);
  };

  const toggleSettings = () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const newShowSettings = !showSettings;
    setShowSettings(newShowSettings);
    
    Animated.timing(settingsOpacity, {
      toValue: newShowSettings ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  // Update body pose from frame processor
  const updatePose = (pose: BodyPose | null) => {
    setBodyPose(pose);
  };

  // Real-time Apple Vision body pose tracking
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    try {
      // Try to call the native pose detection
      // @ts-ignore
      const result = global.__detectPose(frame, {
        isFrontCamera: cameraPosition === 'front'
      });
      
      if (result && result.joints && Array.isArray(result.joints) && result.joints.length > 0) {
        runOnJS(updatePose)({
          joints: result.joints,
          is3D: result.is3D,
          detectionQuality: result.detectionQuality,
          timestamp: result.timestamp
        });
        
        if (result.detectionQuality) {
          runOnJS(setDetectionQuality)(result.detectionQuality);
        }
      }
    } catch (error) {
      // Plugin not available - this is expected in development
      console.log('Pose detection plugin not available:', error);
    }
  }, [cameraPosition]);
  
  // Fallback: Show demo skeleton for testing when native module isn't available
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!bodyPose) {
        console.log('Showing demo skeleton - native pose detection not available');
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
          is3D: false,
          detectionQuality: 0.7,
          timestamp: Date.now()
        };
        setBodyPose(demoSkeletonPose);
        setDetectionQuality(0.7);
      }
    }, 2000); // Reduced timeout to 2 seconds
    
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
    if (camera.current && !capturePressed) {
      setCapturePressed(true);
      
      // Haptic feedback
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
      
      // Capture button animation
      Animated.sequence([
        Animated.timing(captureScale, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(captureScale, {
          toValue: 1.1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(captureScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
      
      try {
        const photo = await camera.current.takePhoto({
          flash: flashEnabled ? 'on' : 'off',
        });
        console.log('Photo captured:', photo.path);
        Alert.alert('Photo Captured', `Saved to: ${photo.path}`);
      } catch (error) {
        console.error('Failed to capture photo:', error);
        Alert.alert('Error', 'Failed to capture photo');
      } finally {
        setCapturePressed(false);
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
          enableZoomGesture={true}
          enablePortraitEffectsMatteDelivery={true}
        />
        
        {/* Tap to focus overlay */}
        <TouchableOpacity 
          style={StyleSheet.absoluteFill} 
          activeOpacity={1} 
          onPress={handleCameraTap}
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
              {bodyPose ? (
                bodyPose.is3D ? '3D Skeleton Active' : '2D Skeleton Active'
              ) : '3D skeleton tracking active'}
            </Text>
            {bodyPose && detectionQuality > 0 && (
              <View style={styles.qualityIndicator}>
                <View style={[styles.qualityBar, { width: `${detectionQuality * 100}%` }]} />
              </View>
            )}
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
        
        {/* Zoom indicator overlay */}
        {showZoomIndicator && (
          <Animated.View style={[styles.zoomIndicator, { opacity: zoomIndicatorOpacity }]}>
            <Text style={styles.zoomIndicatorText}>{zoomLevel.toFixed(1)}x</Text>
          </Animated.View>
        )}
        
        {/* Focus indicator overlay */}
        {focusPoint && (
          <Animated.View 
            style={[
              styles.focusIndicator, 
              { 
                left: focusPoint.x - 30, 
                top: focusPoint.y - 30,
                opacity: focusOpacity 
              }
            ]}
          >
            <View style={styles.focusRing} />
          </Animated.View>
        )}
      </View>

      {/* Bottom controls - positioned absolutely for full screen */}
      <View style={styles.controls}>
        {/* Left side controls */}
        <View style={styles.leftControls}>
          <TouchableOpacity style={styles.controlButton} onPress={toggleCamera}>
            <Ionicons name="camera-reverse-outline" size={28} color="#F5F7FF" />
          </TouchableOpacity>
          
          {cameraPosition === 'back' && (
            <TouchableOpacity 
              style={[styles.controlButton, flashEnabled && styles.activeControlButton]} 
              onPress={toggleFlash}
            >
              <Ionicons 
                name={flashEnabled ? "flash" : "flash-off-outline"} 
                size={28} 
                color={flashEnabled ? "#FFD700" : "#F5F7FF"} 
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Center capture button */}
        <Animated.View style={[styles.captureButtonContainer, { transform: [{ scale: captureScale }] }]}>
          <TouchableOpacity style={styles.captureButton} onPress={handleCapture} disabled={capturePressed}>
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        </Animated.View>

        {/* Right side controls */}
        <View style={styles.rightControls}>
          <TouchableOpacity 
            style={[styles.controlButton, zoomLevel > 1 && styles.activeControlButton]} 
            onPress={() => {
              if (Platform.OS === 'ios') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              setZoomLevel(zoomLevel === 1 ? 2 : 1);
            }}
          >
            <Text style={[styles.zoomButtonText, zoomLevel > 1 && styles.zoomButtonTextActive]}>
              {zoomLevel === 1 ? '2x' : '1x'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.controlButton} onPress={toggleSettings}>
            <Ionicons name="settings-outline" size={28} color="#F5F7FF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Settings panel */}
      <Animated.View style={[styles.settingsPanel, { opacity: settingsOpacity }]} pointerEvents={showSettings ? 'auto' : 'none'}>
        <View style={styles.settingsContent}>
          <Text style={styles.settingsTitle}>Camera Settings</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Zoom Level</Text>
            <View style={styles.zoomSlider}>
              <View style={styles.zoomTrack} {...zoomPanResponder.panHandlers}>
                <View style={[styles.zoomFill, { width: `${(zoomLevel - 1) * 100 / 3}%` }]} />
                <View style={[styles.zoomThumb, { left: `${(zoomLevel - 1) * 100 / 3}%` }]} />
              </View>
              <Text style={styles.zoomValue}>{zoomLevel.toFixed(1)}x</Text>
            </View>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Flash</Text>
            <TouchableOpacity 
              style={[styles.settingToggle, flashEnabled && styles.settingToggleActive]} 
              onPress={toggleFlash}
            >
              <Text style={[styles.settingToggleText, flashEnabled && styles.settingToggleTextActive]}>
                {flashEnabled ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Camera</Text>
            <TouchableOpacity style={styles.settingToggle} onPress={toggleCamera}>
              <Text style={styles.settingToggleText}>
                {cameraPosition === 'front' ? 'FRONT' : 'BACK'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

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
  qualityIndicator: {
    width: 100,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  qualityBar: {
    height: '100%',
    backgroundColor: '#3CC8A9',
    borderRadius: 2,
  },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    zIndex: 10,
  },
  leftControls: {
    flexDirection: 'row',
    gap: 12,
  },
  rightControls: {
    flexDirection: 'row',
    gap: 12,
  },
  controlButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 35, 57, 0.9)',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  activeControlButton: {
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    borderColor: '#FFD700',
  },
  captureButtonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#4C8CFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#F5F7FF',
    shadowColor: '#4C8CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
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
  settingsPanel: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15, 35, 57, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1B2E4A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  settingsContent: {
    padding: 20,
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F7FF',
    marginBottom: 16,
    textAlign: 'center',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F7FF',
    flex: 1,
  },
  zoomSlider: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16,
  },
  zoomTrack: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    position: 'relative',
  },
  zoomFill: {
    height: '100%',
    backgroundColor: '#4C8CFF',
    borderRadius: 2,
  },
  zoomThumb: {
    position: 'absolute',
    top: -6,
    width: 16,
    height: 16,
    backgroundColor: '#4C8CFF',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#F5F7FF',
    marginLeft: -8,
  },
  zoomValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4C8CFF',
    marginLeft: 12,
    minWidth: 32,
    textAlign: 'right',
  },
  settingToggle: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginLeft: 16,
  },
  settingToggleActive: {
    backgroundColor: '#4C8CFF',
    borderColor: '#4C8CFF',
  },
  settingToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9AACD1',
  },
  settingToggleTextActive: {
    color: '#FFFFFF',
  },
  zoomIndicator: {
    position: 'absolute',
    top: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomIndicatorText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  zoomButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9AACD1',
  },
  zoomButtonTextActive: {
    color: '#4C8CFF',
  },
  focusIndicator: {
    position: 'absolute',
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#4C8CFF',
    backgroundColor: 'transparent',
  },
});
