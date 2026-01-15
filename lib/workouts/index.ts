/**
 * Workout Registry
 *
 * Central registry of all workout definitions.
 * Import individual workouts or use the registry to look up by ID.
 */

import type { WorkoutDefinition, WorkoutRegistry } from '@/lib/types/workout-definitions';

// Import individual workout definitions
import { benchpressDefinition, type BenchPressPhase, type BenchPressMetrics } from './benchpress';
import { deadHangDefinition, type DeadHangPhase, type DeadHangMetrics } from './dead-hang';
import { deadliftDefinition, type DeadliftPhase, type DeadliftMetrics } from './deadlift';
import { farmersWalkDefinition, type FarmersWalkPhase, type FarmersWalkMetrics } from './farmers-walk';
import { pullupDefinition, type PullUpPhase, type PullUpMetrics } from './pullup';
import { pushupDefinition, type PushUpPhase, type PushUpMetrics } from './pushup';
import { rdlDefinition, type RDLPhase, type RDLMetrics } from './rdl';
import { squatDefinition, type SquatPhase, type SquatMetrics } from './squat';

export const workoutsByMode = {
  benchpress: benchpressDefinition,
  dead_hang: deadHangDefinition,
  deadlift: deadliftDefinition,
  farmers_walk: farmersWalkDefinition,
  pullup: pullupDefinition,
  pushup: pushupDefinition,
  rdl: rdlDefinition,
  squat: squatDefinition,
} as const;

// =============================================================================
// Re-exports
// =============================================================================

// Re-export individual definitions for direct import
export { benchpressDefinition, BENCHPRESS_THRESHOLDS, type BenchPressPhase, type BenchPressMetrics } from './benchpress';
export { deadHangDefinition, DEAD_HANG_THRESHOLDS, type DeadHangPhase, type DeadHangMetrics } from './dead-hang';
export { deadliftDefinition, DEADLIFT_THRESHOLDS, type DeadliftPhase, type DeadliftMetrics } from './deadlift';
export { farmersWalkDefinition, FARMERS_WALK_THRESHOLDS, type FarmersWalkPhase, type FarmersWalkMetrics } from './farmers-walk';
export { pullupDefinition, PULLUP_THRESHOLDS, type PullUpPhase, type PullUpMetrics } from './pullup';
export { pushupDefinition, PUSHUP_THRESHOLDS, type PushUpPhase, type PushUpMetrics } from './pushup';
export { rdlDefinition, RDL_THRESHOLDS, type RDLPhase, type RDLMetrics } from './rdl';
export { squatDefinition, SQUAT_THRESHOLDS, type SquatPhase, type SquatMetrics } from './squat';
export { getPhaseStaticCue } from './helpers';

// Re-export type utilities
export type { WorkoutDefinition, WorkoutRegistry } from '@/lib/types/workout-definitions';

// =============================================================================
// Workout Registry
// =============================================================================

/**
 * Map of workout ID to workout definition
 * Use this to look up a workout by its ID string
 * 
 * Note: We use type assertion here because each workout has specific phase types,
 * but the registry needs to store them generically for lookup purposes.
 */
export const workoutRegistry: WorkoutRegistry = {
  benchpress: benchpressDefinition as unknown as WorkoutDefinition,
  dead_hang: deadHangDefinition as unknown as WorkoutDefinition,
  deadlift: deadliftDefinition as unknown as WorkoutDefinition,
  farmers_walk: farmersWalkDefinition as unknown as WorkoutDefinition,
  pullup: pullupDefinition as unknown as WorkoutDefinition,
  pushup: pushupDefinition as unknown as WorkoutDefinition,
  rdl: rdlDefinition as unknown as WorkoutDefinition,
  squat: squatDefinition as unknown as WorkoutDefinition,
};

export type DetectionMode = keyof typeof workoutsByMode;

export const DEFAULT_DETECTION_MODE: DetectionMode = 'pullup';

export function getWorkoutByMode<M extends DetectionMode>(mode: M): (typeof workoutsByMode)[M] {
  return workoutsByMode[mode];
}

/**
 * Get a workout definition by ID
 * @param id Workout identifier (e.g., 'pullup', 'pushup')
 * @returns The workout definition or undefined if not found
 */
export function getWorkoutById(id: string): WorkoutDefinition | undefined {
  return workoutRegistry[id];
}

/**
 * Get all available workout IDs
 */
export function getWorkoutIds(): DetectionMode[] {
  return Object.keys(workoutsByMode) as DetectionMode[];
}

/**
 * Check if a workout ID is valid
 */
export function isValidWorkoutId(id: string): boolean {
  return id in workoutRegistry;
}

/**
 * Type guard to check if a string is a valid detection mode
 */
export function isDetectionMode(mode: string): mode is DetectionMode {
  return mode in workoutsByMode;
}
