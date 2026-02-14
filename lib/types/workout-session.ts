/**
 * Workout Session Types
 *
 * Core types for the workout sessions system including templates,
 * live session runner, exercises, sets, and event logging.
 */

// =============================================================================
// Enums
// =============================================================================

export type GoalProfile = 'hypertrophy' | 'strength' | 'power' | 'endurance' | 'mixed';

export type SetType = 'normal' | 'warmup' | 'dropset' | 'amrap' | 'failure' | 'timed';

export type TutSource = 'measured' | 'estimated' | 'unknown';

export type ExerciseCategory = 'push' | 'pull' | 'legs' | 'core' | 'cardio' | 'full_body';

export type SessionEventType =
  | 'session_started'
  | 'exercise_started'
  | 'set_started'
  | 'set_completed'
  | 'rest_started'
  | 'rest_completed'
  | 'rest_skipped'
  | 'session_completed';

// =============================================================================
// Exercise
// =============================================================================

export interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory | null;
  muscle_group: string | null;
  is_compound: boolean;
  is_timed: boolean;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Templates
// =============================================================================

export interface WorkoutTemplate {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  goal_profile: GoalProfile;
  is_public: boolean;
  share_slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutTemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  sort_order: number;
  notes: string | null;
  default_rest_seconds: number | null;
  default_tempo: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutTemplateSet {
  id: string;
  template_exercise_id: string;
  sort_order: number;
  set_type: SetType;
  target_reps: number | null;
  target_seconds: number | null;
  target_weight: number | null;
  target_rpe: number | null;
  rest_seconds_override: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Sessions
// =============================================================================

export interface WorkoutSession {
  id: string;
  user_id: string;
  template_id: string | null;
  name: string | null;
  goal_profile: GoalProfile;
  started_at: string;
  ended_at: string | null;
  timezone_offset_minutes: number;
  bodyweight_lb: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutSessionExercise {
  id: string;
  session_id: string;
  exercise_id: string;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutSessionSet {
  id: string;
  session_exercise_id: string;
  sort_order: number;
  set_type: SetType;

  // Planned values (from template)
  planned_reps: number | null;
  planned_seconds: number | null;
  planned_weight: number | null;

  // Actual values (filled during session)
  actual_reps: number | null;
  actual_seconds: number | null;
  actual_weight: number | null;

  // Timing
  started_at: string | null;
  completed_at: string | null;

  // Rest
  rest_target_seconds: number | null;
  rest_started_at: string | null;
  rest_completed_at: string | null;
  rest_skipped: boolean;

  // TUT
  tut_ms: number | null;
  tut_source: TutSource;

  // Metadata
  perceived_rpe: number | null;
  notes: string | null;

  created_at: string;
  updated_at: string;
}

// =============================================================================
// Event Log
// =============================================================================

export interface WorkoutSessionEvent {
  id: string;
  session_id: string;
  created_at: string;
  type: SessionEventType;
  session_exercise_id: string | null;
  session_set_id: string | null;
  payload: Record<string, unknown>;
}

// =============================================================================
// Local SQLite row types (includes synced/deleted fields)
// =============================================================================

export interface LocalExercise extends Exercise {
  synced: number;
}

export interface LocalWorkoutTemplate extends Omit<WorkoutTemplate, 'user_id'> {
  synced: number;
  deleted: number;
}

export interface LocalWorkoutTemplateExercise extends WorkoutTemplateExercise {
  synced: number;
  deleted: number;
}

export interface LocalWorkoutTemplateSet extends WorkoutTemplateSet {
  synced: number;
  deleted: number;
}

export interface LocalWorkoutSession extends Omit<WorkoutSession, 'user_id'> {
  synced: number;
  deleted: number;
}

export interface LocalWorkoutSessionExercise extends WorkoutSessionExercise {
  synced: number;
  deleted: number;
}

export interface LocalWorkoutSessionSet extends WorkoutSessionSet {
  synced: number;
  deleted: number;
}

export interface LocalWorkoutSessionEvent extends WorkoutSessionEvent {
  synced: number;
}
