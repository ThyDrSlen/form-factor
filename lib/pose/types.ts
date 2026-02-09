import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

export type PoseProvider = 'arkit' | 'mediapipe' | 'mediapipe_proxy';

export type JointAngleKey = keyof JointAngles;

export interface CanonicalJoint2D {
  x: number;
  y: number;
  isTracked: boolean;
  confidence?: number;
}

export type CanonicalJointMap = Map<string, CanonicalJoint2D>;

export interface CanonicalPoseFrame {
  provider: PoseProvider;
  modelVersion: string;
  timestamp: number;
  angles: JointAngles;
  joints: CanonicalJointMap;
}

export interface ShadowAngleComparison {
  provider: PoseProvider;
  modelVersion: string;
  inferenceMs?: number;
  comparedJoints: number;
  coverageRatio: number;
  meanAbsDelta: number;
  p95AbsDelta: number;
  maxAbsDelta: number;
  deltaByJoint: Partial<Record<JointAngleKey, number>>;
  shadowAngles: Partial<Record<JointAngleKey, number>>;
}

export interface ShadowStatsAccumulator {
  framesCompared: number;
  comparedJointSamples: number;
  cumulativeAbsDelta: number;
  maxAbsDelta: number;
  cumulativeCoverage: number;
  deltaSamples: number[];
}

export interface ShadowStatsSummary {
  framesCompared: number;
  meanAbsDelta: number | null;
  p95AbsDelta: number | null;
  maxAbsDelta: number | null;
  coverageRatio: number | null;
}
