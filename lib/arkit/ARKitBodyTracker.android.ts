/**
 * ARKit Body Tracking - Default/Fallback implementation
 *
 * This file serves as:
 * 1. ESLint/TypeScript module resolution fallback
 * 2. Android fallback (ARKit is iOS-only)
 *
 * Metro automatically resolves to platform-specific implementations:
 * - iOS: ARKitBodyTracker.ios.ts (full ARKit implementation)
 * - Web: ARKitBodyTracker.web.ts (stub)
 * - Android/Other: This file (stub)
 */
import * as React from 'react';

export interface Joint3D {
  name: string;
  x: number;
  y: number;
  z: number;
  isTracked: boolean;
}

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
 * ARKit Body Tracking API (Fallback Stub)
 * Returns unsupported for non-iOS platforms
 */
export class BodyTracker {
  static isNativeModuleLoaded(): boolean {
    return false;
  }

  static getSupportDiagnostics(): NativeSupportDiagnostics | null {
    return null;
  }
  static isSupported(): boolean {
    return false;
  }

  static async startTracking(): Promise<void> {
    throw new Error('ARKit body tracking is only available on iOS');
  }

  static getCurrentPose(): BodyPose | null {
    return null;
  }

  static getCurrentPose2D(): BodyPose2D | null {
    return null;
  }

  static stopTracking(): void {}

  static async startRecording(): Promise<void> {
    throw new Error('ARKit recording is only available on iOS');
  }

  static async stopRecording(): Promise<string | null> {
    return null;
  }

  static async getCurrentFrameSnapshot(_options?: { maxWidth?: number; quality?: number }): Promise<FrameSnapshot | null> {
    return null;
  }

  static calculateAngle(_j1: Joint3D, _j2: Joint3D, _j3: Joint3D): number {
    return 0;
  }

  static getJointDistance(_j1: Joint3D, _j2: Joint3D): number {
    return 0;
  }

  static findJoint(_pose: BodyPose, _jointName: string): Joint3D | undefined {
    return undefined;
  }

  static calculateAllAngles(_pose: BodyPose): JointAngles | null {
    return null;
  }

  static getSquatDepth(_pose: BodyPose): number | null {
    return null;
  }

  static checkSymmetry(_left: number, _right: number, _threshold?: number): boolean {
    return false;
  }

  static calculateJointVelocity(_j1: Joint3D, _j2: Joint3D, _timeDelta: number): number {
    return 0;
  }
}

/**
 * React hook for ARKit body tracking (Fallback Stub)
 */
export function useBodyTracking(_fps: number = 30) {
  const [pose] = React.useState<BodyPose | null>(null);
  const [pose2D] = React.useState<BodyPose2D | null>(null);

  return {
    pose,
    pose2D,
    isSupported: false,
    isTracking: false,
    startTracking: async () => {
      throw new Error('ARKit body tracking is only available on iOS');
    },
    stopTracking: () => {},
  };
}
