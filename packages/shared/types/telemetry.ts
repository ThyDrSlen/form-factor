/**
 * Telemetry types for ML evaluation system
 *
 * These types align with the database schema in migrations 017 and 018.
 */

// =============================================================================
// Versioning and Experiment Context
// =============================================================================

export interface TelemetryContext {
  modelVersion: string;
  cueConfigVersion: string;
  exerciseConfigVersion?: string;
  experimentId?: string;
  variant?: string;
}

// =============================================================================
// Environment and Device Context
// =============================================================================

export interface EnvironmentContext {
  deviceModel: string;
  osVersion: string;
  cameraAngleClass?: 'side' | 'front' | 'rear_three_quarter';
  distanceBucket?: 'close' | 'medium' | 'far';
  lightingBucket?: 'low' | 'medium' | 'good';
  mirrorPresent?: boolean;
}

// =============================================================================
// Quality Signals
// =============================================================================

export interface SessionQuality {
  poseLostCount: number;
  lowConfidenceFrames: number;
  trackingResetCount: number;
  userAbortedEarly: boolean;
  cuesDisabledMidSession: boolean;
}

// =============================================================================
// Frame-Level Data
// =============================================================================

export interface FrameSample {
  sessionId: string;
  frameIdx: number;
  ts: number;
  modelVersion: string;
  cueConfigVersion?: string;
  inferenceMs?: number;
  poseConfidence?: number[];
  jointAngles: Record<string, number>;
  cameraPose?: [number, number, number, number, number, number];
  lightingScore?: number;
  exerciseMode?: string;
  phase?: string;
  repNumber?: number | null;
  fpsAtCapture?: number;
}

// =============================================================================
// Rep-Level Data
// =============================================================================

export interface RepFeatures {
  romDeg?: number;
  depthRatio?: number;
  durationMs?: number;
  peakVelocity?: number;
  depthMin?: number;
  valgusPeak?: number;
  lumbarFlexionPeak?: number;
  [key: string]: number | undefined;
}

export interface EmittedCue {
  type: string;
  ts: string;
}

export interface RepEvent {
  sessionId: string;
  setId?: string;
  repIndex: number;
  exercise: string;
  side?: 'left' | 'right';
  startTs: string;
  endTs: string;
  features: RepFeatures;
  fqi?: number;
  faultsDetected: string[];
  cuesEmitted: EmittedCue[];
  adoptedWithin3Reps?: boolean;
}

// =============================================================================
// Set-Level Data
// =============================================================================

export interface SetSummary {
  sessionId: string;
  exercise: string;
  loadValue?: number;
  loadUnit?: 'kg' | 'lbs';
  tempo?: string;
  stanceWidth?: string;
  repsCount: number;
  avgFqi?: number;
  faultsHistogram?: Record<string, number>;
  cuesPerMin?: number;
  mediaUri?: string;
  mediaSha256?: string;
}

// =============================================================================
// Labels (Ground Truth)
// =============================================================================

export type LabelSource = 'trainer' | 'self' | 'auto';

export interface RepLabel {
  repId: string;
  labelGoodForm: boolean;
  labelFaultTypes: string[];
  labelSource: LabelSource;
  notes?: string;
}

// =============================================================================
// User Consent
// =============================================================================

export interface TelemetryConsent {
  allowAnonymousTelemetry: boolean;
  allowVideoUpload: boolean;
  allowTrainerLabeling: boolean;
  allowExtendedRetention: boolean;
}

// =============================================================================
// Retention Policy
// =============================================================================

export type RetentionClass = 'short' | 'extended';

export interface RetentionPolicy {
  frameSamplesDays: number;
  videoDays: number;
  extendedDays: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  frameSamplesDays: 60,
  videoDays: 90,
  extendedDays: 365,
};

// =============================================================================
// Session Metrics (Extended)
// =============================================================================

export interface SessionMetricsPayload {
  sessionId: string;
  startAt?: string;
  endAt?: string | null;
  avgFps?: number | null;
  minFps?: number | null;
  avgLatencyMs?: number | null;
  shadowEnabled?: boolean;
  shadowProvider?: string;
  shadowModelVersion?: string;
  shadowFramesCompared?: number | null;
  shadowMeanAbsDelta?: number | null;
  shadowP95AbsDelta?: number | null;
  shadowMaxAbsDelta?: number | null;
  shadowCoverageRatio?: number | null;
  cuesTotal?: number | null;
  cuesSpoken?: number | null;
  cuesDroppedRepeat?: number | null;
  cuesDroppedDisabled?: number | null;
  modelVersion?: string;
  cueConfigVersion?: string;
  exerciseConfigVersion?: string;
  experimentId?: string;
  variant?: string;
  deviceModel?: string;
  osVersion?: string;
  cameraAngleClass?: string;
  distanceBucket?: string;
  lightingBucket?: string;
  mirrorPresent?: boolean;
  poseLostCount?: number;
  lowConfidenceFrames?: number;
  trackingResetCount?: number;
  userAbortedEarly?: boolean;
  cuesDisabledMidSession?: boolean;
  retentionClass?: RetentionClass;
}
