/**
 * Farmers walk fault-boundary regression tests.
 *
 * Focuses on `lateral_lean` and `forward_lean` plus companion faults.
 */
import farmersWalkDefinition, { FARMERS_WALK_THRESHOLDS } from '@/lib/workouts/farmers-walk';
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
    leftHip: 170,
    rightHip: 170,
    leftShoulder: 95,
    rightShoulder: 95,
    leftKnee: 170,
    rightKnee: 170,
  });
  return {
    startAngles: neutral,
    endAngles: neutral,
    minAngles: neutral,
    maxAngles: neutral,
    durationMs: 10000,
    repNumber: 1,
    workoutId: 'farmers_walk',
    ...overrides,
  };
}

function faultById(id: string): FaultDefinition {
  const f = farmersWalkDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Farmers-walk fault not found: ${id}`);
  return f;
}

describe('farmers walk fault boundaries', () => {
  describe('lateral_lean (|leftHip - rightHip| > hipAsymmetryMax)', () => {
    const fault = faultById('lateral_lean');
    const exactly = FARMERS_WALK_THRESHOLDS.hipAsymmetryMax;
    test(`boundary: ${exactly}° diff does NOT fire`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftHip: 170, rightHip: 170 - exactly, leftShoulder: 95, rightShoulder: 95 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`${exactly + 1}° diff fires`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftHip: 170, rightHip: 170 - (exactly + 1), leftShoulder: 95, rightShoulder: 95 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('shoulder_shrug (minShoulder < shoulderElevated)', () => {
    const fault = faultById('shoulder_shrug');
    const exactly = FARMERS_WALK_THRESHOLDS.shoulderElevated;
    test(`boundary: minShoulder === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftShoulder: exactly, rightShoulder: exactly, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`minShoulder === ${exactly - 1} fires (via Math.min with single side)`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftShoulder: exactly - 1, rightShoulder: 95, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('forward_lean (maxHip < standingHip - 15)', () => {
    const fault = faultById('forward_lean');
    const exactly = FARMERS_WALK_THRESHOLDS.standingHip - 15;
    test(`boundary: maxHip === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        maxAngles: makeAngles({ leftHip: exactly, rightHip: exactly, leftShoulder: 95, rightShoulder: 95 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`maxHip === ${exactly - 1} fires`, () => {
      const ctx = makeCtx({
        maxAngles: makeAngles({ leftHip: exactly - 1, rightHip: exactly - 1, leftShoulder: 95, rightShoulder: 95 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('asymmetric_shoulders (|leftShoulder - rightShoulder| > shoulderAsymmetryMax)', () => {
    const fault = faultById('asymmetric_shoulders');
    const exactly = FARMERS_WALK_THRESHOLDS.shoulderAsymmetryMax;
    test(`boundary: ${exactly}° diff does NOT fire`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftShoulder: 95, rightShoulder: 95 + exactly, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`${exactly + 1}° diff fires`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftShoulder: 95, rightShoulder: 95 + exactly + 1, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('short_carry (durationMs < 5000)', () => {
    const fault = faultById('short_carry');
    test('boundary: 5000ms does NOT fire', () => {
      expect(fault.condition(makeCtx({ durationMs: 5000 }))).toBe(false);
    });
    test('4999ms fires', () => {
      expect(fault.condition(makeCtx({ durationMs: 4999 }))).toBe(true);
    });
  });

  describe('rushed_pickup (durationMs < 3000)', () => {
    const fault = faultById('rushed_pickup');
    test('boundary: 3000ms does NOT fire', () => {
      expect(fault.condition(makeCtx({ durationMs: 3000 }))).toBe(false);
    });
    test('2999ms fires', () => {
      expect(fault.condition(makeCtx({ durationMs: 2999 }))).toBe(true);
    });
  });

  describe('all-zero RepContext short-circuit', () => {
    test('every farmers-walk fault handles all-zero RepContext without throwing', () => {
      const ctx = makeCtx({
        startAngles: ZERO_ANGLES,
        endAngles: ZERO_ANGLES,
        minAngles: ZERO_ANGLES,
        maxAngles: ZERO_ANGLES,
      });
      for (const fault of farmersWalkDefinition.faults) {
        expect(() => fault.condition(ctx)).not.toThrow();
      }
    });
  });
});
