/**
 * Asserts that the drills[] metadata added to FaultDefinition is present
 * and well-formed for every workout that should surface them.
 *
 * If a new workout is added with faults, add its definition to the
 * registry below so this test catches missing drills.
 */
import type { FaultDefinition } from '@/lib/types/workout-definitions';
import pullup from '@/lib/workouts/pullup';
import squat from '@/lib/workouts/squat';
import deadlift from '@/lib/workouts/deadlift';
import pushup from '@/lib/workouts/pushup';
import benchpress from '@/lib/workouts/benchpress';

interface TestWorkoutShape {
  id: string;
  faults: FaultDefinition[];
}

const expectations: {
  workout: TestWorkoutShape;
  faultIdsWithDrills: string[];
}[] = [
  {
    workout: pullup,
    faultIdsWithDrills: ['incomplete_rom', 'incomplete_extension', 'shoulder_elevation'],
  },
  {
    workout: squat,
    faultIdsWithDrills: ['shallow_depth', 'knee_valgus', 'hip_shift'],
  },
  {
    workout: deadlift,
    faultIdsWithDrills: ['incomplete_lockout', 'rounded_back', 'hips_rise_first'],
  },
  {
    workout: pushup,
    faultIdsWithDrills: ['hip_sag', 'shallow_depth', 'elbow_flare'],
  },
  {
    workout: benchpress,
    faultIdsWithDrills: ['incomplete_lockout', 'shallow_depth', 'elbow_flare'],
  },
];

function fault(workout: TestWorkoutShape, id: string): FaultDefinition | undefined {
  return workout.faults.find((f) => f.id === id);
}

describe('FaultDefinition.drills backfill', () => {
  for (const { workout, faultIdsWithDrills } of expectations) {
    describe(workout.id, () => {
      it(`has drill metadata for each of the top ${faultIdsWithDrills.length} faults`, () => {
        for (const id of faultIdsWithDrills) {
          const f = fault(workout, id);
          expect(f).toBeDefined();
          expect(f!.drills).toBeDefined();
          expect(f!.drills!.length).toBeGreaterThanOrEqual(1);
          for (const drill of f!.drills!) {
            expect(drill.id).toMatch(/^[a-z0-9-]+$/);
            expect(drill.title.length).toBeGreaterThan(0);
            expect(drill.durationSec).toBeGreaterThan(0);
            expect(Array.isArray(drill.steps)).toBe(true);
            expect(drill.steps.length).toBeGreaterThanOrEqual(1);
            for (const step of drill.steps) {
              expect(typeof step).toBe('string');
              expect(step.length).toBeGreaterThan(0);
            }
            if (drill.reps !== undefined) {
              expect(drill.reps).toBeGreaterThan(0);
            }
            if (drill.mediaUri !== undefined) {
              expect(typeof drill.mediaUri).toBe('string');
            }
          }
        }
      });

      it('does not regress existing fault fields', () => {
        for (const id of faultIdsWithDrills) {
          const f = fault(workout, id);
          expect(f?.condition).toBeInstanceOf(Function);
          expect(f?.dynamicCue.length).toBeGreaterThan(0);
          expect([1, 2, 3]).toContain(f?.severity);
          expect(typeof f?.fqiPenalty).toBe('number');
        }
      });
    });
  }

  it('yields 15 drills total across the 5 backfilled workouts', () => {
    let total = 0;
    for (const { workout, faultIdsWithDrills } of expectations) {
      for (const id of faultIdsWithDrills) {
        total += fault(workout, id)?.drills?.length ?? 0;
      }
    }
    expect(total).toBeGreaterThanOrEqual(15);
  });
});
