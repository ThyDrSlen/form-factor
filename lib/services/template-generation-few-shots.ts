/**
 * Template Generation Few-Shots
 *
 * Hard-coded exemplars used to prime the LLM for each generator domain.
 * Indexed by domain (session / warmup / cooldown / rest) and optional filters
 * (goalProfile, durationMin). Returned examples are copy-adapted from real
 * Form Factor workout templates.
 */
import type { GoalProfile } from '@/lib/types/workout-session';

// =============================================================================
// Types
// =============================================================================

export type FewShotDomain = 'session' | 'warmup' | 'cooldown' | 'rest';

export interface FewShotExample {
  /** NL prompt the user (or caller) would provide. */
  readonly prompt: string;
  /** Expected JSON response the LLM should emit for this prompt. */
  readonly response: string;
  /** Optional metadata for filtering. */
  readonly goalProfile?: GoalProfile;
  readonly durationMin?: number;
  readonly tags?: readonly string[];
}

export interface FewShotQuery {
  domain: FewShotDomain;
  goalProfile?: GoalProfile;
  /** Target duration in minutes (applies to session/warmup/cooldown). */
  durationMin?: number;
  /** Max examples to return. Default 3. */
  limit?: number;
}

// =============================================================================
// Session examples
// =============================================================================

const SESSION_EXAMPLES: FewShotExample[] = [
  {
    prompt: 'Full-body bodyweight, 20 minutes, home, no equipment',
    goalProfile: 'endurance',
    durationMin: 20,
    tags: ['bodyweight', 'home', 'full_body'],
    response: JSON.stringify({
      name: 'Home Full-Body Flow',
      description: '20-minute bodyweight circuit hitting push / pull / legs.',
      goal_profile: 'endurance',
      exercises: [
        { exercise_slug: 'pushup', sets: [{ target_reps: 12, target_rpe: 7 }, { target_reps: 10, target_rpe: 8 }, { target_reps: 8, target_rpe: 8 }], default_rest_seconds: 60 },
        { exercise_slug: 'pullup', sets: [{ target_reps: 6, target_rpe: 8 }, { target_reps: 5, target_rpe: 8 }, { target_reps: 5, target_rpe: 9 }], default_rest_seconds: 75 },
        { exercise_slug: 'squat', sets: [{ target_reps: 15, target_rpe: 7 }, { target_reps: 15, target_rpe: 8 }, { target_reps: 12, target_rpe: 8 }], default_rest_seconds: 60 },
      ],
    }),
  },
  {
    prompt: 'Bench + rows, 45 minutes, barbell, hypertrophy',
    goalProfile: 'hypertrophy',
    durationMin: 45,
    tags: ['barbell', 'push', 'pull'],
    response: JSON.stringify({
      name: 'Bench & Row — Hypertrophy',
      description: '45-minute chest + back hypertrophy block.',
      goal_profile: 'hypertrophy',
      exercises: [
        { exercise_slug: 'benchpress', sets: [{ target_reps: 8, target_weight: 135, target_rpe: 7 }, { target_reps: 8, target_weight: 135, target_rpe: 8 }, { target_reps: 8, target_weight: 135, target_rpe: 8 }, { target_reps: 6, target_weight: 145, target_rpe: 9 }], default_rest_seconds: 90 },
        { exercise_slug: 'pullup', sets: [{ target_reps: 8, target_rpe: 8 }, { target_reps: 8, target_rpe: 8 }, { target_reps: 6, target_rpe: 9 }], default_rest_seconds: 90 },
      ],
    }),
  },
  {
    prompt: 'Heavy lower, strength, 60 minutes',
    goalProfile: 'strength',
    durationMin: 60,
    tags: ['barbell', 'legs', 'compound'],
    response: JSON.stringify({
      name: 'Lower Strength Day',
      description: '60-minute heavy squat + deadlift session.',
      goal_profile: 'strength',
      exercises: [
        { exercise_slug: 'squat', sets: [{ target_reps: 5, target_weight: 225, target_rpe: 7 }, { target_reps: 5, target_weight: 245, target_rpe: 8 }, { target_reps: 3, target_weight: 265, target_rpe: 9 }, { target_reps: 3, target_weight: 265, target_rpe: 9 }], default_rest_seconds: 180 },
        { exercise_slug: 'deadlift', sets: [{ target_reps: 5, target_weight: 275, target_rpe: 7 }, { target_reps: 3, target_weight: 315, target_rpe: 8 }, { target_reps: 1, target_weight: 355, target_rpe: 9 }], default_rest_seconds: 240 },
        { exercise_slug: 'rdl', sets: [{ target_reps: 8, target_weight: 185, target_rpe: 7 }, { target_reps: 8, target_weight: 185, target_rpe: 8 }], default_rest_seconds: 120 },
      ],
    }),
  },
  {
    prompt: 'Quick push day, 15 minutes',
    durationMin: 15,
    tags: ['short', 'push'],
    response: JSON.stringify({
      name: 'Quick Push',
      description: 'Fast 15-minute push stimulus.',
      goal_profile: 'hypertrophy',
      exercises: [
        { exercise_slug: 'pushup', sets: [{ target_reps: 15 }, { target_reps: 12 }, { target_reps: 10 }], default_rest_seconds: 45 },
        { exercise_slug: 'benchpress', sets: [{ target_reps: 8, target_weight: 115 }, { target_reps: 8, target_weight: 115 }], default_rest_seconds: 90 },
      ],
    }),
  },
];

// =============================================================================
// Warmup examples
// =============================================================================

const WARMUP_EXAMPLES: FewShotExample[] = [
  {
    prompt: 'Warmup for squat + deadlift session',
    durationMin: 8,
    tags: ['lower', 'mobility'],
    response: JSON.stringify({
      name: 'Lower Warmup',
      duration_min: 8,
      movements: [
        { name: 'Cat-cow', duration_seconds: 60, focus: 'mobility', intensity: 'low' },
        { name: 'Hip flexor stretch', duration_seconds: 45, focus: 'mobility', intensity: 'low' },
        { name: 'Bodyweight squat', reps: 10, focus: 'activation', intensity: 'low' },
        { name: 'Glute bridge', reps: 12, focus: 'activation', intensity: 'low' },
        { name: 'Empty-bar squat', reps: 8, focus: 'activation', intensity: 'medium' },
      ],
    }),
  },
  {
    prompt: 'Warmup for bench + pullup upper body',
    durationMin: 6,
    tags: ['upper', 'push', 'pull'],
    response: JSON.stringify({
      name: 'Upper Warmup',
      duration_min: 6,
      movements: [
        { name: 'Arm circles', duration_seconds: 45, focus: 'mobility', intensity: 'low' },
        { name: 'Scapular pullup', reps: 10, focus: 'activation', intensity: 'low' },
        { name: 'Banded pull-apart', reps: 15, focus: 'activation', intensity: 'low' },
        { name: 'Pushup', reps: 10, focus: 'activation', intensity: 'medium' },
      ],
    }),
  },
  {
    prompt: 'Full-body warmup, 5 minutes',
    durationMin: 5,
    tags: ['full_body'],
    response: JSON.stringify({
      name: 'Quick Full-Body Warmup',
      duration_min: 5,
      movements: [
        { name: 'Jumping jacks', duration_seconds: 60, focus: 'cardio', intensity: 'medium' },
        { name: 'Worlds greatest stretch', reps: 6, focus: 'mobility', intensity: 'low' },
        { name: 'Inchworm', reps: 6, focus: 'mobility', intensity: 'medium' },
        { name: 'Bodyweight squat', reps: 12, focus: 'activation', intensity: 'low' },
      ],
    }),
  },
];

// =============================================================================
// Cooldown examples
// =============================================================================

const COOLDOWN_EXAMPLES: FewShotExample[] = [
  {
    prompt: 'Cooldown after lower body + heavy deadlifts',
    durationMin: 8,
    tags: ['lower'],
    response: JSON.stringify({
      name: 'Lower Cooldown',
      duration_min: 8,
      movements: [
        { name: 'Child\'s pose', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
        { name: 'Pigeon pose (each side)', duration_seconds: 90, focus: 'stretch', intensity: 'low' },
        { name: 'Supine spinal twist', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
        { name: 'Forward fold', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
      ],
      reflection_prompt: 'Rate overall session RPE and note anything that felt off.',
    }),
  },
  {
    prompt: 'Cooldown after bench + rows, 5 min',
    durationMin: 5,
    tags: ['upper'],
    response: JSON.stringify({
      name: 'Upper Cooldown',
      duration_min: 5,
      movements: [
        { name: 'Doorway pec stretch', duration_seconds: 45, focus: 'stretch', intensity: 'low' },
        { name: 'Cross-body shoulder stretch', duration_seconds: 45, focus: 'stretch', intensity: 'low' },
        { name: 'Thread the needle', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
        { name: 'Box breathing', duration_seconds: 60, focus: 'breathing', intensity: 'low' },
      ],
      reflection_prompt: 'How did bench weight feel vs. last session?',
    }),
  },
  {
    prompt: 'Cooldown, high-RPE session',
    durationMin: 10,
    tags: ['recovery'],
    response: JSON.stringify({
      name: 'Recovery Cooldown',
      duration_min: 10,
      movements: [
        { name: 'Walking cooldown', duration_seconds: 180, focus: 'cardio', intensity: 'low' },
        { name: 'Foam roll quads', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
        { name: 'Foam roll lats', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
        { name: 'Box breathing 4-4-4-4', duration_seconds: 120, focus: 'breathing', intensity: 'low' },
      ],
      reflection_prompt: 'Session RPE 1-10? Any cues worth noting for next time?',
    }),
  },
];

// =============================================================================
// Rest examples
// =============================================================================

const REST_EXAMPLES: FewShotExample[] = [
  {
    prompt: 'Rep tempo 2800ms, HR 152bpm, RPE 8',
    tags: ['strength'],
    response: JSON.stringify({
      seconds: 180,
      reasoning: 'High RPE + elevated HR + slow final rep suggests near-max fatigue. 3:00 rest preserves quality on next heavy set.',
    }),
  },
  {
    prompt: 'Rep tempo 1600ms, HR 128bpm, RPE 6',
    tags: ['hypertrophy'],
    response: JSON.stringify({
      seconds: 90,
      reasoning: 'Moderate fatigue, HR recovering normally. 90s maintains density without quality drop.',
    }),
  },
  {
    prompt: 'Rep tempo 900ms, HR not available, RPE 5',
    tags: ['endurance'],
    response: JSON.stringify({
      seconds: 45,
      reasoning: 'Fast tempo + low RPE — short rest preserves conditioning stimulus.',
    }),
  },
];

// =============================================================================
// Registry
// =============================================================================

const REGISTRY: Record<FewShotDomain, FewShotExample[]> = {
  session: SESSION_EXAMPLES,
  warmup: WARMUP_EXAMPLES,
  cooldown: COOLDOWN_EXAMPLES,
  rest: REST_EXAMPLES,
};

/**
 * Look up few-shot examples for a generator domain with optional filtering.
 * Always returns at least one example per domain (falls back to the full set
 * if filters yield zero matches).
 */
export function getFewShots(query: FewShotQuery): FewShotExample[] {
  const pool = REGISTRY[query.domain] ?? [];
  if (pool.length === 0) return [];

  const scored = pool
    .map((ex) => {
      let score = 0;
      if (query.goalProfile && ex.goalProfile === query.goalProfile) score += 2;
      if (query.durationMin != null && ex.durationMin != null) {
        const diff = Math.abs(ex.durationMin - query.durationMin);
        score += Math.max(0, 3 - diff / 10);
      }
      return { ex, score };
    })
    .sort((a, b) => b.score - a.score);

  const limit = Math.max(1, query.limit ?? 3);
  const top = scored.slice(0, limit).map((s) => s.ex);

  return top.length > 0 ? top : pool.slice(0, limit);
}

/** Simple accessor for tests / direct callers. */
export function getAllFewShots(domain: FewShotDomain): FewShotExample[] {
  return REGISTRY[domain] ?? [];
}
