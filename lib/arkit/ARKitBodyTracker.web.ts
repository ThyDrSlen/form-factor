/**
 * Web stub for ARKit Body Tracking
 * 
 * ARKit is iOS-only. This stub provides type-compatible no-op implementations
 * to allow the app to compile and run on web without crashes.
 */

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
 * ARKit Body Tracking API (Web Stub)
 * ARKit requires iOS devices with A12 Bionic chip or later
 */
export class BodyTracker {
  static isNativeModuleLoaded(): boolean {
    return false;
  }

  static getSupportDiagnostics(): NativeSupportDiagnostics | null {
    return null;
  }
  /**
   * Check if ARKit body tracking is supported on this device
   * Always returns false on web
   */
  static isSupported(): boolean {
    if (__DEV__) {
      console.warn('[BodyTracker.web] ARKit body tracking is not available on web platform');
    }
    return false;
  }

  /**
   * Start ARKit body tracking session
   * Throws error on web
   */
  static async startTracking(): Promise<void> {
    throw new Error('ARKit body tracking is only available on iOS devices with A12 Bionic chip or later');
  }

  /**
   * Get current body pose with all joint positions
   * Always returns null on web
   */
  static getCurrentPose(): BodyPose | null {
    return null;
  }

  /**
   * Stop body tracking session
   * No-op on web
   */
  static stopTracking(): void {
    // No-op
  }

  static async getCurrentFrameSnapshot(_options?: { maxWidth?: number; quality?: number }): Promise<FrameSnapshot | null> {
    return null;
  }

  /**
   * Calculate angle between three joints (in degrees)
   * Returns 0 on web
   */
  static calculateAngle(joint1: Joint3D, joint2: Joint3D, joint3: Joint3D): number {
    console.warn('[BodyTracker.web] calculateAngle is not available on web');
    return 0;
  }

  /**
   * Calculate distance between two joints in meters
   * Returns 0 on web
   */
  static getJointDistance(joint1: Joint3D, joint2: Joint3D): number {
    console.warn('[BodyTracker.web] getJointDistance is not available on web');
    return 0;
  }

  /**
   * Helper: Find a joint by name (case-insensitive partial match)
   * Returns undefined on web
   */
  static findJoint(pose: BodyPose, jointName: string): Joint3D | undefined {
    return undefined;
  }

  /**
   * Helper: Calculate all major joint angles for fitness tracking
   * Returns null on web
   */
  static calculateAllAngles(pose: BodyPose): JointAngles | null {
    return null;
  }

  /**
   * Helper: Calculate squat depth (hip to knee distance in meters)
   * Returns null on web
   */
  static getSquatDepth(pose: BodyPose): number | null {
    return null;
  }

  /**
   * Helper: Check symmetry between left and right sides
   * Always returns false on web
   */
  static checkSymmetry(
    leftAngle: number,
    rightAngle: number,
    threshold: number = 10
  ): boolean {
    return false;
  }

  /**
   * Helper: Calculate velocity of a joint between two poses
   * Returns 0 on web
   */
  static calculateJointVelocity(
    joint1: Joint3D,
    joint2: Joint3D,
    timeDelta: number
  ): number {
    return 0;
  }
}

/**
 * React hook for ARKit body tracking (Web Stub)
 */
export function useBodyTracking(fps: number = 30) {
  return {
    pose: null as BodyPose | null,
    isSupported: false,
    isTracking: false,
    startTracking: async () => {
      throw new Error('ARKit body tracking is only available on iOS');
    },
    stopTracking: () => {
      // No-op
    },
  };
}
