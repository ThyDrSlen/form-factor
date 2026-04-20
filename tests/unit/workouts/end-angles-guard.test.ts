/**
 * Regression tests for #166 / #417: fault conditions that read `ctx.endAngles`
 * must not crash or silently mis-evaluate when `endAngles` is missing or
 * contains non-finite readings.
 *
 * Prior to this fix, `(ctx.endAngles.leftKnee + ctx.endAngles.rightKnee) / 2`
 * evaluated to `NaN` and `NaN < threshold` returned `false` — so the
 * "incomplete_lockout" fault silently stopped firing when endAngles was
 * undefined or partially populated.
 */

import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { RepContext } from '@/lib/types/workout-definitions';

import { benchpressDefinition } from '@/lib/workouts/benchpress';
import { pushupDefinition } from '@/lib/workouts/pushup';
import { squatDefinition } from '@/lib/workouts/squat';
import {
  averageJointPair,
  captureEndAngles,
  hasEndAngles,
  safeAngleAverage,
  safeJointPair,
} from '@/lib/workouts/helpers';

function angles(overrides: Partial<JointAngles> = {}): JointAngles {
  return {
    leftElbow: 170,
    rightElbow: 170,
    leftShoulder: 90,
    rightShoulder: 90,
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<RepContext> = {}): RepContext {
  return {
    startAngles: angles(),
    endAngles: angles(),
    minAngles: angles(),
    maxAngles: angles(),
    durationMs: 5000,
    repNumber: 1,
    workoutId: 'test',
    ...overrides,
  };
}

function findFault(def: { faults: { id: string; condition: (ctx: RepContext) => boolean }[] }, id: string) {
  const f = def.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Fault '${id}' not found`);
  return f;
}

describe('safe angle helpers', () => {
  describe('safeAngleAverage', () => {
    it('returns null when left is undefined', () => {
      expect(safeAngleAverage(undefined, 170)).toBeNull();
    });

    it('returns null when right is undefined', () => {
      expect(safeAngleAverage(170, undefined)).toBeNull();
    });

    it('returns null when left is NaN', () => {
      expect(safeAngleAverage(Number.NaN, 170)).toBeNull();
    });

    it('returns null when right is Infinity', () => {
      expect(safeAngleAverage(170, Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('returns the average when both inputs are finite', () => {
      expect(safeAngleAverage(160, 180)).toBe(170);
    });
  });

  describe('safeJointPair', () => {
    it('returns null when source is undefined', () => {
      expect(safeJointPair(undefined, 'leftKnee', 'rightKnee')).toBeNull();
    });

    it('returns null when source is null', () => {
      expect(safeJointPair(null, 'leftKnee', 'rightKnee')).toBeNull();
    });

    it('returns null when left side is NaN', () => {
      const a = angles({ leftKnee: Number.NaN });
      expect(safeJointPair(a, 'leftKnee', 'rightKnee')).toBeNull();
    });

    it('returns the pair when both sides are finite', () => {
      const a = angles({ leftKnee: 150, rightKnee: 155 });
      expect(safeJointPair(a, 'leftKnee', 'rightKnee')).toEqual({ left: 150, right: 155 });
    });
  });

  describe('averageJointPair', () => {
    it('returns null when endAngles is undefined', () => {
      expect(averageJointPair(undefined, 'leftKnee', 'rightKnee')).toBeNull();
    });

    it('returns null when one side is non-finite', () => {
      const a = angles({ leftKnee: Number.NaN });
      expect(averageJointPair(a, 'leftKnee', 'rightKnee')).toBeNull();
    });

    it('returns the average when both finite', () => {
      expect(averageJointPair(angles({ leftKnee: 160, rightKnee: 170 }), 'leftKnee', 'rightKnee')).toBe(165);
    });
  });

  describe('captureEndAngles', () => {
    it('snapshots the joint angles at rep end', () => {
      const a = angles({ leftKnee: 165, rightKnee: 167 });
      const captured = captureEndAngles(a);
      expect(captured.leftKnee).toBe(165);
      expect(captured.rightKnee).toBe(167);
      // Mutating source should not affect snapshot
      a.leftKnee = 0;
      expect(captured.leftKnee).toBe(165);
    });
  });

  describe('hasEndAngles', () => {
    it('returns false when endAngles is missing', () => {
      expect(hasEndAngles({ ...baseCtx(), endAngles: undefined as unknown as JointAngles })).toBe(false);
    });

    it('returns false when every reading is NaN', () => {
      const nanAngles: JointAngles = {
        leftElbow: Number.NaN,
        rightElbow: Number.NaN,
        leftShoulder: Number.NaN,
        rightShoulder: Number.NaN,
        leftKnee: Number.NaN,
        rightKnee: Number.NaN,
        leftHip: Number.NaN,
        rightHip: Number.NaN,
      };
      expect(hasEndAngles(baseCtx({ endAngles: nanAngles }))).toBe(false);
    });

    it('returns true when at least one reading is finite', () => {
      expect(hasEndAngles(baseCtx())).toBe(true);
    });
  });
});

describe('fault conditions that read ctx.endAngles — #166 guard', () => {
  const scenarios = [
    {
      name: 'squat.incomplete_lockout',
      fault: findFault(squatDefinition, 'incomplete_lockout'),
    },
    {
      name: 'pushup.incomplete_lockout',
      fault: findFault(pushupDefinition, 'incomplete_lockout'),
    },
    {
      name: 'benchpress.incomplete_lockout',
      fault: findFault(benchpressDefinition, 'incomplete_lockout'),
    },
  ];

  for (const { name, fault } of scenarios) {
    describe(name, () => {
      it('does not throw when endAngles is entirely missing', () => {
        const ctx = baseCtx({ endAngles: undefined as unknown as JointAngles });
        expect(() => fault.condition(ctx)).not.toThrow();
      });

      it('returns false (no fault) when endAngles is missing', () => {
        const ctx = baseCtx({ endAngles: undefined as unknown as JointAngles });
        expect(fault.condition(ctx)).toBe(false);
      });

      it('returns false (no fault) when endAngles contains NaN', () => {
        const ctx = baseCtx({
          endAngles: angles({ leftKnee: Number.NaN, leftElbow: Number.NaN }),
        });
        expect(fault.condition(ctx)).toBe(false);
      });

      it('returns false (no fault) when endAngles contains Infinity', () => {
        const ctx = baseCtx({
          endAngles: angles({
            leftKnee: Number.POSITIVE_INFINITY,
            rightKnee: Number.POSITIVE_INFINITY,
            leftElbow: Number.POSITIVE_INFINITY,
            rightElbow: Number.POSITIVE_INFINITY,
          }),
        });
        expect(fault.condition(ctx)).toBe(false);
      });
    });
  }

  it('squat.incomplete_lockout still fires on a truly incomplete rep', () => {
    const fault = findFault(squatDefinition, 'incomplete_lockout');
    const ctx = baseCtx({ endAngles: angles({ leftKnee: 140, rightKnee: 140 }) });
    expect(fault.condition(ctx)).toBe(true);
  });

  it('squat.incomplete_lockout stays silent on a clean rep', () => {
    const fault = findFault(squatDefinition, 'incomplete_lockout');
    const ctx = baseCtx({ endAngles: angles({ leftKnee: 170, rightKnee: 170 }) });
    expect(fault.condition(ctx)).toBe(false);
  });
});
