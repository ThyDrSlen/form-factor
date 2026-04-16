/**
 * Parametric fault harness — issue #459
 *
 * Exercises every fault on the 6 movements added by #459 under three
 * synthetic conditions:
 *
 *   1. A per-workout "ideal rep" `RepContext` is handed to every fault;
 *      each fault must return `false`. This is a sanity baseline — if any
 *      fault mis-fires on a good rep, thresholds need re-tuning.
 *   2. For every fault a minimal "triggering" RepContext asserts that the
 *      fault returns `true`. Catches accidental fault-condition inversions.
 *   3. Every fault also receives an all-NaN RepContext and must return
 *      `false`, verifying the NaN-guard path.
 *
 * This harness will be superseded on merge by the broader #441 harness in
 * `tests/unit/workouts-faults.parametric.test.ts` — at which point the two
 * files will be reconciled (same file name already chosen to make conflict
 * resolution obvious in a 3-way merge).
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { FaultDefinition, RepContext, WorkoutDefinition } from '@/lib/types/workout-definitions';
import { workoutsByMode, type DetectionMode } from '@/lib/workouts';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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

/**
 * Only the 6 new movements are exercised here. Pre-existing movements'
 * faults are covered by their own suites; when the #441 harness lands on
 * main this file reconciles with it.
 */
type NewMode =
  | 'hip_thrust'
  | 'bulgarian_split_squat'
  | 'barbell_row'
  | 'lat_pulldown'
  | 'overhead_press'
  | 'dumbbell_curl';

const NEW_MODE_IDS: NewMode[] = [
  'hip_thrust',
  'bulgarian_split_squat',
  'barbell_row',
  'lat_pulldown',
  'overhead_press',
  'dumbbell_curl',
];

const IDEAL_PROFILES: Record<NewMode, IdealProfile> = {
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

function ctxFromProfile(id: NewMode): RepContext {
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
// 1. Sanity baseline — every fault on every new movement must return
//    `false` on the movement's ideal rep.
// ---------------------------------------------------------------------------

describe('parametric fault baseline — ideal rep fires no faults (6 new movements)', () => {
  for (const id of NEW_MODE_IDS) {
    describe(`workout: ${id}`, () => {
      const def = getDef(id);
      const ctx = ctxFromProfile(id);

      for (const fault of def.faults) {
        test(`fault '${fault.id}' does not fire on ideal rep`, () => {
          const fired = fault.condition(ctx);
          if (fired) {
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
// 2. Targeted positives — every listed fault should return `true` on a
//    hand-built minimally-triggering RepContext. Keyed to the #459 spec.
// ---------------------------------------------------------------------------

interface PositiveCase {
  workout: NewMode;
  fault: string;
  build: () => RepContext;
}

function positiveCtx(id: NewMode, overrides: Partial<RepContext>): RepContext {
  const base = ctxFromProfile(id);
  return {
    ...base,
    ...overrides,
  };
}

const POSITIVE_CASES: PositiveCase[] = [
  // ---- hip-thrust (5) ----
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

  // ---- bulgarian-split-squat (4) ----
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

  // ---- barbell-row (4) ----
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

  // ---- lat-pulldown (4) ----
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

  // ---- overhead-press (4) ----
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

  // ---- dumbbell-curl (3) ----
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

describe('parametric fault harness — targeted positive triggers (6 new movements)', () => {
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

  test('all 24 new-movement faults have a positive case registered', () => {
    // hip-thrust 5 + BSS 4 + barbell-row 4 + lat-pulldown 4 + OHP 4 + DB-curl 3 = 24
    expect(POSITIVE_CASES.length).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// 3. NaN-angles guard — every fault on every new movement must return
//    `false` on fully-NaN input. (Duration-only faults would be filtered,
//    but none of the 6 new movements has a duration-only fault.)
// ---------------------------------------------------------------------------

describe('parametric fault harness — NaN angles do not fire faults (6 new movements)', () => {
  const NaNAngles: JointAngles = {
    leftElbow: NaN, rightElbow: NaN, leftShoulder: NaN, rightShoulder: NaN,
    leftKnee: NaN, rightKnee: NaN, leftHip: NaN, rightHip: NaN,
  };
  const nanCtx: RepContext = {
    startAngles: NaNAngles,
    endAngles: NaNAngles,
    minAngles: NaNAngles,
    maxAngles: NaNAngles,
    durationMs: 2000,
    repNumber: 1,
    workoutId: 'parametric-nan',
  };

  for (const id of NEW_MODE_IDS) {
    const def = getDef(id);
    for (const fault of def.faults) {
      test(`${id}.${fault.id} does not fire on all-NaN angles`, () => {
        expect(fault.condition(nanCtx)).toBe(false);
      });
    }
  }
});
