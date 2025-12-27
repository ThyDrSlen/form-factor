/**
 * iOS implementation of ARKit Body Tracking
 *
 * For web stub, see ARKitBodyTracker.web.ts
 */
import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

// Load native module safely (don't throw during import)
// NOTE: Logging is enabled in ALL builds to diagnose Release issues
let ARKitBodyTracker: any = null;
try {
  console.log('[ARKitBodyTracker] Attempting to load native module...');
  ARKitBodyTracker = requireNativeModule('ARKitBodyTracker');
  console.log('[ARKitBodyTracker] Native module loaded:', !!ARKitBodyTracker);
  if (ARKitBodyTracker) {
    console.log('[ARKitBodyTracker] Module methods:', Object.keys(ARKitBodyTracker));
  }
} catch (e) {
  // Log in ALL builds so we can diagnose Release issues
  console.error('[ARKitBodyTracker] FAILED to load native module:', e);
  console.error('[ARKitBodyTracker] This will cause "Device not supported" error!');
  console.error('[ARKitBodyTracker] Fix: Run `npx expo prebuild --clean --platform ios`');
}

/**
 * Represents a 3D joint position in world space (meters)
 */
export interface Joint3D {
  name: string;
  x: number; // Meters in world space
  y: number; // Meters in world space
  z: number; // Meters in world space
  isTracked: boolean;
}

/**
 * Complete body pose with all tracked joints
 */
export interface BodyPose {
  joints: Joint3D[];
  timestamp: number;
  isTracking: boolean;
  estimatedHeight?: number;
}

export interface Joint2D {
  name: string;
  x: number;
  y: number;
  isTracked: boolean;
}

export interface BodyPose2D {
  joints: Joint2D[];
  timestamp: number;
  isTracking: boolean;
}

export interface FrameSnapshot {
  frame: string;
  width?: number;
  height?: number;
  orientation?: string;
  mirrored?: boolean;
}

export interface NativeSupportDiagnostics {
  deviceModel: string;
  modelIdentifier: string;
  systemVersion: string;
  arWorldTrackingSupported: boolean;
  arBodyTrackingSupported: boolean;
  formatsCountComputed: boolean;
  supportedVideoFormatsCount?: number;
  bestFormatFps?: number;
  bestFormatResolution?: string;
  automaticImageScaleEstimationEnabled?: boolean;
  automaticSkeletonScaleEstimationEnabled?: boolean;
  workaroundApplied: boolean;
  finalSupported: boolean;
  isMainThread: boolean;
}

/**
 * Joint angles for common body movements
 */
export interface JointAngles {
  leftKnee: number;
  rightKnee: number;
  leftElbow: number;
  rightElbow: number;
  leftHip: number;
  rightHip: number;
  leftShoulder: number;
  rightShoulder: number;
}

/**
 * ARKit Body Tracking API
 * Uses ARBodyTrackingConfiguration for real-world 3D pose tracking
 */
export class BodyTracker {
  static isNativeModuleLoaded(): boolean {
    return !!ARKitBodyTracker;
  }

  /**
   * Check if ARKit body tracking is supported on this device
   * Requires iPhone XS or newer (A12 Bionic chip or later)
   */
  static isSupported(): boolean {
    // Log in ALL builds to diagnose Release issues
    const deviceInfo = `[${Platform.OS}] version: ${Platform.Version}`;
    console.log('[BodyTracker] isSupported() called', deviceInfo);
    console.log('[BodyTracker] ARKitBodyTracker module exists:', !!ARKitBodyTracker);

    if (!ARKitBodyTracker) {
      console.error('[BodyTracker] Native module NOT loaded - returning false');
      console.error('[BodyTracker] This causes "Device not supported" error!');
      console.error('[BodyTracker] Fix: npx expo prebuild --clean --platform ios');
      return false;
    }

    try {
      console.log('[BodyTracker] Calling native isSupported()...');
      const supported = ARKitBodyTracker.isSupported();
      console.log('[BodyTracker] Native isSupported() returned:', supported);
      if (!supported) {
        console.error('[BodyTracker] Native check reported NOT supported. See native logs for device details.');
      }
      return supported;
    } catch (err) {
      console.error('[BodyTracker] Native isSupported() threw error:', err);
      return false;
    }
  }

  static getSupportDiagnostics(): NativeSupportDiagnostics | null {
    if (!ARKitBodyTracker || typeof ARKitBodyTracker.supportDiagnostics !== 'function') {
      return null;
    }
    try {
      return ARKitBodyTracker.supportDiagnostics();
    } catch (err) {
      console.error('[BodyTracker] supportDiagnostics() threw error:', err);
      return null;
    }
  }

  /**
   * Start ARKit body tracking session
   * @throws Error if body tracking is not supported
   */
  static async startTracking(): Promise<void> {
    if (!ARKitBodyTracker) {
      throw new Error('ARKitBodyTracker native module missing. Run `npx expo prebuild --platform ios` and rebuild.');
    }
    await ARKitBodyTracker.startTracking();
  }

  /**
   * Get current body pose with all joint positions
   * @returns Current pose or null if no body is tracked
   */
  static getCurrentPose(): BodyPose | null {
    if (!ARKitBodyTracker) {
      return null;
    }
    return ARKitBodyTracker.getCurrentPose();
  }

  static getCurrentPose2D(): BodyPose2D | null {
    if (!ARKitBodyTracker) {
      return null;
    }
    if (typeof ARKitBodyTracker.getCurrentPose2D !== 'function') {
      return null;
    }
    return ARKitBodyTracker.getCurrentPose2D();
  }

  /**
   * Stop body tracking session
   */
  static stopTracking(): void {
    if (!ARKitBodyTracker) {
      return;
    }
    ARKitBodyTracker.stopTracking();
  }

  /**
   * Start recording the ARKit camera feed while body tracking is running.
   * The recording is handled natively inside the AR session.
   */
  static async startRecording(): Promise<void> {
    if (!ARKitBodyTracker) {
      throw new Error('ARKitBodyTracker native module missing. Run `npx expo prebuild --platform ios` and rebuild.');
    }
    if (typeof ARKitBodyTracker.startRecording !== 'function') {
      throw new Error('ARKit recording is not available on this build. Make sure the native module is up to date.');
    }
    await ARKitBodyTracker.startRecording();
  }

  /**
   * Stop recording and return the local file path of the recorded video, if any.
   */
  static async stopRecording(): Promise<string | null> {
    if (!ARKitBodyTracker || typeof ARKitBodyTracker.stopRecording !== 'function') {
      return null;
    }
    const path: string | null | undefined = await ARKitBodyTracker.stopRecording();
    return path ?? null;
  }

  static async getCurrentFrameSnapshot(options?: { maxWidth?: number; quality?: number }): Promise<FrameSnapshot | null> {
    if (!ARKitBodyTracker || typeof ARKitBodyTracker.getCurrentFrameSnapshot !== 'function') {
      return null;
    }
    try {
      return await ARKitBodyTracker.getCurrentFrameSnapshot(options ?? {});
    } catch (err) {
      console.warn('[BodyTracker] getCurrentFrameSnapshot() failed', err);
      return null;
    }
  }

  /**
   * Calculate angle between three joints (in degrees)
   * @param joint1 First joint (e.g., hip)
   * @param joint2 Middle joint (e.g., knee) - the vertex of the angle
   * @param joint3 Third joint (e.g., ankle)
   * @returns Angle in degrees (0-180)
   */
  static calculateAngle(joint1: Joint3D, joint2: Joint3D, joint3: Joint3D): number {
    if (!ARKitBodyTracker) {
      return 0;
    }
    return ARKitBodyTracker.calculateAngle(joint1, joint2, joint3);
  }

  /**
   * Calculate distance between two joints in meters
   * @param joint1 First joint
   * @param joint2 Second joint
   * @returns Distance in meters
   */
  static getJointDistance(joint1: Joint3D, joint2: Joint3D): number {
    if (!ARKitBodyTracker) {
      return 0;
    }
    return ARKitBodyTracker.getJointDistance(joint1, joint2);
  }

  /**
   * Helper: Find a joint by name (case-insensitive partial match)
   */
  static findJoint(pose: BodyPose, jointName: string): Joint3D | undefined {
    const normalizedName = jointName.toLowerCase();
    return pose.joints.find((j) =>
      j.name.toLowerCase().includes(normalizedName)
    );
  }

  /**
   * Helper: Calculate all major joint angles for fitness tracking
   */
  static calculateAllAngles(pose: BodyPose): JointAngles | null {
    // Find all required joints
    const leftHip = this.findJoint(pose, 'left_upLeg');
    const leftKnee = this.findJoint(pose, 'left_leg');
    const leftAnkle = this.findJoint(pose, 'left_foot');

    const rightHip = this.findJoint(pose, 'right_upLeg');
    const rightKnee = this.findJoint(pose, 'right_leg');
    const rightAnkle = this.findJoint(pose, 'right_foot');

    const leftShoulder = this.findJoint(pose, 'left_shoulder');
    const leftElbow = this.findJoint(pose, 'left_forearm');
    const leftWrist = this.findJoint(pose, 'left_hand');

    const rightShoulder = this.findJoint(pose, 'right_shoulder');
    const rightElbow = this.findJoint(pose, 'right_forearm');
    const rightWrist = this.findJoint(pose, 'right_hand');

    const spine = this.findJoint(pose, 'spine_4');
    const neck = this.findJoint(pose, 'neck');

    // Check if we have all required joints
    if (!leftHip || !leftKnee || !leftAnkle ||
        !rightHip || !rightKnee || !rightAnkle ||
        !leftShoulder || !leftElbow || !leftWrist ||
        !rightShoulder || !rightElbow || !rightWrist) {
      return null;
    }

    return {
      leftKnee: this.calculateAngle(leftHip, leftKnee, leftAnkle),
      rightKnee: this.calculateAngle(rightHip, rightKnee, rightAnkle),
      leftElbow: this.calculateAngle(leftShoulder, leftElbow, leftWrist),
      rightElbow: this.calculateAngle(rightShoulder, rightElbow, rightWrist),
      leftHip: spine ? this.calculateAngle(spine, leftHip, leftKnee) : 0,
      rightHip: spine ? this.calculateAngle(spine, rightHip, rightKnee) : 0,
      leftShoulder: neck ? this.calculateAngle(neck, leftShoulder, leftElbow) : 0,
      rightShoulder: neck ? this.calculateAngle(neck, rightShoulder, rightElbow) : 0,
    };
  }

  /**
   * Helper: Calculate squat depth (hip to knee distance in meters)
   */
  static getSquatDepth(pose: BodyPose): number | null {
    const hip = this.findJoint(pose, 'hips_joint') || this.findJoint(pose, 'root');
    const leftKnee = this.findJoint(pose, 'left_leg');
    const rightKnee = this.findJoint(pose, 'right_leg');

    if (!hip || !leftKnee || !rightKnee) {
      return null;
    }

    // Average depth from both knees
    const leftDepth = hip.y - leftKnee.y;
    const rightDepth = hip.y - rightKnee.y;
    return (leftDepth + rightDepth) / 2;
  }

  /**
   * Helper: Check symmetry between left and right sides
   * @param leftAngle Left side angle
   * @param rightAngle Right side angle
   * @param threshold Maximum acceptable difference in degrees (default: 10)
   * @returns true if angles are symmetric within threshold
   */
  static checkSymmetry(
    leftAngle: number,
    rightAngle: number,
    threshold: number = 10
  ): boolean {
    return Math.abs(leftAngle - rightAngle) <= threshold;
  }

  /**
   * Helper: Calculate velocity of a joint between two poses
   * @param joint1 Joint in first pose
   * @param joint2 Same joint in second pose
   * @param timeDelta Time difference in seconds
   * @returns Velocity in meters per second
   */
  static calculateJointVelocity(
    joint1: Joint3D,
    joint2: Joint3D,
    timeDelta: number
  ): number {
    const distance = this.getJointDistance(joint1, joint2);
    return distance / timeDelta;
  }
}

/**
 * React hook for ARKit body tracking
 */
export function useBodyTracking(fps: number = 60) {
  const [pose, setPose] = React.useState<BodyPose | null>(null);
  const [pose2D, setPose2D] = React.useState<BodyPose2D | null>(null);
  const [isSupported, setIsSupported] = React.useState(false);
  const [isTracking, setIsTracking] = React.useState(false);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastTimestampRef = React.useRef<number>(0);
  const poseRef = React.useRef<BodyPose | null>(null);

  React.useEffect(() => {
    // Check support with retry logic for module initialization
    // Native module may not be immediately available on cold start
    let retryCount = 0;
    const maxRetries = 8;
    const retryDelay = 300; // ms

    const checkSupport = () => {
      console.log(
        `[useBodyTracking] Checking support (attempt ${retryCount + 1}/${maxRetries}) Platform: ${Platform.OS} ${Platform.Version}`
      );
      const supported = BodyTracker.isSupported();
      console.log(`[useBodyTracking] isSupported returned: ${supported}`);

      if (supported) {
        setIsSupported(true);
      } else if (retryCount < maxRetries - 1) {
        retryCount++;
        console.log(`[useBodyTracking] Will retry in ${retryDelay}ms...`);
        setTimeout(checkSupport, retryDelay);
      } else {
        console.log('[useBodyTracking] All retries exhausted, device not supported');
        setIsSupported(false);
      }
    };

    // Small delay before first check to allow native modules to initialize
    setTimeout(checkSupport, 150);
  }, []);

  const startTracking = React.useCallback(async () => {
    try {
      // Ensure ARKit view mounts before starting the session to prefer ARView.session
      // Give it more time to ensure the view is laid out and ready
      await new Promise((r) => setTimeout(r, 300));
      await BodyTracker.startTracking();
      setIsTracking(true);

      // Poll for poses at specified FPS
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        const currentPose = BodyTracker.getCurrentPose();
        if (!currentPose || !currentPose.isTracking) {
          if (poseRef.current !== null) {
            poseRef.current = null;
            lastTimestampRef.current = 0;
            setPose(null);
            setPose2D(null);
          }
          return;
        }
        if (currentPose.timestamp === lastTimestampRef.current) {
          return;
        }
        lastTimestampRef.current = currentPose.timestamp;
        poseRef.current = currentPose;
        setPose(currentPose);

        const projected = BodyTracker.getCurrentPose2D();
        if (projected && projected.isTracking && projected.joints.length > 0) {
          setPose2D(projected);
        } else {
          setPose2D(null);
        }
      }, 1000 / fps);
    } catch (error) {
      console.error('Failed to start body tracking:', error);
      throw error;
    }
  }, [fps]);

  const stopTracking = React.useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    BodyTracker.stopTracking();
    setIsTracking(false);
    setPose(null);
    setPose2D(null);
    poseRef.current = null;
    lastTimestampRef.current = 0;
  }, []);

  React.useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  return {
    pose,
    pose2D,
    isSupported,
    isTracking,
    startTracking,
    stopTracking,
  };
}

// Import React for the hook
import * as React from 'react';
