import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext, WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';

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
