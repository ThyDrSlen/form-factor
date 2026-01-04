/**
 * Telemetry types for ML evaluation system
 * 
 * These types align with the database schema in migrations 017 and 018.
 */

// =============================================================================
// Versioning and Experiment Context
// =============================================================================

/**
 * Version context attached to all telemetry events
 * Enables reproducibility and A/B test analysis
 */
export interface TelemetryContext {
  /** Pose estimation model version, e.g., 'arkit-angles@1.0.0' */
  modelVersion: string;
  /** Cue generation config version (thresholds, debounce settings) */
  cueConfigVersion: string;
  /** Exercise-specific config version (targets per lift) */
  exerciseConfigVersion?: string;
  /** A/B experiment identifier */
  experimentId?: string;
  /** Experiment variant, e.g., 'control' | 'aggressive' */
  variant?: string;
}

// =============================================================================
// Environment and Device Context
// =============================================================================

/**
 * Environment context for session-level analysis
 * Helps diagnose "model sucks" vs "setup sucks" issues
 */
export interface EnvironmentContext {
  /** Device model, e.g., 'iPhone15,2' */
  deviceModel: string;
  /** OS version, e.g., '17.4.1' */
  osVersion: string;
  /** Camera angle classification */
  cameraAngleClass?: 'side' | 'front' | 'rear_three_quarter';
  /** Distance from camera */
  distanceBucket?: 'close' | 'medium' | 'far';
  /** Lighting quality */
  lightingBucket?: 'low' | 'medium' | 'good';
  /** Whether a mirror is detected/reported */
  mirrorPresent?: boolean;
}

// =============================================================================
// Quality Signals
// =============================================================================

/**
 * Session quality metrics for filtering garbage data
 */
export interface SessionQuality {
  /** Number of times pose tracking was lost */
  poseLostCount: number;
  /** Frames with confidence below threshold */
  lowConfidenceFrames: number;
  /** Number of tracking resets */
  trackingResetCount: number;
  /** User quit within 20 seconds */
  userAbortedEarly: boolean;
  /** User disabled cues during the session */
  cuesDisabledMidSession: boolean;
}

// =============================================================================
// Frame-Level Data
// =============================================================================

/**
 * Extended pose sample with versioning and quality metrics
 */
export interface FrameSample {
  sessionId: string;
  frameIdx: number;
  /** ARKit frame timestamp */
  ts: number;
  /** Pose model version */
  modelVersion: string;
  /** Cue config version */
  cueConfigVersion?: string;
  /** Inference time in milliseconds */
  inferenceMs?: number;
  /** Per-joint confidence scores (0-1) */
  poseConfidence?: number[];
  /** Joint angles in degrees */
  jointAngles: Record<string, number>;
  /** Camera pose [x, y, z, yaw, pitch, roll] */
  cameraPose?: [number, number, number, number, number, number];
  /** Lighting quality score (0-1) */
  lightingScore?: number;
  /** Current exercise mode */
  exerciseMode?: string;
  /** Current movement phase */
  phase?: string;
  /** Current rep number */
  repNumber?: number | null;
  /** FPS at capture time */
  fpsAtCapture?: number;
}

// =============================================================================
// Rep-Level Data
// =============================================================================

/**
 * Per-rep features and metrics
 */
export interface RepFeatures {
  /** Range of motion in degrees */
  romDeg?: number;
  /** Depth ratio (e.g., hip to knee for squats) */
  depthRatio?: number;
  /** Rep duration in milliseconds */
  durationMs?: number;
  /** Peak velocity during concentric phase */
  peakVelocity?: number;
  /** Minimum depth reached */
  depthMin?: number;
  /** Peak knee valgus angle (for squat/lunge) */
  valgusPeak?: number;
  /** Peak lumbar flexion (for deadlift) */
  lumbarFlexionPeak?: number;
  /** Additional custom features */
  [key: string]: number | undefined;
}

/**
 * Cue emitted during a rep
 */
export interface EmittedCue {
  /** Cue type/identifier */
  type: string;
  /** ISO timestamp when cue was emitted */
  ts: string;
}

/**
 * Rep event for logging
 */
export interface RepEvent {
  sessionId: string;
  setId?: string;
  repIndex: number;
  exercise: string;
  /** For unilateral exercises */
  side?: 'left' | 'right';
  /** ISO timestamp */
  startTs: string;
  /** ISO timestamp */
  endTs: string;
  /** Extracted features */
  features: RepFeatures;
  /** Form quality index (0-100) */
  fqi?: number;
  /** Detected fault types */
  faultsDetected: string[];
  /** Cues emitted during this rep */
  cuesEmitted: EmittedCue[];
  /** Whether user adopted cue feedback within 3 reps */
  adoptedWithin3Reps?: boolean;
}

// =============================================================================
// Set-Level Data
// =============================================================================

/**
 * Set summary with aggregates and media reference
 */
export interface SetSummary {
  sessionId: string;
  exercise: string;
  /** Load value (weight) */
  loadValue?: number;
  /** Load unit */
  loadUnit?: 'kg' | 'lbs';
  /** Tempo notation, e.g., '3-1-2-0' */
  tempo?: string;
  /** Stance width classification */
  stanceWidth?: string;
  /** Number of reps in set */
  repsCount: number;
  /** Average FQI across reps */
  avgFqi?: number;
  /** Fault type histogram, e.g., { valgus: 3, depth: 2 } */
  faultsHistogram?: Record<string, number>;
  /** Cues emitted per minute */
  cuesPerMin?: number;
  /** Storage path for video */
  mediaUri?: string;
  /** SHA256 hash of video file for integrity */
  mediaSha256?: string;
}

// =============================================================================
// Labels (Ground Truth)
// =============================================================================

/**
 * Label source types
 */
export type LabelSource = 'trainer' | 'self' | 'auto';

/**
 * Ground truth label for a rep
 */
export interface RepLabel {
  repId: string;
  /** Overall form quality */
  labelGoodForm: boolean;
  /** Specific faults identified */
  labelFaultTypes: string[];
  /** Who created this label */
  labelSource: LabelSource;
  /** Optional notes from labeler */
  notes?: string;
}

// =============================================================================
// User Consent
// =============================================================================

/**
 * User consent flags for telemetry and privacy
 */
export interface TelemetryConsent {
  /** Allow anonymized telemetry for model improvement */
  allowAnonymousTelemetry: boolean;
  /** Allow video upload for research */
  allowVideoUpload: boolean;
  /** Allow trainers to label user's reps */
  allowTrainerLabeling: boolean;
  /** Allow extended data retention (study participants) */
  allowExtendedRetention: boolean;
}

// =============================================================================
// Retention Policy
// =============================================================================

/**
 * Retention class determines how long data is kept
 */
export type RetentionClass = 'short' | 'extended';

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  /** Default: 60 days for pose_samples */
  frameSamplesDays: number;
  /** Default: 90 days for videos */
  videoDays: number;
  /** Extended retention for study participants */
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

/**
 * Extended session metrics payload
 */
export interface SessionMetricsPayload {
  sessionId: string;
  startAt?: string;
  endAt?: string | null;
  
  // Performance
  avgFps?: number | null;
  minFps?: number | null;
  avgLatencyMs?: number | null;
  
  // Cue stats
  cuesTotal?: number | null;
  cuesSpoken?: number | null;
  cuesDroppedRepeat?: number | null;
  cuesDroppedDisabled?: number | null;
  
  // Versioning
  modelVersion?: string;
  cueConfigVersion?: string;
  exerciseConfigVersion?: string;
  
  // Experiment
  experimentId?: string;
  variant?: string;
  
  // Environment
  deviceModel?: string;
  osVersion?: string;
  cameraAngleClass?: string;
  distanceBucket?: string;
  lightingBucket?: string;
  mirrorPresent?: boolean;
  
  // Quality
  poseLostCount?: number;
  lowConfidenceFrames?: number;
  trackingResetCount?: number;
  userAbortedEarly?: boolean;
  cuesDisabledMidSession?: boolean;
  
  // Retention
  retentionClass?: RetentionClass;
}
