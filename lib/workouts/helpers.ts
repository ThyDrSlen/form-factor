import type { AngleRange, WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';

export function getPhaseStaticCue<P extends string, M extends WorkoutMetrics>(
  definition: WorkoutDefinition<P, M>,
  phaseId: P
): string | null;
export function getPhaseStaticCue(
  definition: WorkoutDefinition<any, any>,
  phaseId: string
): string | null;
export function getPhaseStaticCue(
  definition: WorkoutDefinition<any, any>,
  phaseId: string
): string | null {
  return definition.phases.find((phase) => phase.id === phaseId)?.staticCue ?? null;
}

// =============================================================================
// Validation helpers (shared between workouts)
// =============================================================================

/**
 * Type guard: returns true iff value is a finite number (not NaN, not Infinity).
 * Safer than `Number.isFinite` in strict-typed code because it narrows the type.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Returns true iff the asymmetry between `left` and `right` exceeds `maxDiffPct`
 * (expressed as a percentage, 0-100) of the larger of the two magnitudes.
 *
 * NaN-safe: returns `false` on any non-finite input or when both sides are zero.
 *
 * @example
 *   asymmetryCheck(90, 110, 15) // true — 20° diff > 15% of 110
 *   asymmetryCheck(100, 98, 5) // false — 2° diff well under 5% of 100
 *   asymmetryCheck(NaN, 90, 10) // false — bad input
 */
export function asymmetryCheck(left: number, right: number, maxDiffPct: number): boolean {
  if (!isFiniteNumber(left) || !isFiniteNumber(right) || !isFiniteNumber(maxDiffPct)) {
    return false;
  }
  if (maxDiffPct < 0) {
    return false;
  }
  const larger = Math.max(Math.abs(left), Math.abs(right));
  if (larger === 0) {
    return false;
  }
  const diff = Math.abs(left - right);
  const pct = (diff / larger) * 100;
  return pct > maxDiffPct;
}

/**
 * Returns `true` iff the sequencing between two joints is faulty.
 *
 * A sequencing fault occurs when the joint expected to lead the movement does
 * NOT move more than the lagging joint. For example, in a deadlift the hips
 * should rise before the shoulders — if the shoulder delta outpaces the hip
 * delta (i.e. the back rounds), this returns `true`.
 *
 * @param primaryStart starting angle of the primary (should-lead) joint
 * @param primaryMax peak angle of the primary joint during the movement
 * @param secondaryStart starting angle of the secondary (should-follow) joint
 * @param secondaryMax peak angle of the secondary joint during the movement
 * @param shouldPrimaryRiseFirst when `true`, the primary is expected to move
 *   *more* than the secondary; when `false`, the check is inverted.
 *
 * NaN-safe: returns `false` on any non-finite input.
 */
export function sequenceCheck(
  primaryStart: number,
  primaryMax: number,
  secondaryStart: number,
  secondaryMax: number,
  shouldPrimaryRiseFirst: boolean
): boolean {
  if (
    !isFiniteNumber(primaryStart) ||
    !isFiniteNumber(primaryMax) ||
    !isFiniteNumber(secondaryStart) ||
    !isFiniteNumber(secondaryMax)
  ) {
    return false;
  }
  const primaryDelta = Math.abs(primaryMax - primaryStart);
  const secondaryDelta = Math.abs(secondaryMax - secondaryStart);
  if (shouldPrimaryRiseFirst) {
    return primaryDelta < secondaryDelta;
  }
  return primaryDelta > secondaryDelta;
}

/**
 * Returns `true` iff `angle` sits inside `[range.min, range.max]`.
 *
 * Note: this is an inclusive range check and does NOT incorporate `optimal`
 * or `tolerance`; use those fields separately when building fault conditions
 * that need to penalize deviation from an optimal target.
 *
 * NaN-safe: returns `false` on any non-finite `angle` or malformed range.
 */
export function validateAngleInRange(angle: number, range: AngleRange): boolean {
  if (!isFiniteNumber(angle) || !range) {
    return false;
  }
  if (!isFiniteNumber(range.min) || !isFiniteNumber(range.max)) {
    return false;
  }
  if (range.max < range.min) {
    return false;
  }
  return angle >= range.min && angle <= range.max;
}

/**
 * NaN-safe delta between two scalars.
 *
 * Returns `0` if either value is non-finite. Useful for building fault
 * conditions that reference `maxAngles.x - startAngles.x` without littering
 * guards throughout the workout files.
 */
export function clampedDelta(from: number, to: number): number {
  if (!isFiniteNumber(from) || !isFiniteNumber(to)) {
    return 0;
  }
  return to - from;
}
