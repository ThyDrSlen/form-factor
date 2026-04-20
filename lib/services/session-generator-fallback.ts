/**
 * Session Generator Offline Fallback
 *
 * Static template library used when Gemma / coach service is unreachable.
 * Categorized by goal profile (strength / hypertrophy / endurance) × duration
 * bucket (<20min, 20-45min, 45-75min, >75min). At least 12 templates total.
 *
 * The `withFallback` helper wraps any async generator call so the UI always
 * gets a usable result even when offline.
 */
import * as Crypto from 'expo-crypto';
import type {
  GoalProfile,
} from '@/lib/types/workout-session';
import type {
  GeneratedTemplateShape,
  HydratedTemplate,
} from './session-generator';
import { hydrateTemplate } from './session-generator';
import type { WarmupPlan } from './warmup-generator';
import type { CooldownPlan } from './cooldown-generator';

// =============================================================================
// Duration buckets
// =============================================================================

export type DurationBucket = 'under_20' | '20_45' | '45_75' | 'over_75';

export function durationBucket(min?: number): DurationBucket {
  if (min == null) return '20_45';
  if (min < 20) return 'under_20';
  if (min < 45) return '20_45';
  if (min < 75) return '45_75';
  return 'over_75';
}

// =============================================================================
// Session fallback library (12 templates: 3 goals × 4 buckets)
// =============================================================================

type FallbackKey = `${GoalProfile}:${DurationBucket}`;

const SESSION_LIBRARY: Partial<Record<FallbackKey, GeneratedTemplateShape>> = {
  'strength:under_20': {
    name: 'Quick Strength',
    description: 'Short heavy compound focus. Offline default.',
    goal_profile: 'strength',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 5, target_rpe: 8 }, { target_reps: 5, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }], default_rest_seconds: 150 },
      { exercise_slug: 'pushup', sets: [{ target_reps: 8 }, { target_reps: 8 }], default_rest_seconds: 90 },
    ],
  },
  'strength:20_45': {
    name: 'Standard Strength',
    description: 'Big-three primer with accessory. Offline default.',
    goal_profile: 'strength',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 5, target_rpe: 7 }, { target_reps: 5, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }, { target_reps: 3, target_rpe: 9 }], default_rest_seconds: 180 },
      { exercise_slug: 'benchpress', sets: [{ target_reps: 5, target_rpe: 7 }, { target_reps: 5, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }], default_rest_seconds: 180 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 5 }, { target_reps: 5 }], default_rest_seconds: 120 },
    ],
  },
  'strength:45_75': {
    name: 'Full Strength Block',
    description: 'Squat + bench + deadlift triple with accessories. Offline default.',
    goal_profile: 'strength',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 5, target_rpe: 7 }, { target_reps: 5, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }, { target_reps: 3, target_rpe: 9 }], default_rest_seconds: 180 },
      { exercise_slug: 'benchpress', sets: [{ target_reps: 5, target_rpe: 7 }, { target_reps: 5, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }], default_rest_seconds: 180 },
      { exercise_slug: 'deadlift', sets: [{ target_reps: 3, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }], default_rest_seconds: 240 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 6 }, { target_reps: 6 }, { target_reps: 5 }], default_rest_seconds: 120 },
    ],
  },
  'strength:over_75': {
    name: 'Extended Strength Day',
    description: 'Long heavy session with accessories + finisher. Offline default.',
    goal_profile: 'strength',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 5, target_rpe: 7 }, { target_reps: 5, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }, { target_reps: 3, target_rpe: 9 }, { target_reps: 1, target_rpe: 9 }], default_rest_seconds: 210 },
      { exercise_slug: 'benchpress', sets: [{ target_reps: 5, target_rpe: 7 }, { target_reps: 5, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }, { target_reps: 3, target_rpe: 9 }], default_rest_seconds: 180 },
      { exercise_slug: 'deadlift', sets: [{ target_reps: 3, target_rpe: 8 }, { target_reps: 3, target_rpe: 9 }, { target_reps: 1, target_rpe: 9 }], default_rest_seconds: 240 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 6 }, { target_reps: 6 }, { target_reps: 5 }], default_rest_seconds: 120 },
      { exercise_slug: 'rdl', sets: [{ target_reps: 8 }, { target_reps: 8 }], default_rest_seconds: 120 },
    ],
  },

  'hypertrophy:under_20': {
    name: 'Quick Hypertrophy',
    description: 'Short high-density push/pull pairing. Offline default.',
    goal_profile: 'hypertrophy',
    exercises: [
      { exercise_slug: 'pushup', sets: [{ target_reps: 12 }, { target_reps: 10 }, { target_reps: 8 }], default_rest_seconds: 60 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 6 }, { target_reps: 5 }], default_rest_seconds: 75 },
    ],
  },
  'hypertrophy:20_45': {
    name: 'Hypertrophy Standard',
    description: 'Upper-body pump session. Offline default.',
    goal_profile: 'hypertrophy',
    exercises: [
      { exercise_slug: 'benchpress', sets: [{ target_reps: 8, target_rpe: 7 }, { target_reps: 8, target_rpe: 8 }, { target_reps: 8, target_rpe: 8 }, { target_reps: 6, target_rpe: 9 }], default_rest_seconds: 90 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 8 }, { target_reps: 8 }, { target_reps: 6 }], default_rest_seconds: 90 },
      { exercise_slug: 'pushup', sets: [{ target_reps: 12 }, { target_reps: 10 }], default_rest_seconds: 60 },
    ],
  },
  'hypertrophy:45_75': {
    name: 'Hypertrophy Full Session',
    description: 'Full-volume hypertrophy day. Offline default.',
    goal_profile: 'hypertrophy',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 10, target_rpe: 7 }, { target_reps: 10, target_rpe: 8 }, { target_reps: 8, target_rpe: 9 }], default_rest_seconds: 90 },
      { exercise_slug: 'benchpress', sets: [{ target_reps: 8, target_rpe: 7 }, { target_reps: 8, target_rpe: 8 }, { target_reps: 8, target_rpe: 8 }], default_rest_seconds: 90 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 8 }, { target_reps: 8 }, { target_reps: 6 }], default_rest_seconds: 90 },
      { exercise_slug: 'rdl', sets: [{ target_reps: 10 }, { target_reps: 10 }], default_rest_seconds: 90 },
    ],
  },
  'hypertrophy:over_75': {
    name: 'Hypertrophy Long Day',
    description: 'Maximum volume + accessories. Offline default.',
    goal_profile: 'hypertrophy',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 10, target_rpe: 7 }, { target_reps: 10, target_rpe: 8 }, { target_reps: 10, target_rpe: 8 }, { target_reps: 8, target_rpe: 9 }], default_rest_seconds: 90 },
      { exercise_slug: 'benchpress', sets: [{ target_reps: 8, target_rpe: 7 }, { target_reps: 8, target_rpe: 8 }, { target_reps: 8, target_rpe: 8 }, { target_reps: 6, target_rpe: 9 }], default_rest_seconds: 90 },
      { exercise_slug: 'deadlift', sets: [{ target_reps: 5, target_rpe: 8 }, { target_reps: 5, target_rpe: 9 }], default_rest_seconds: 150 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 8 }, { target_reps: 8 }, { target_reps: 6 }], default_rest_seconds: 90 },
      { exercise_slug: 'pushup', sets: [{ target_reps: 15 }, { target_reps: 12 }, { target_reps: 10 }], default_rest_seconds: 60 },
    ],
  },

  'endurance:under_20': {
    name: 'Quick Conditioning',
    description: 'Dense bodyweight circuit. Offline default.',
    goal_profile: 'endurance',
    exercises: [
      { exercise_slug: 'pushup', sets: [{ target_reps: 15 }, { target_reps: 15 }, { target_reps: 12 }], default_rest_seconds: 45 },
      { exercise_slug: 'squat', sets: [{ target_reps: 20 }, { target_reps: 20 }, { target_reps: 15 }], default_rest_seconds: 45 },
    ],
  },
  'endurance:20_45': {
    name: 'Endurance Standard',
    description: 'Full-body circuit, short rest. Offline default.',
    goal_profile: 'endurance',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 20 }, { target_reps: 20 }, { target_reps: 15 }], default_rest_seconds: 45 },
      { exercise_slug: 'pushup', sets: [{ target_reps: 15 }, { target_reps: 15 }, { target_reps: 12 }], default_rest_seconds: 45 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 8 }, { target_reps: 6 }, { target_reps: 5 }], default_rest_seconds: 60 },
    ],
  },
  'endurance:45_75': {
    name: 'Endurance Full',
    description: 'Extended bodyweight circuit. Offline default.',
    goal_profile: 'endurance',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 20 }, { target_reps: 20 }, { target_reps: 20 }, { target_reps: 15 }], default_rest_seconds: 45 },
      { exercise_slug: 'pushup', sets: [{ target_reps: 15 }, { target_reps: 15 }, { target_reps: 15 }, { target_reps: 12 }], default_rest_seconds: 45 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 8 }, { target_reps: 8 }, { target_reps: 6 }, { target_reps: 5 }], default_rest_seconds: 60 },
      { exercise_slug: 'farmers_walk', sets: [{ target_seconds: 60 }, { target_seconds: 60 }], default_rest_seconds: 60 },
    ],
  },
  'endurance:over_75': {
    name: 'Endurance Long Day',
    description: 'Extended conditioning + carries. Offline default.',
    goal_profile: 'endurance',
    exercises: [
      { exercise_slug: 'squat', sets: [{ target_reps: 20 }, { target_reps: 20 }, { target_reps: 20 }, { target_reps: 20 }, { target_reps: 15 }], default_rest_seconds: 45 },
      { exercise_slug: 'pushup', sets: [{ target_reps: 15 }, { target_reps: 15 }, { target_reps: 15 }, { target_reps: 12 }], default_rest_seconds: 45 },
      { exercise_slug: 'pullup', sets: [{ target_reps: 8 }, { target_reps: 8 }, { target_reps: 6 }, { target_reps: 5 }], default_rest_seconds: 60 },
      { exercise_slug: 'farmers_walk', sets: [{ target_seconds: 90 }, { target_seconds: 90 }, { target_seconds: 60 }], default_rest_seconds: 60 },
      { exercise_slug: 'dead_hang', sets: [{ target_seconds: 30 }, { target_seconds: 30 }], default_rest_seconds: 60 },
    ],
  },
};

// =============================================================================
// Public API — session fallback
// =============================================================================

export interface FallbackLookupInput {
  goalProfile?: GoalProfile;
  durationMin?: number;
}

/**
 * Look up a deterministic fallback template for a given goal + duration.
 * Falls back to 'hypertrophy' + '20_45' when an exact match is absent.
 */
export function getSessionFallbackShape(input: FallbackLookupInput): GeneratedTemplateShape {
  const goal: GoalProfile = input.goalProfile ?? 'hypertrophy';
  const bucket = durationBucket(input.durationMin);
  const key = `${goal}:${bucket}` as FallbackKey;
  const shape = SESSION_LIBRARY[key] ?? SESSION_LIBRARY['hypertrophy:20_45'];
  if (!shape) throw new Error('session fallback library is empty');
  return shape;
}

/**
 * Same as getSessionFallbackShape but hydrated into a WorkoutTemplate tree.
 */
export function getSessionFallback(
  input: FallbackLookupInput,
  runtime: { userId: string; uuid?: () => string },
): HydratedTemplate {
  const shape = getSessionFallbackShape(input);
  return hydrateTemplate(shape, runtime);
}

export function listSessionFallbackKeys(): FallbackKey[] {
  return Object.keys(SESSION_LIBRARY) as FallbackKey[];
}

// =============================================================================
// Warmup + cooldown fallbacks
// =============================================================================

export function getWarmupFallback(): WarmupPlan {
  return {
    name: 'Default Warmup',
    duration_min: 6,
    movements: [
      { name: 'Cat-cow', duration_seconds: 60, focus: 'mobility', intensity: 'low' },
      { name: 'Arm circles', duration_seconds: 45, focus: 'mobility', intensity: 'low' },
      { name: 'Bodyweight squat', reps: 10, focus: 'activation', intensity: 'low' },
      { name: 'Pushup', reps: 8, focus: 'activation', intensity: 'medium' },
    ],
  };
}

export function getCooldownFallback(): CooldownPlan {
  return {
    name: 'Default Cooldown',
    duration_min: 7,
    movements: [
      { name: 'Child pose', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
      { name: 'Pigeon pose (each side)', duration_seconds: 90, focus: 'stretch', intensity: 'low' },
      { name: 'Forward fold', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
      { name: 'Box breathing', duration_seconds: 60, focus: 'breathing', intensity: 'low' },
    ],
    reflection_prompt: 'How did the session feel overall? Rate RPE 1-10.',
  };
}

// =============================================================================
// withFallback helper
// =============================================================================

/**
 * Wraps an async generator so the UI always receives a value. If `fn` rejects
 * or throws, returns `fallback()` instead. The error is passed to an optional
 * `onFallback` callback for telemetry.
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  fallback: () => T,
  onFallback?: (error: unknown) => void,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    onFallback?.(error);
    return fallback();
  }
}

/**
 * Crypto.randomUUID helper exported for callers who want a hydrated fallback
 * without needing to import expo-crypto directly.
 */
export function fallbackUuid(): string {
  return Crypto.randomUUID();
}
