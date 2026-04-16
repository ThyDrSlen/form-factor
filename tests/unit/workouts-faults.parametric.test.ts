/**
 * Parametric fault harness — issue #438
 *
 * Exercises every registered fault in every workout definition under two
 * synthetic conditions:
 *
 *   1. A per-workout "ideal rep" `RepContext` is handed to every fault; each
 *      fault must return `false`. This is a sanity baseline — if any fault
 *      mis-fires on a good rep, it needs thresholds re-tuned.
 *   2. For a named subset of faults with well-defined biomechanical triggers,
 *      a minimal "triggering" RepContext asserts that the fault returns
 *      `true`. This includes all 6 lunge faults + 6 dead-hang faults, plus
 *      a curated set of high-signal faults from other workouts.
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
// listed fault. Covers all 6 lunge + 6 dead-hang faults + a curated subset
// of other-workout faults.
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

  test('at least 20 targeted positive cases registered', () => {
    expect(POSITIVE_CASES.length).toBeGreaterThanOrEqual(20);
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
