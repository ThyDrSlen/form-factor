/**
 * Workout Definition Types
 *
 * Core types for defining workout specifications including phases,
 * rep boundaries, angle ranges, fault conditions, and FQI weights.
 *
 * Each workout (pullup, pushup, squat, etc.) implements these interfaces
 * to define its specific logic for tracking form.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

// =============================================================================
// Angle Ranges
// =============================================================================

/**
 * Defines acceptable range for a joint angle during a workout
 */
export interface AngleRange {
  /** Minimum acceptable angle in degrees */
  min: number;
  /** Maximum acceptable angle in degrees */
  max: number;
  /** Optimal/target angle in degrees */
  optimal: number;
  /** Degrees of acceptable deviation from optimal before triggering fault */
  tolerance: number;
}

// =============================================================================
// Phase Definitions
// =============================================================================

/**
 * Defines a phase in the workout movement cycle
 * e.g., for pull-up: idle → hang → pull → top → hang → ...
 */
export interface PhaseDefinition<TPhase extends string = string> {
  /** Unique phase identifier */
  id: TPhase;
  /** Human-readable name */
  displayName: string;
  /** Condition to enter this phase (based on current angles) */
  enterCondition: (angles: JointAngles, prevPhase: TPhase) => boolean;
  /** Static cue displayed/spoken during this phase */
  staticCue: string;
}

// =============================================================================
// Rep Boundaries
// =============================================================================

/**
 * Defines when a rep starts and ends within the phase cycle
 */
export interface RepBoundary<TPhase extends string = string> {
  /** Phase that marks the start of a rep */
  startPhase: TPhase;
  /** Phase that marks the completion of a rep */
  endPhase: TPhase;
  /** Minimum time between reps in ms (debounce) */
  minDurationMs: number;
}

// =============================================================================
// Rep Context (for fault detection)
// =============================================================================

/**
 * Context available when evaluating faults for a completed rep
 */
export interface RepContext {
  /** Joint angles at rep start */
  startAngles: JointAngles;
  /** Joint angles at rep end */
  endAngles: JointAngles;
  /** Minimum angles reached during the rep */
  minAngles: JointAngles;
  /** Maximum angles reached during the rep */
  maxAngles: JointAngles;
  /** Rep duration in milliseconds */
  durationMs: number;
  /** Current rep number (1-indexed) */
  repNumber: number;
  /** Workout definition for reference */
  workoutId: string;
}

// =============================================================================
// Fault Definitions
// =============================================================================

/** Fault severity levels */
export type FaultSeverity = 1 | 2 | 3;

/**
 * Defines a detectable form fault
 */
export interface FaultDefinition {
  /** Unique fault identifier (e.g., 'incomplete_rom', 'hip_sag') */
  id: string;
  /** Human-readable fault name */
  displayName: string;
  /** Function to detect if this fault occurred during the rep */
  condition: (ctx: RepContext) => boolean;
  /** Severity: 1 = minor, 2 = moderate, 3 = major */
  severity: FaultSeverity;
  /** Dynamic cue to speak when fault is detected */
  dynamicCue: string;
  /** FQI penalty points (subtracted from score) */
  fqiPenalty: number;
}

// =============================================================================
// FQI (Form Quality Index) Weights
// =============================================================================

/**
 * Weights for calculating FQI score (should sum to 1.0)
 */
export interface FQIWeights {
  /** Weight for range of motion score (0-1) */
  rom: number;
  /** Weight for depth/position score (0-1) */
  depth: number;
  /** Weight for fault-based deductions (0-1) */
  faults: number;
}

// =============================================================================
// Workout Metrics
// =============================================================================

/**
 * Real-time metrics tracked during workout
 * Each workout type may use different subsets of these
 */
export interface WorkoutMetrics {
  /** Average elbow angle (left + right) / 2 */
  avgElbow?: number;
  /** Average shoulder angle */
  avgShoulder?: number;
  /** Average knee angle */
  avgKnee?: number;
  /** Average hip angle */
  avgHip?: number;
  /** Hip drop relative to shoulders (for push-ups) */
  hipDropRatio?: number;
  /** Head to hand distance (for pull-ups) */
  headToHand?: number;
  /** Whether arms are being tracked */
  armsTracked: boolean;
  /** Whether legs are being tracked */
  legsTracked?: boolean;
  /** Whether wrists are being tracked */
  wristsTracked?: boolean;
}

// =============================================================================
// Complete Workout Definition
// =============================================================================

/**
 * Complete definition for a workout type
 * This is the main interface that each workout file implements
 */
export interface WorkoutDefinition<
  TPhase extends string = string,
  TMetrics extends WorkoutMetrics = WorkoutMetrics
> {
  /** Unique workout identifier (e.g., 'pullup', 'pushup', 'squat') */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Brief description of the workout */
  description: string;
  /** Category for grouping */
  category: 'upper_body' | 'lower_body' | 'full_body' | 'core';
  /** Difficulty level */
  difficulty: 'beginner' | 'intermediate' | 'advanced';

  /** All phases in the movement cycle */
  phases: PhaseDefinition<TPhase>[];
  /** Initial/default phase */
  initialPhase: TPhase;

  /** When a rep starts and ends */
  repBoundary: RepBoundary<TPhase>;

  /** Angle thresholds for phase transitions */
  thresholds: Record<string, number>;

  /** Ideal angle ranges for key joints */
  angleRanges: Record<string, AngleRange>;

  /** Detectable form faults */
  faults: FaultDefinition[];

  /** Weights for FQI calculation */
  fqiWeights: FQIWeights;

  /**
   * Calculate workout-specific metrics from joint angles
   * Each workout implements this differently based on what it tracks
   */
  calculateMetrics: (angles: JointAngles, joints?: Map<string, { x: number; y: number; isTracked: boolean }>) => TMetrics;

  /**
   * Determine the next phase based on current angles and state
   */
  getNextPhase: (currentPhase: TPhase, angles: JointAngles, metrics: TMetrics) => TPhase;
}

// =============================================================================
// Workout Registry Types
// =============================================================================

/**
 * Map of workout ID to workout definition
 */
export type WorkoutRegistry = Record<string, WorkoutDefinition>;

/**
 * Helper type to extract phase type from a workout definition
 */
export type PhaseOf<T extends WorkoutDefinition> = T extends WorkoutDefinition<infer P> ? P : never;

/**
 * Helper type to extract metrics type from a workout definition
 */
export type MetricsOf<T extends WorkoutDefinition> = T extends WorkoutDefinition<string, infer M> ? M : never;
