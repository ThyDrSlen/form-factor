/**
 * Squat fault-boundary regression tests.
 *
 * Each fault in `lib/workouts/squat.ts` is exercised at its threshold boundary:
 *   - value === threshold must NOT fire (condition uses strict `>` or `<`)
 *   - value === threshold + epsilon must fire
 *
 * Also covers:
 *   - Asymmetric leg case for `knee_valgus` and `hip_shift`
 *   - NaN guard on minAngles (documents current defensive behavior)
 *   - All-zero startAngles/endAngles short-circuit (PR #421's captureEndAngles safety)
 *   - `forward_lean` strict-less-than contract: avgHip === avgKnee - 25 does NOT fire
 */
import squatDefinition, { SQUAT_THRESHOLDS } from '@/lib/workouts/squat';
import type { FaultDefinition, RepContext } from '@/lib/types/workout-definitions';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

const ZERO_ANGLES: JointAngles = {
  leftKnee: 0,
  rightKnee: 0,
  leftElbow: 0,
  rightElbow: 0,
  leftHip: 0,
  rightHip: 0,
  leftShoulder: 0,
  rightShoulder: 0,
};

function makeAngles(overrides: Partial<JointAngles> = {}): JointAngles {
  return { ...ZERO_ANGLES, ...overrides };
}

function makeCtx(overrides: Partial<RepContext> = {}): RepContext {
  const neutral = makeAngles({
    leftKnee: 170,
    rightKnee: 170,
    leftHip: 170,
    rightHip: 170,
    leftShoulder: 90,
    rightShoulder: 90,
  });
  return {
    startAngles: neutral,
    endAngles: neutral,
    minAngles: neutral,
    maxAngles: neutral,
    durationMs: 2000,
    repNumber: 1,
    workoutId: 'squat',
    ...overrides,
  };
}

function faultById(id: string): FaultDefinition {
  const f = squatDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Squat fault not found: ${id}`);
  return f;
}

describe('squat fault boundaries', () => {
  describe('shallow_depth (minKnee > parallel + 15)', () => {
    const fault = faultById('shallow_depth');
    const exactly = SQUAT_THRESHOLDS.parallel + 15;

    test(`boundary: minKnee === ${exactly} does NOT fire (condition is >)`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftKnee: exactly, rightKnee: exactly, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });

    test(`minKnee === ${exactly + 1} fires`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftKnee: exactly + 1, rightKnee: exactly + 1, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('incomplete_lockout (endKnee < standing - 10)', () => {
    const fault = faultById('incomplete_lockout');
    const exactly = SQUAT_THRESHOLDS.standing - 10;

    test(`boundary: endKnee === ${exactly} does NOT fire (condition is <)`, () => {
      const ctx = makeCtx({
        endAngles: makeAngles({ leftKnee: exactly, rightKnee: exactly, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });

    test(`endKnee === ${exactly - 1} fires`, () => {
      const ctx = makeCtx({
        endAngles: makeAngles({ leftKnee: exactly - 1, rightKnee: exactly - 1, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('knee_valgus (|leftKnee - rightKnee| > 25)', () => {
    const fault = faultById('knee_valgus');

    test('boundary: 25° diff does NOT fire (condition is >)', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftKnee: 100, rightKnee: 125, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });

    test('26° diff fires (asymmetric single-leg cave)', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftKnee: 100, rightKnee: 126, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });

    test('NaN minAngles: condition returns false without throwing (Math.abs(NaN) > anything === false)', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftKnee: Number.NaN, rightKnee: 100, leftHip: 170, rightHip: 170 }),
      });
      expect(() => fault.condition(ctx)).not.toThrow();
      // Math.abs(NaN) = NaN; NaN > anything === false. Documents current guard behavior.
      expect(fault.condition(ctx)).toBe(false);
    });
  });

  describe('fast_rep (durationMs < 1000)', () => {
    const fault = faultById('fast_rep');
    test('boundary: 1000ms does NOT fire', () => {
      expect(fault.condition(makeCtx({ durationMs: 1000 }))).toBe(false);
    });
    test('999ms fires', () => {
      expect(fault.condition(makeCtx({ durationMs: 999 }))).toBe(true);
    });
  });

  describe('hip_shift (|leftHip - rightHip| > 20)', () => {
    const fault = faultById('hip_shift');
    test('boundary: 20° diff does NOT fire', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftHip: 90, rightHip: 110, leftKnee: 90, rightKnee: 90 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test('21° diff fires', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftHip: 90, rightHip: 111, leftKnee: 90, rightKnee: 90 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('forward_lean (avgHip < avgKnee - 25)', () => {
    const fault = faultById('forward_lean');

    test('boundary: avgHip === avgKnee - 25 does NOT fire (condition is strict <)', () => {
      // avgKnee = 100, avgHip = 75 -> 75 < 75? false
      const ctx = makeCtx({
        minAngles: makeAngles({ leftKnee: 100, rightKnee: 100, leftHip: 75, rightHip: 75 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });

    test('avgHip === avgKnee - 26 fires', () => {
      // avgKnee = 100, avgHip = 74 -> 74 < 75? true
      const ctx = makeCtx({
        minAngles: makeAngles({ leftKnee: 100, rightKnee: 100, leftHip: 74, rightHip: 74 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('all-zero startAngles / endAngles short-circuit (no crash)', () => {
    test('every squat fault handles all-zero RepContext without throwing', () => {
      const ctx = makeCtx({
        startAngles: ZERO_ANGLES,
        endAngles: ZERO_ANGLES,
        minAngles: ZERO_ANGLES,
        maxAngles: ZERO_ANGLES,
      });
      for (const fault of squatDefinition.faults) {
        expect(() => fault.condition(ctx)).not.toThrow();
      }
    });
  });
});
