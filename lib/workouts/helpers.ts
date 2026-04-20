import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { AngleRange, RepContext, WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';

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

/**
 * Defensively average two joint angle readings.
 *
 * Returns `null` when either input is missing or non-finite — callers must
 * treat `null` as "no signal" rather than letting NaN propagate into fault
 * thresholds (root cause of #166 where `ctx.endAngles.leftKnee` was undefined
 * and `NaN < threshold` silently evaluated to `false`).
 */
export function safeAngleAverage(left: number | undefined, right: number | undefined): number | null {
  if (typeof left !== 'number' || !Number.isFinite(left)) return null;
  if (typeof right !== 'number' || !Number.isFinite(right)) return null;
  return (left + right) / 2;
}

/**
 * Safely extract both left/right angle components from a JointAngles-like
 * record. Returns `null` if the source snapshot is missing or either side
 * is non-finite. Use this when building fault conditions that depend on a
 * bilateral average of end/min/max angles.
 */
export function safeJointPair(
  source: JointAngles | undefined | null,
  leftKey: keyof JointAngles,
  rightKey: keyof JointAngles,
): { left: number; right: number } | null {
  if (!source) return null;
  const left = source[leftKey];
  const right = source[rightKey];
  if (typeof left !== 'number' || !Number.isFinite(left)) return null;
  if (typeof right !== 'number' || !Number.isFinite(right)) return null;
  return { left, right };
}

/**
 * Shortcut for `safeAngleAverage(source?.[left], source?.[right])`.
 *
 * Example:
 *   const endKnee = averageJointPair(ctx.endAngles, 'leftKnee', 'rightKnee');
 *   if (endKnee === null) return false; // treat missing signal as "no fault"
 */
export function averageJointPair(
  source: JointAngles | undefined | null,
  leftKey: keyof JointAngles,
  rightKey: keyof JointAngles,
): number | null {
  const pair = safeJointPair(source, leftKey, rightKey);
  return pair === null ? null : (pair.left + pair.right) / 2;
}

/**
 * Capture the final angle snapshot for a completed rep.
 *
 * The rep boundary transition ("end phase" is re-entered) is the canonical
 * moment to snapshot `endAngles`. Prior to this helper each workout captured
 * angles ad-hoc which left `RepContext.endAngles` undefined in edge paths
 * (e.g. fallback/degraded tracking modes) — see issue #166 / #417.
 */
export function captureEndAngles(angles: JointAngles): JointAngles {
  return {
    leftKnee: angles.leftKnee,
    rightKnee: angles.rightKnee,
    leftElbow: angles.leftElbow,
    rightElbow: angles.rightElbow,
    leftHip: angles.leftHip,
    rightHip: angles.rightHip,
    leftShoulder: angles.leftShoulder,
    rightShoulder: angles.rightShoulder,
  };
}

/**
 * Returns true if the RepContext has a usable endAngles snapshot.
 * Use at the top of any fault condition that reads `ctx.endAngles.*`.
 */
export function hasEndAngles(ctx: RepContext): boolean {
  const e = ctx.endAngles;
  if (!e || typeof e !== 'object') return false;
  // Require at least one finite reading in the snapshot
  for (const key of ['leftKnee', 'rightKnee', 'leftElbow', 'rightElbow', 'leftHip', 'rightHip', 'leftShoulder', 'rightShoulder'] as const) {
    const v = e[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return true;
    }
  }
  return false;
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
