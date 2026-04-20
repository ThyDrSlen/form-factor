/**
 * Form-Target Resolver
 *
 * Resolves the form-tracking targets (FQI minimum, range-of-motion min/max)
 * that the scan/ARKit pipeline should compare each rep against.
 *
 * Precedence (highest → lowest):
 *   1. Template-exercise override (`WorkoutTemplateExercise.target_fqi_min`, etc.)
 *   2. Exercise-specific defaults derived from `lib/workouts/<exercise>.ts` thresholds
 *   3. Conservative baseline fallback (generic exercise)
 *
 * The resolver is purely synchronous and pure — safe to call from render paths,
 * memoize hooks, or the Zustand session-runner store. It does not touch
 * Supabase, SQLite, or the filesystem.
 *
 * Issue #447 — W3-C item #1 (Per-exercise form targets in templates).
 */

import type {
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '@/lib/types/workout-session';

// =============================================================================
// Types
// =============================================================================

/**
 * Concrete form-tracking targets consumed by the scan/ARKit cue engine.
 */
export interface FormTargets {
  /** Minimum average FQI (0-100) to count as a "green" rep/set. */
  fqiMin: number;
  /** Minimum range-of-motion angle (degrees) — exercise dependent. */
  romMin: number;
  /** Maximum range-of-motion angle (degrees) — exercise dependent. */
  romMax: number;
}

// =============================================================================
// Exercise defaults
// =============================================================================

/**
 * Per-exercise defaults derived from the thresholds defined in
 * `lib/workouts/<exercise>.ts`. We intentionally keep these as plain literals
 * (rather than importing the full workout definitions) so the resolver has
 * zero dependency on the ARKit/fusion runtime and can run in any test harness.
 *
 * FQI minimums are sourced from product spec (90 = excellent, 80 = good,
 * 75 = acceptable). ROM ranges mirror the `top`/`hang` (or equivalent)
 * phase thresholds in each workout file.
 */
const EXERCISE_DEFAULTS: Readonly<Record<string, FormTargets>> = {
  // Pull-up — elbow angle at full hang (hang) to top (chin over bar).
  pullup: { fqiMin: 80, romMin: 85, romMax: 150 },
  // Push-up — elbow angle at top (extended) to bottom (chest near floor).
  pushup: { fqiMin: 80, romMin: 80, romMax: 160 },
  // Back squat — knee angle at top (standing) to bottom (hip below knee).
  squat: { fqiMin: 80, romMin: 90, romMax: 170 },
  // Conventional deadlift — hip angle at bottom (setup) to top (lockout).
  deadlift: { fqiMin: 80, romMin: 95, romMax: 170 },
  // Romanian deadlift — hinge depth; narrower ROM than conventional.
  rdl: { fqiMin: 78, romMin: 110, romMax: 170 },
  // Bench press — elbow angle at top (lockout) to bottom (bar to chest).
  benchpress: { fqiMin: 80, romMin: 70, romMax: 170 },
  // Dead hang — primarily a timed hold; ROM window is "stay extended".
  dead_hang: { fqiMin: 75, romMin: 150, romMax: 175 },
  // Farmer's walk — gait carry; ROM reflects upright posture window.
  farmers_walk: { fqiMin: 75, romMin: 160, romMax: 180 },
};

/**
 * Conservative fallback when we don't recognise the exerciseId.
 * Deliberately permissive so legacy/custom exercises still score something.
 */
export const DEFAULT_FORM_TARGETS: FormTargets = {
  fqiMin: 75,
  romMin: 60,
  romMax: 180,
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve the active form targets for an exercise, optionally overridden by
 * a template exercise configuration.
 *
 * Lookup order:
 *   1. If `template` contains a `WorkoutTemplateExercise` matching `exerciseId`
 *      with any of the `target_*` fields set, those values take precedence.
 *   2. Otherwise, fall back to `EXERCISE_DEFAULTS[exerciseId]`.
 *   3. Otherwise, return `DEFAULT_FORM_TARGETS`.
 *
 * When only a subset of override fields is present, the resolver fills the
 * missing axes from the defaults (so you can override just FQI without
 * having to also restate ROM bounds).
 *
 * @param exerciseId Exercise identifier (e.g. 'pullup', 'squat').
 * @param template Optional template + its exercises to search for overrides.
 */
export function resolveFormTargets(
  exerciseId: string,
  template?: (WorkoutTemplate & { exercises?: WorkoutTemplateExercise[] }) | null,
): FormTargets {
  const base = getDefaultsForExercise(exerciseId);

  if (!template || !template.exercises || template.exercises.length === 0) {
    return base;
  }

  const override = template.exercises.find(
    (e) => e && e.exercise_id === exerciseId,
  );
  if (!override) return base;

  return {
    fqiMin: pickNumber(override.target_fqi_min, base.fqiMin),
    romMin: pickNumber(override.target_rom_min, base.romMin),
    romMax: pickNumber(override.target_rom_max, base.romMax),
  };
}

/**
 * Get the baseline defaults for an exercise (no template override).
 * Exported for tests and for callers that don't yet have a template context.
 */
export function getDefaultsForExercise(exerciseId: string): FormTargets {
  if (!exerciseId || typeof exerciseId !== 'string') {
    return DEFAULT_FORM_TARGETS;
  }
  const key = exerciseId.trim().toLowerCase();
  return EXERCISE_DEFAULTS[key] ?? DEFAULT_FORM_TARGETS;
}

/**
 * Whether the given exerciseId has first-class defaults. Useful for UI that
 * wants to flag "custom" exercises where the user may want to set overrides.
 */
export function hasFormTargetDefaults(exerciseId: string): boolean {
  if (!exerciseId) return false;
  return exerciseId.trim().toLowerCase() in EXERCISE_DEFAULTS;
}

// =============================================================================
// Internal helpers
// =============================================================================

function pickNumber(candidate: number | null | undefined, fallback: number): number {
  if (candidate === null || candidate === undefined) return fallback;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return fallback;
  return candidate;
}
