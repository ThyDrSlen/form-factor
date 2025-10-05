/**
 * iOS implementation of ARKit Body Tracking
 * 
 * For web stub, see ARKitBodyTracker.web.ts
 */
import { requireNativeModule } from 'expo-modules-core';

// Load native module safely (don't throw during import)
let ARKitBodyTracker: any = null;
try {
  console.log('[ARKitBodyTracker] Attempting to load native module...');
  ARKitBodyTracker = requireNativeModule('ARKitBodyTracker');
  console.log('[ARKitBodyTracker] Native module loaded successfully:', !!ARKitBodyTracker);
  if (ARKitBodyTracker) {
    console.log('[ARKitBodyTracker] Available methods:', Object.keys(ARKitBodyTracker));
  }
} catch (e) {
  console.error('[ARKitBodyTracker] Failed to load native module:', e);
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn('[ARKitBodyTracker] Native module not found. Run `bunx expo prebuild --clean --platform ios && cd ios && pod install`');
  }
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
  /**
   * Check if ARKit body tracking is supported on this device
   * Requires iPhone XS or newer (A12 Bionic chip or later)
   */
  static isSupported(): boolean {
    console.log('[BodyTracker] isSupported() called');
    console.log('[BodyTracker] ARKitBodyTracker module exists:', !!ARKitBodyTracker);
    
    if (!ARKitBodyTracker) {
      console.error('[BodyTracker] Native module not loaded - returning false');
      console.error('[BodyTracker] This means the module failed to load at import time');
      console.error('[BodyTracker] You MUST run: bunx expo prebuild --clean --platform ios');
      return false;
    }
    
    console.log('[BodyTracker] Calling native isSupported()...');
    const supported = ARKitBodyTracker.isSupported();
    console.log('[BodyTracker] Native isSupported() returned:', supported);
    console.log('[BodyTracker] Device: iPhone 15 Pro should return TRUE');
    
    return supported;
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
export function useBodyTracking(fps: number = 30) {
  const [pose, setPose] = React.useState<BodyPose | null>(null);
  const [isSupported, setIsSupported] = React.useState(false);
  const [isTracking, setIsTracking] = React.useState(false);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    // Check support on mount
    const supported = BodyTracker.isSupported();
    setIsSupported(supported);
  }, []);

  const startTracking = React.useCallback(async () => {
    try {
      await BodyTracker.startTracking();
      setIsTracking(true);

      // Poll for poses at specified FPS
      intervalRef.current = setInterval(() => {
        const currentPose = BodyTracker.getCurrentPose();
        if (currentPose) {
          setPose(currentPose);
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
  }, []);

  React.useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  return {
    pose,
    isSupported,
    isTracking,
    startTracking,
    stopTracking,
  };
}

// Import React for the hook
import * as React from 'react';
