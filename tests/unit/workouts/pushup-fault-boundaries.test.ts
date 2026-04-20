/**
 * Push-up fault-boundary regression tests.
 *
 * Each fault in `lib/workouts/pushup.ts` exercised at its threshold boundary.
 */
import pushupDefinition, { PUSHUP_THRESHOLDS } from '@/lib/workouts/pushup';
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
    leftElbow: 170,
    rightElbow: 170,
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
    workoutId: 'pushup',
    ...overrides,
  };
}

function faultById(id: string): FaultDefinition {
  const f = pushupDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Push-up fault not found: ${id}`);
  return f;
}

describe('pushup fault boundaries', () => {
  describe('hip_sag (avgHip < 160)', () => {
    const fault = faultById('hip_sag');
    test('boundary: avgHip === 160 does NOT fire', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftHip: 160, rightHip: 160, leftElbow: 90, rightElbow: 90 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test('avgHip === 159 fires', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftHip: 159, rightHip: 159, leftElbow: 90, rightElbow: 90 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('incomplete_lockout (endElbow < readyElbow - 10)', () => {
    const fault = faultById('incomplete_lockout');
    const exactly = PUSHUP_THRESHOLDS.readyElbow - 10;
    test(`boundary: endElbow === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        endAngles: makeAngles({ leftElbow: exactly, rightElbow: exactly, leftHip: 175, rightHip: 175 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`endElbow === ${exactly - 1} fires`, () => {
      const ctx = makeCtx({
        endAngles: makeAngles({ leftElbow: exactly - 1, rightElbow: exactly - 1, leftHip: 175, rightHip: 175 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('shallow_depth (minElbow > bottom + 15)', () => {
    const fault = faultById('shallow_depth');
    const exactly = PUSHUP_THRESHOLDS.bottom + 15;
    test(`boundary: minElbow === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftElbow: exactly, rightElbow: exactly, leftHip: 175, rightHip: 175 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`minElbow === ${exactly + 1} fires`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftElbow: exactly + 1, rightElbow: exactly + 1, leftHip: 175, rightHip: 175 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('asymmetric_press (|leftElbow - rightElbow| > 20)', () => {
    const fault = faultById('asymmetric_press');
    test('boundary: 20° diff does NOT fire', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftElbow: 80, rightElbow: 100, leftHip: 175, rightHip: 175 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test('21° diff fires', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftElbow: 80, rightElbow: 101, leftHip: 175, rightHip: 175 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('fast_rep (durationMs < 600)', () => {
    const fault = faultById('fast_rep');
    test('boundary: 600ms does NOT fire', () => {
      expect(fault.condition(makeCtx({ durationMs: 600 }))).toBe(false);
    });
    test('599ms fires', () => {
      expect(fault.condition(makeCtx({ durationMs: 599 }))).toBe(true);
    });
  });

  describe('elbow_flare (maxShoulder > 120)', () => {
    const fault = faultById('elbow_flare');
    test('boundary: 120° does NOT fire', () => {
      const ctx = makeCtx({
        maxAngles: makeAngles({ leftShoulder: 120, rightShoulder: 120, leftElbow: 160, rightElbow: 160, leftHip: 175, rightHip: 175 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test('121° fires (single side triggers via Math.max)', () => {
      const ctx = makeCtx({
        maxAngles: makeAngles({ leftShoulder: 121, rightShoulder: 100, leftElbow: 160, rightElbow: 160, leftHip: 175, rightHip: 175 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('all-zero RepContext short-circuit', () => {
    test('every push-up fault handles all-zero RepContext without throwing', () => {
      const ctx = makeCtx({
        startAngles: ZERO_ANGLES,
        endAngles: ZERO_ANGLES,
        minAngles: ZERO_ANGLES,
        maxAngles: ZERO_ANGLES,
      });
      for (const fault of pushupDefinition.faults) {
        expect(() => fault.condition(ctx)).not.toThrow();
      }
    });
  });
});
