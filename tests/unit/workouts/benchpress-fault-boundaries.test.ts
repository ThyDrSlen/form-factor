/**
 * Bench-press fault-boundary regression tests.
 *
 * Each fault in `lib/workouts/benchpress.ts` is exercised at its threshold boundary:
 *   - value === threshold must NOT fire (condition uses strict `>` or `<`)
 *   - value === threshold + epsilon must fire
 *
 * Plus all-zero RepContext short-circuit (PR #421's captureEndAngles safety).
 */
import benchpressDefinition, { BENCHPRESS_THRESHOLDS } from '@/lib/workouts/benchpress';
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
    workoutId: 'benchpress',
    ...overrides,
  };
}

function faultById(id: string): FaultDefinition {
  const f = benchpressDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Benchpress fault not found: ${id}`);
  return f;
}

describe('benchpress fault boundaries', () => {
  describe('incomplete_lockout (endElbow < readyElbow - 10)', () => {
    const fault = faultById('incomplete_lockout');
    const exactly = BENCHPRESS_THRESHOLDS.readyElbow - 10;

    test(`boundary: endElbow === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        endAngles: makeAngles({ leftElbow: exactly, rightElbow: exactly, leftShoulder: 90, rightShoulder: 90 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`endElbow === ${exactly - 1} fires`, () => {
      const ctx = makeCtx({
        endAngles: makeAngles({ leftElbow: exactly - 1, rightElbow: exactly - 1, leftShoulder: 90, rightShoulder: 90 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('shallow_depth (minElbow > bottom + 15)', () => {
    const fault = faultById('shallow_depth');
    const exactly = BENCHPRESS_THRESHOLDS.bottom + 15;

    test(`boundary: minElbow === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftElbow: exactly, rightElbow: exactly, leftShoulder: 90, rightShoulder: 90 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`minElbow === ${exactly + 1} fires`, () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftElbow: exactly + 1, rightElbow: exactly + 1, leftShoulder: 90, rightShoulder: 90 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('asymmetric_press (|leftElbow - rightElbow| > 20)', () => {
    const fault = faultById('asymmetric_press');

    test('boundary: 20° diff does NOT fire', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftElbow: 80, rightElbow: 100, leftShoulder: 90, rightShoulder: 90 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test('21° diff fires', () => {
      const ctx = makeCtx({
        minAngles: makeAngles({ leftElbow: 80, rightElbow: 101, leftShoulder: 90, rightShoulder: 90 }),
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

  describe('elbow_flare (max shoulder > elbowFlareShoulderMax)', () => {
    const fault = faultById('elbow_flare');
    const exactly = BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax;

    test(`boundary: maxShoulder === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        maxAngles: makeAngles({ leftShoulder: exactly, rightShoulder: exactly, leftElbow: 150, rightElbow: 150 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`maxShoulder === ${exactly + 1} fires`, () => {
      const ctx = makeCtx({
        maxAngles: makeAngles({ leftShoulder: exactly + 1, rightShoulder: exactly, leftElbow: 150, rightElbow: 150 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('all-zero startAngles / endAngles short-circuit (no crash)', () => {
    test('every benchpress fault handles all-zero RepContext without throwing', () => {
      const ctx = makeCtx({
        startAngles: ZERO_ANGLES,
        endAngles: ZERO_ANGLES,
        minAngles: ZERO_ANGLES,
        maxAngles: ZERO_ANGLES,
      });
      for (const fault of benchpressDefinition.faults) {
        expect(() => fault.condition(ctx)).not.toThrow();
      }
    });
  });
});
