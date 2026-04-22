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
import { createError, logError } from '@/lib/services/ErrorHandler';

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

/**
 * Form targets paired with a provenance flag so callers can surface a
 * subtle "generic thresholds in use" badge when a template typo (or a
 * custom exerciseId) falls back to `DEFAULT_FORM_TARGETS`.
 */
export interface FormTargetsResolution {
  targets: FormTargets;
  /**
   * True when the returned `targets` are the conservative
   * `DEFAULT_FORM_TARGETS` fallback (unknown exerciseId / non-string).
   * False when either a per-exercise default or a template override matched.
   */
  usingGenericTargets: boolean;
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
  return resolveFormTargetsWithFlag(exerciseId, template).targets;
}

/**
 * Like `resolveFormTargets()` but also returns the `usingGenericTargets`
 * provenance flag propagated up from `getDefaultsForExerciseWithFlag()`.
 * A template override that backs onto generic defaults still flips the
 * flag when the exerciseId itself is unknown — template authors should
 * know their per-exercise thresholds are being combined with the
 * permissive baseline.
 */
export function resolveFormTargetsWithFlag(
  exerciseId: string,
  template?: (WorkoutTemplate & { exercises?: WorkoutTemplateExercise[] }) | null,
): FormTargetsResolution {
  const baseResolution = getDefaultsForExerciseWithFlag(exerciseId);
  const base = baseResolution.targets;

  if (!template || !template.exercises || template.exercises.length === 0) {
    return baseResolution;
  }

  const override = template.exercises.find(
    (e) => e && e.exercise_id === exerciseId,
  );
  if (!override) return baseResolution;

  return {
    targets: {
      fqiMin: pickNumber(override.target_fqi_min, base.fqiMin),
      romMin: pickNumber(override.target_rom_min, base.romMin),
      romMax: pickNumber(override.target_rom_max, base.romMax),
    },
    usingGenericTargets: baseResolution.usingGenericTargets,
  };
}

/**
 * Get the baseline defaults for an exercise (no template override).
 * Exported for tests and for callers that don't yet have a template context.
 *
 * When `exerciseId` is unknown, the conservative `DEFAULT_FORM_TARGETS`
 * fallback is returned AND a `logError()` observability signal is emitted
 * once per unknown id (module-level dedupe) so template typos (e.g.
 * `exercise_id: "pullups"` vs. `"pullup"`) don't silently degrade FQI
 * thresholds in production. Callers that want the provenance flag
 * structurally (for a "Generic thresholds in use" UI badge) should use
 * `getDefaultsForExerciseWithFlag()` instead.
 */
export function getDefaultsForExercise(exerciseId: string): FormTargets {
  return getDefaultsForExerciseWithFlag(exerciseId).targets;
}

/**
 * Like `getDefaultsForExercise()` but also returns a `usingGenericTargets`
 * flag so the caller (e.g. scan-arkit overlay) can surface a subtle badge
 * when the exerciseId didn't match any first-class exercise entry.
 */
export function getDefaultsForExerciseWithFlag(
  exerciseId: string,
): FormTargetsResolution {
  if (!exerciseId || typeof exerciseId !== 'string') {
    maybeLogUnknownExercise(exerciseId, 'invalid-id');
    return { targets: DEFAULT_FORM_TARGETS, usingGenericTargets: true };
  }
  const key = exerciseId.trim().toLowerCase();
  const match = EXERCISE_DEFAULTS[key];
  if (match) {
    return { targets: match, usingGenericTargets: false };
  }
  maybeLogUnknownExercise(exerciseId, 'no-match');
  return { targets: DEFAULT_FORM_TARGETS, usingGenericTargets: true };
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

/**
 * Log-once-per-id observability for the generic-targets fallback so
 * dashboards surface misconfigured templates without spamming a single
 * unknown id on every render.
 */
const loggedUnknownExerciseIds = new Set<string>();
/**
 * Test-only escape hatch to reset the dedupe Set between cases.
 */
export function __resetUnknownExerciseLogForTests(): void {
  loggedUnknownExerciseIds.clear();
}

function maybeLogUnknownExercise(
  exerciseId: unknown,
  reason: 'invalid-id' | 'no-match',
): void {
  const key = typeof exerciseId === 'string' ? exerciseId.trim().toLowerCase() : `__${reason}__`;
  if (loggedUnknownExerciseIds.has(key)) return;
  loggedUnknownExerciseIds.add(key);
  logError(
    createError(
      'form-tracking',
      'FORM_TARGET_FALLBACK_GENERIC',
      'Unknown exerciseId fell back to generic DEFAULT_FORM_TARGETS — FQI thresholds may be too permissive.',
      {
        details: { exerciseId, reason },
        severity: 'warning',
        retryable: false,
      },
    ),
    { feature: 'form-tracking', location: 'lib/services/form-target-resolver' },
  );
}
