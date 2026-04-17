/**
 * Parametric fault harness — combined #441 + #459
 *
 * Exercises every registered fault in every workout definition under three
 * synthetic conditions:
 *
 *   1. A per-workout "ideal rep" `RepContext` is handed to every fault; each
 *      fault must return `false`. This is a sanity baseline — if any fault
 *      mis-fires on a good rep, it needs thresholds re-tuned.
 *   2. For every fault with a well-defined biomechanical trigger, a minimal
 *      "triggering" RepContext asserts that the fault returns `true`. Covers
 *      all 6 lunge faults + 6 dead-hang faults + 24 faults across the 6
 *      movements added by #459, plus a curated set from the original 8.
 *   3. NaN-angles guard — every fault must return `false` on fully-NaN input
 *      (duration-only faults are filtered since they don't read angle data).
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { FaultDefinition, RepContext, WorkoutDefinition } from '@/lib/types/workout-definitions';
import { workoutsByMode, type DetectionMode } from '@/lib/workouts';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Per-workout "ideal rep" angle snapshots. Each position is hand-picked to
 * sit well inside every known fault's non-triggering envelope.
 */
interface IdealProfile {
  start: JointAngles;
  end: JointAngles;
  min: JointAngles;
  max: JointAngles;
  durationMs: number;
}

function joints(a: Partial<JointAngles>): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 95,
    rightShoulder: 95,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
    ...a,
  };
}

const IDEAL_PROFILES: Record<DetectionMode, IdealProfile> = {
  pullup: {
    start: joints({ leftElbow: 165, rightElbow: 165, leftShoulder: 100, rightShoulder: 100 }),
    end: joints({ leftElbow: 165, rightElbow: 165 }),
    // top of pullup = elbow flexed to ~80°
    min: joints({ leftElbow: 82, rightElbow: 85 }),
    max: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 115, rightShoulder: 115 }),
    durationMs: 2500,
  },
  pushup: {
    start: joints({ leftElbow: 165, rightElbow: 165, leftHip: 175, rightHip: 175 }),
    end: joints({ leftElbow: 165, rightElbow: 165, leftHip: 175, rightHip: 175 }),
    min: joints({ leftElbow: 90, rightElbow: 92, leftHip: 172, rightHip: 172 }),
    max: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 110, rightShoulder: 110, leftHip: 175, rightHip: 175 }),
    durationMs: 1800,
  },
  squat: {
    start: joints({ leftKnee: 170, rightKnee: 170, leftHip: 175, rightHip: 175 }),
    end: joints({ leftKnee: 170, rightKnee: 170 }),
    min: joints({ leftKnee: 88, rightKnee: 90, leftHip: 90, rightHip: 90 }),
    max: joints({ leftKnee: 175, rightKnee: 175, leftHip: 180, rightHip: 180 }),
    durationMs: 2800,
  },
  deadlift: {
    start: joints({ leftHip: 105, rightHip: 105, leftKnee: 125, rightKnee: 125 }),
    end: joints({ leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170 }),
    min: joints({ leftHip: 105, rightHip: 105, leftKnee: 125, rightKnee: 125, leftShoulder: 85, rightShoulder: 85 }),
    max: joints({ leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170, leftShoulder: 95, rightShoulder: 95 }),
    durationMs: 2500,
  },
  rdl: {
    start: joints({ leftHip: 175, rightHip: 175, leftKnee: 160, rightKnee: 160 }),
    end: joints({ leftHip: 170, rightHip: 170, leftKnee: 160, rightKnee: 160 }),
    min: joints({ leftHip: 95, rightHip: 95, leftKnee: 150, rightKnee: 150, leftShoulder: 100, rightShoulder: 100 }),
    max: joints({ leftHip: 175, rightHip: 175, leftKnee: 170, rightKnee: 170, leftShoulder: 115, rightShoulder: 115 }),
    durationMs: 3500,
  },
  benchpress: {
    start: joints({ leftElbow: 165, rightElbow: 165, leftShoulder: 95, rightShoulder: 95 }),
    end: joints({ leftElbow: 165, rightElbow: 165 }),
    min: joints({ leftElbow: 88, rightElbow: 92 }),
    max: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 110, rightShoulder: 110 }),
    durationMs: 1800,
  },
  dead_hang: {
    // static hold: start=max=min=end
    start: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 95, rightShoulder: 95 }),
    end: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 95, rightShoulder: 95 }),
    min: joints({ leftElbow: 168, rightElbow: 168, leftShoulder: 95, rightShoulder: 95 }),
    max: joints({ leftElbow: 172, rightElbow: 172, leftShoulder: 100, rightShoulder: 100 }),
    durationMs: 5000,
  },
  farmers_walk: {
    start: joints({ leftHip: 170, rightHip: 170, leftShoulder: 90, rightShoulder: 90 }),
    end: joints({ leftHip: 170, rightHip: 170 }),
    min: joints({ leftHip: 168, rightHip: 170, leftShoulder: 88, rightShoulder: 90 }),
    max: joints({ leftHip: 172, rightHip: 172, leftShoulder: 95, rightShoulder: 95 }),
    durationMs: 12000,
  },
  lunge: {
    start: joints({ leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 }),
    end: joints({ leftKnee: 170, rightKnee: 170 }),
    min: joints({ leftKnee: 88, rightKnee: 100, leftHip: 110, rightHip: 125 }),
    max: joints({ leftKnee: 175, rightKnee: 175, leftHip: 175, rightHip: 175 }),
    durationMs: 2500,
  },
  hip_thrust: {
    start: joints({ leftHip: 95, rightHip: 95, leftKnee: 95, rightKnee: 95 }),
    end: joints({ leftHip: 175, rightHip: 175, leftKnee: 95, rightKnee: 95 }),
    min: joints({ leftHip: 95, rightHip: 95, leftKnee: 95, rightKnee: 95 }),
    max: joints({ leftHip: 175, rightHip: 175, leftKnee: 95, rightKnee: 95 }),
    durationMs: 2500,
  },
  bulgarian_split_squat: {
    start: joints({ leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 }),
    end: joints({ leftKnee: 170, rightKnee: 170, leftHip: 170, rightHip: 170 }),
    min: joints({ leftKnee: 95, rightKnee: 120, leftHip: 115, rightHip: 125 }),
    max: joints({ leftKnee: 175, rightKnee: 175, leftHip: 175, rightHip: 175 }),
    durationMs: 2500,
  },
  barbell_row: {
    start: joints({ leftElbow: 165, rightElbow: 165, leftHip: 105, rightHip: 105, leftShoulder: 95, rightShoulder: 95 }),
    end: joints({ leftElbow: 165, rightElbow: 165, leftHip: 105, rightHip: 105, leftShoulder: 95, rightShoulder: 95 }),
    min: joints({ leftElbow: 80, rightElbow: 80, leftHip: 105, rightHip: 105, leftShoulder: 95, rightShoulder: 95 }),
    max: joints({ leftElbow: 165, rightElbow: 165, leftHip: 110, rightHip: 110, leftShoulder: 100, rightShoulder: 100 }),
    durationMs: 2000,
  },
  lat_pulldown: {
    start: joints({ leftElbow: 165, rightElbow: 165, leftShoulder: 150, rightShoulder: 150 }),
    end: joints({ leftElbow: 165, rightElbow: 165, leftShoulder: 150, rightShoulder: 150 }),
    min: joints({ leftElbow: 80, rightElbow: 80, leftShoulder: 115, rightShoulder: 115 }),
    max: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 160, rightShoulder: 160 }),
    durationMs: 2200,
  },
  overhead_press: {
    start: joints({ leftElbow: 95, rightElbow: 95, leftHip: 175, rightHip: 175 }),
    end: joints({ leftElbow: 95, rightElbow: 95, leftHip: 175, rightHip: 175 }),
    min: joints({ leftElbow: 95, rightElbow: 95, leftHip: 172, rightHip: 174 }),
    max: joints({ leftElbow: 170, rightElbow: 170, leftHip: 178, rightHip: 178 }),
    durationMs: 1800,
  },
  dumbbell_curl: {
    start: joints({ leftElbow: 170, rightElbow: 170, leftHip: 175, rightHip: 175 }),
    end: joints({ leftElbow: 170, rightElbow: 170, leftHip: 175, rightHip: 175 }),
    min: joints({ leftElbow: 60, rightElbow: 60, leftHip: 173, rightHip: 174 }),
    max: joints({ leftElbow: 172, rightElbow: 172, leftHip: 175, rightHip: 175 }),
    durationMs: 1500,
  },
};

function ctxFromProfile(id: DetectionMode): RepContext {
  const p = IDEAL_PROFILES[id];
  return {
    startAngles: p.start,
    endAngles: p.end,
    minAngles: p.min,
    maxAngles: p.max,
    durationMs: p.durationMs,
    repNumber: 1,
    workoutId: id,
  };
}

function getDef(id: DetectionMode): WorkoutDefinition {
  return workoutsByMode[id] as unknown as WorkoutDefinition;
}

// ---------------------------------------------------------------------------
// Sanity baseline — every fault in every workout must return `false` on the
// per-workout ideal rep.
// ---------------------------------------------------------------------------

describe('parametric fault baseline — ideal rep fires no faults', () => {
  const workoutIds = Object.keys(workoutsByMode) as DetectionMode[];

  for (const id of workoutIds) {
    describe(`workout: ${id}`, () => {
      const def = getDef(id);
      const ctx = ctxFromProfile(id);

      for (const fault of def.faults) {
        test(`fault '${fault.id}' does not fire on ideal rep`, () => {
          const fired = fault.condition(ctx);
          if (fired) {
            // Helpful debugging output
            throw new Error(
              `[${id}.${fault.id}] mis-fired on ideal rep — update IDEAL_PROFILES or fault thresholds`
            );
          }
          expect(fired).toBe(false);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Targeted positives — hand-crafted RepContexts that SHOULD trigger each
// listed fault. Covers all 6 lunge + 6 dead-hang faults + 24 #459 faults
// (hip-thrust 5, BSS 4, barbell-row 4, lat-pulldown 4, OHP 4, DB-curl 3) +
// a curated subset from the original 8 movements.
// ---------------------------------------------------------------------------

interface PositiveCase {
  workout: DetectionMode;
  fault: string;
  build: () => RepContext;
}

function positiveCtx(id: DetectionMode, overrides: Partial<RepContext>): RepContext {
  const base = ctxFromProfile(id);
  return {
    ...base,
    ...overrides,
  };
}

const POSITIVE_CASES: PositiveCase[] = [
  // ---- lunge (6) ----
  {
    workout: 'lunge', fault: 'shallow_depth',
    build: () => positiveCtx('lunge', { minAngles: joints({ leftKnee: 130, rightKnee: 130, leftHip: 140, rightHip: 140 }) }),
  },
  {
    workout: 'lunge', fault: 'knee_cave',
    build: () => positiveCtx('lunge', { minAngles: joints({ leftKnee: 60, rightKnee: 110, leftHip: 110, rightHip: 110 }) }),
  },
  {
    workout: 'lunge', fault: 'heels_off_ground',
    build: () => positiveCtx('lunge', { minAngles: joints({ leftHip: 70, rightHip: 130, leftKnee: 95, rightKnee: 95 }) }),
  },
  {
    workout: 'lunge', fault: 'asymmetric_depth',
    build: () => positiveCtx('lunge', { minAngles: joints({ leftKnee: 55, rightKnee: 170, leftHip: 110, rightHip: 110 }) }),
  },
  {
    workout: 'lunge', fault: 'forward_knee',
    build: () => positiveCtx('lunge', { minAngles: joints({ leftKnee: 55, rightKnee: 90, leftHip: 110, rightHip: 110 }) }),
  },
  {
    workout: 'lunge', fault: 'hyper_extension',
    build: () => positiveCtx('lunge', { endAngles: joints({ leftKnee: 185, rightKnee: 170 }) }),
  },

  // ---- dead-hang (6 total: 3 pre-existing + 3 new) ----
  {
    workout: 'dead_hang', fault: 'bent_arms',
    build: () => positiveCtx('dead_hang', { minAngles: joints({ leftElbow: 130, rightElbow: 130, leftShoulder: 95, rightShoulder: 95 }) }),
  },
  {
    workout: 'dead_hang', fault: 'shrugged_shoulders',
    build: () => positiveCtx('dead_hang', { maxAngles: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 130, rightShoulder: 100 }) }),
  },
  {
    workout: 'dead_hang', fault: 'short_hold',
    build: () => positiveCtx('dead_hang', { durationMs: 1000 }),
  },
  {
    workout: 'dead_hang', fault: 'scapular_retraction',
    build: () => positiveCtx('dead_hang', { maxAngles: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 70, rightShoulder: 70 }) }),
  },
  {
    workout: 'dead_hang', fault: 'kipping_swing',
    build: () => positiveCtx('dead_hang', {
      startAngles: joints({ leftElbow: 170, rightElbow: 170, leftHip: 170, rightHip: 170, leftShoulder: 95, rightShoulder: 95 }),
      maxAngles: joints({ leftElbow: 170, rightElbow: 170, leftHip: 195, rightHip: 170, leftShoulder: 100, rightShoulder: 100 }),
    }),
  },
  {
    workout: 'dead_hang', fault: 'grip_shift',
    build: () => positiveCtx('dead_hang', { maxAngles: joints({ leftElbow: 150, rightElbow: 180, leftShoulder: 100, rightShoulder: 100 }) }),
  },

  // ---- squat (4) ----
  {
    workout: 'squat', fault: 'shallow_depth',
    build: () => positiveCtx('squat', { minAngles: joints({ leftKnee: 118, rightKnee: 118, leftHip: 130, rightHip: 130 }) }),
  },
  {
    workout: 'squat', fault: 'knee_valgus',
    build: () => positiveCtx('squat', { minAngles: joints({ leftKnee: 80, rightKnee: 115, leftHip: 95, rightHip: 95 }) }),
  },
  {
    workout: 'squat', fault: 'hip_shift',
    build: () => positiveCtx('squat', { minAngles: joints({ leftKnee: 95, rightKnee: 95, leftHip: 70, rightHip: 100 }) }),
  },
  {
    workout: 'squat', fault: 'fast_rep',
    build: () => positiveCtx('squat', { durationMs: 500 }),
  },

  // ---- pushup (2) ----
  {
    workout: 'pushup', fault: 'shallow_depth',
    build: () => positiveCtx('pushup', { minAngles: joints({ leftElbow: 112, rightElbow: 112, leftHip: 175, rightHip: 175 }) }),
  },
  {
    workout: 'pushup', fault: 'hip_sag',
    build: () => positiveCtx('pushup', { minAngles: joints({ leftElbow: 95, rightElbow: 95, leftHip: 150, rightHip: 150 }) }),
  },

  // ---- pullup (2) ----
  {
    workout: 'pullup', fault: 'incomplete_rom',
    build: () => positiveCtx('pullup', { minAngles: joints({ leftElbow: 105, rightElbow: 105, leftShoulder: 100, rightShoulder: 100 }) }),
  },
  {
    workout: 'pullup', fault: 'shoulder_elevation',
    build: () => positiveCtx('pullup', { maxAngles: joints({ leftElbow: 170, rightElbow: 170, leftShoulder: 125, rightShoulder: 115 }) }),
  },

  // ---- deadlift (2) ----
  {
    workout: 'deadlift', fault: 'rounded_back',
    build: () => positiveCtx('deadlift', { maxAngles: joints({ leftShoulder: 125, rightShoulder: 110, leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170 }) }),
  },
  {
    workout: 'deadlift', fault: 'fast_descent',
    build: () => positiveCtx('deadlift', { durationMs: 1000 }),
  },

  // ---- rdl (1) ----
  {
    workout: 'rdl', fault: 'asymmetric_hinge',
    build: () => positiveCtx('rdl', { minAngles: joints({ leftHip: 80, rightHip: 115, leftKnee: 150, rightKnee: 150, leftShoulder: 100, rightShoulder: 100 }) }),
  },

  // ---- benchpress (1) ----
  {
    workout: 'benchpress', fault: 'asymmetric_press',
    build: () => positiveCtx('benchpress', { minAngles: joints({ leftElbow: 80, rightElbow: 110 }) }),
  },

  // ---- farmers_walk (1) ----
  {
    workout: 'farmers_walk', fault: 'lateral_lean',
    build: () => positiveCtx('farmers_walk', { minAngles: joints({ leftHip: 150, rightHip: 175, leftShoulder: 90, rightShoulder: 90 }) }),
  },

  // ---- hip-thrust (5) — from #459 ----
  {
    workout: 'hip_thrust', fault: 'shallow_depth',
    build: () => positiveCtx('hip_thrust', {
      minAngles: joints({ leftHip: 130, rightHip: 130, leftKnee: 95, rightKnee: 95 }),
    }),
  },
  {
    workout: 'hip_thrust', fault: 'heel_liftoff',
    build: () => positiveCtx('hip_thrust', {
      maxAngles: joints({ leftHip: 175, rightHip: 175, leftKnee: 85, rightKnee: 160 }),
    }),
  },
  {
    workout: 'hip_thrust', fault: 'incomplete_lockout',
    build: () => positiveCtx('hip_thrust', {
      maxAngles: joints({ leftHip: 140, rightHip: 140, leftKnee: 95, rightKnee: 95 }),
    }),
  },
  {
    workout: 'hip_thrust', fault: 'asymmetric_extension',
    build: () => positiveCtx('hip_thrust', {
      maxAngles: joints({ leftHip: 140, rightHip: 175, leftKnee: 95, rightKnee: 95 }),
    }),
  },
  {
    workout: 'hip_thrust', fault: 'hyperextension',
    build: () => positiveCtx('hip_thrust', {
      maxAngles: joints({ leftHip: 190, rightHip: 175, leftKnee: 95, rightKnee: 95 }),
    }),
  },

  // ---- bulgarian-split-squat (4) — from #459 ----
  {
    workout: 'bulgarian_split_squat', fault: 'shallow_depth',
    build: () => positiveCtx('bulgarian_split_squat', {
      minAngles: joints({ leftKnee: 130, rightKnee: 140, leftHip: 130, rightHip: 135 }),
    }),
  },
  {
    workout: 'bulgarian_split_squat', fault: 'forward_knee',
    build: () => positiveCtx('bulgarian_split_squat', {
      minAngles: joints({ leftKnee: 55, rightKnee: 100, leftHip: 115, rightHip: 125 }),
    }),
  },
  {
    workout: 'bulgarian_split_squat', fault: 'asymmetric_drive',
    build: () => positiveCtx('bulgarian_split_squat', {
      minAngles: joints({ leftKnee: 95, rightKnee: 120, leftHip: 70, rightHip: 130 }),
    }),
  },
  {
    workout: 'bulgarian_split_squat', fault: 'heel_collapse',
    build: () => positiveCtx('bulgarian_split_squat', {
      minAngles: joints({ leftKnee: 40, rightKnee: 100, leftHip: 115, rightHip: 125 }),
    }),
  },

  // ---- barbell-row (4) — from #459 ----
  {
    workout: 'barbell_row', fault: 'incomplete_lockout',
    build: () => positiveCtx('barbell_row', {
      minAngles: joints({ leftElbow: 120, rightElbow: 120, leftHip: 105, rightHip: 105, leftShoulder: 95, rightShoulder: 95 }),
    }),
  },
  {
    workout: 'barbell_row', fault: 'rounded_back',
    build: () => positiveCtx('barbell_row', {
      minAngles: joints({ leftElbow: 80, rightElbow: 80, leftHip: 105, rightHip: 105, leftShoulder: 85, rightShoulder: 85 }),
      maxAngles: joints({ leftElbow: 165, rightElbow: 165, leftHip: 108, rightHip: 108, leftShoulder: 125, rightShoulder: 120 }),
    }),
  },
  {
    workout: 'barbell_row', fault: 'asymmetric_pull',
    build: () => positiveCtx('barbell_row', {
      minAngles: joints({ leftElbow: 70, rightElbow: 120, leftHip: 105, rightHip: 105, leftShoulder: 95, rightShoulder: 95 }),
    }),
  },
  {
    workout: 'barbell_row', fault: 'elbows_high',
    build: () => positiveCtx('barbell_row', {
      maxAngles: joints({ leftElbow: 165, rightElbow: 165, leftHip: 110, rightHip: 110, leftShoulder: 130, rightShoulder: 115 }),
    }),
  },

  // ---- lat-pulldown (4) — from #459 ----
  {
    workout: 'lat_pulldown', fault: 'incomplete_lockout',
    build: () => positiveCtx('lat_pulldown', {
      minAngles: joints({ leftElbow: 115, rightElbow: 115, leftShoulder: 120, rightShoulder: 120 }),
    }),
  },
  {
    workout: 'lat_pulldown', fault: 'excessive_lean',
    build: () => positiveCtx('lat_pulldown', {
      startAngles: joints({ leftElbow: 165, rightElbow: 165, leftShoulder: 150, rightShoulder: 150 }),
      minAngles: joints({ leftElbow: 80, rightElbow: 80, leftShoulder: 80, rightShoulder: 80 }),
    }),
  },
  {
    workout: 'lat_pulldown', fault: 'asymmetric_pull',
    build: () => positiveCtx('lat_pulldown', {
      minAngles: joints({ leftElbow: 75, rightElbow: 120, leftShoulder: 115, rightShoulder: 115 }),
    }),
  },
  {
    workout: 'lat_pulldown', fault: 'elbows_flare',
    build: () => positiveCtx('lat_pulldown', {
      minAngles: joints({ leftElbow: 80, rightElbow: 80, leftShoulder: 140, rightShoulder: 120 }),
    }),
  },

  // ---- overhead-press (4) — from #459 ----
  {
    workout: 'overhead_press', fault: 'incomplete_lockout',
    build: () => positiveCtx('overhead_press', {
      maxAngles: joints({ leftElbow: 140, rightElbow: 140, leftHip: 175, rightHip: 175 }),
    }),
  },
  {
    workout: 'overhead_press', fault: 'excessive_lean',
    build: () => positiveCtx('overhead_press', {
      startAngles: joints({ leftElbow: 95, rightElbow: 95, leftHip: 175, rightHip: 175 }),
      minAngles: joints({ leftElbow: 95, rightElbow: 95, leftHip: 150, rightHip: 175 }),
    }),
  },
  {
    workout: 'overhead_press', fault: 'asymmetric_press',
    build: () => positiveCtx('overhead_press', {
      maxAngles: joints({ leftElbow: 140, rightElbow: 170, leftHip: 175, rightHip: 175 }),
    }),
  },
  {
    workout: 'overhead_press', fault: 'core_hyperextension',
    build: () => positiveCtx('overhead_press', {
      maxAngles: joints({ leftElbow: 170, rightElbow: 170, leftHip: 195, rightHip: 180 }),
    }),
  },

  // ---- dumbbell-curl (3) — from #459 ----
  {
    workout: 'dumbbell_curl', fault: 'swinging',
    build: () => positiveCtx('dumbbell_curl', {
      startAngles: joints({ leftElbow: 170, rightElbow: 170, leftHip: 175, rightHip: 175 }),
      minAngles: joints({ leftElbow: 60, rightElbow: 60, leftHip: 150, rightHip: 175 }),
    }),
  },
  {
    workout: 'dumbbell_curl', fault: 'incomplete_lockout',
    build: () => positiveCtx('dumbbell_curl', {
      minAngles: joints({ leftElbow: 100, rightElbow: 100, leftHip: 173, rightHip: 174 }),
    }),
  },
  {
    workout: 'dumbbell_curl', fault: 'asymmetric_curl',
    build: () => positiveCtx('dumbbell_curl', {
      minAngles: joints({ leftElbow: 55, rightElbow: 120, leftHip: 173, rightHip: 174 }),
    }),
  },
];

describe('parametric fault harness — targeted positive triggers', () => {
  for (const pc of POSITIVE_CASES) {
    test(`${pc.workout}.${pc.fault} fires on a minimally-triggering RepContext`, () => {
      const def = getDef(pc.workout);
      const fault: FaultDefinition | undefined = def.faults.find((f) => f.id === pc.fault);
      if (!fault) {
        throw new Error(`Fault '${pc.workout}.${pc.fault}' not registered`);
      }
      expect(fault.condition(pc.build())).toBe(true);
    });
  }

  test('at least 44 targeted positive cases registered (12 #441 + 24 #459 + 8 curated)', () => {
    expect(POSITIVE_CASES.length).toBeGreaterThanOrEqual(44);
  });
});

// ---------------------------------------------------------------------------
// NaN-angles guard — every fault must return `false` on fully-NaN input.
// ---------------------------------------------------------------------------

describe('parametric fault harness — NaN angles do not fire faults', () => {
  const NaNAngles: JointAngles = {
    leftElbow: NaN, rightElbow: NaN, leftShoulder: NaN, rightShoulder: NaN,
    leftKnee: NaN, rightKnee: NaN, leftHip: NaN, rightHip: NaN,
  };
  const nanCtx: RepContext = {
    startAngles: NaNAngles,
    endAngles: NaNAngles,
    minAngles: NaNAngles,
    maxAngles: NaNAngles,
    durationMs: 4000,
    repNumber: 1,
    workoutId: 'parametric-nan',
  };

  const workoutIds = Object.keys(workoutsByMode) as DetectionMode[];
  for (const id of workoutIds) {
    const def = getDef(id);
    for (const fault of def.faults) {
      // Duration-only faults (fast_rep, short_hold, rushed_pickup, short_carry,
      // fast_descent) are expected to still evaluate deterministically under
      // NaN because they only look at `durationMs`. Filter them out of the
      // NaN-guard assertion.
      const isDurationFault = /fast|short|rushed/.test(fault.id);
      if (isDurationFault) continue;
      test(`${id}.${fault.id} does not fire on all-NaN angles`, () => {
        expect(fault.condition(nanCtx)).toBe(false);
      });
    }
  }
});
