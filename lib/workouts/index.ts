/**
 * Workout Registry
 *
 * Central registry of all workout definitions.
 * Import individual workouts or use the registry to look up by ID.
 */

import type { WorkoutDefinition, WorkoutRegistry } from '@/lib/types/workout-definitions';

// Import individual workout definitions
import { pullupDefinition, type PullUpPhase, type PullUpMetrics } from './pullup';
import { pushupDefinition, type PushUpPhase, type PushUpMetrics } from './pushup';

// =============================================================================
// Re-exports
// =============================================================================

// Re-export individual definitions for direct import
export { pullupDefinition, PULLUP_THRESHOLDS, type PullUpPhase, type PullUpMetrics } from './pullup';
export { pushupDefinition, PUSHUP_THRESHOLDS, type PushUpPhase, type PushUpMetrics } from './pushup';

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
  pullup: pullupDefinition as unknown as WorkoutDefinition,
  pushup: pushupDefinition as unknown as WorkoutDefinition,
};

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
export function getWorkoutIds(): string[] {
  return Object.keys(workoutRegistry);
}

/**
 * Check if a workout ID is valid
 */
export function isValidWorkoutId(id: string): boolean {
  return id in workoutRegistry;
}

// =============================================================================
// Detection Mode Type (for backward compatibility with scan-arkit.tsx)
// =============================================================================

/**
 * Union type of all available workout IDs
 * This can be used as a type guard in components
 */
export type DetectionMode = 'pullup' | 'pushup';

/**
 * Type guard to check if a string is a valid detection mode
 */
export function isDetectionMode(mode: string): mode is DetectionMode {
  return mode === 'pullup' || mode === 'pushup';
}
