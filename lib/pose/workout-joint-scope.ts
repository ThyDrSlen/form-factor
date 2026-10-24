import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';

// upLeg is the ARKit hip joint, not the knee. Keep it and the pelvis.
const LOWER_LEG_JOINT = /^(left|right)_(leg|knee|ankle|foot|toe\w*)(?:_joint)?$/i;

/** Scope raw 2D consumers (framing, identity, occlusion) before any display holds. */
export function jointsForWorkout(joints: readonly Joint2D[], workoutId: string): Joint2D[] {
  return workoutId === 'dumbbell_curl'
    ? joints.filter(joint => !LOWER_LEG_JOINT.test(joint.name))
    : [...joints];
}
