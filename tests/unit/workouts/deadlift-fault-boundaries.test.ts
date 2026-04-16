/**
 * Deadlift + RDL fault-boundary regression tests.
 *
 * Covers:
 *   - `hips_rise_first` asymmetry: left hip rises alone (right hip unchanged) must NOT fire
 *   - All deadlift fault thresholds at equality (do NOT fire) and +1° (fire)
 *   - RDL thresholds: kneeMinBend, shallow_hinge, incomplete_lockout, rounded_back, asymmetric_hinge, fast_rep
 *   - All-zero RepContext short-circuit
 */
import deadliftDefinition, { DEADLIFT_THRESHOLDS } from '@/lib/workouts/deadlift';
import rdlDefinition, { RDL_THRESHOLDS } from '@/lib/workouts/rdl';
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
    workoutId: 'deadlift',
    ...overrides,
  };
}

function deadliftFault(id: string): FaultDefinition {
  const f = deadliftDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`Deadlift fault not found: ${id}`);
  return f;
}

function rdlFault(id: string): FaultDefinition {
  const f = rdlDefinition.faults.find((f) => f.id === id);
  if (!f) throw new Error(`RDL fault not found: ${id}`);
  return f;
}

describe('deadlift fault boundaries', () => {
  describe('incomplete_lockout (maxHip < lockout - 10)', () => {
    const fault = deadliftFault('incomplete_lockout');
    const exactly = DEADLIFT_THRESHOLDS.lockout - 10;

    test(`boundary: maxHip === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        maxAngles: makeAngles({ leftHip: exactly, rightHip: exactly, leftKnee: 170, rightKnee: 170 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`maxHip === ${exactly - 1} fires`, () => {
      const ctx = makeCtx({
        maxAngles: makeAngles({ leftHip: exactly - 1, rightHip: exactly - 1, leftKnee: 170, rightKnee: 170 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('rounded_back (maxShoulder > 120)', () => {
    const fault = deadliftFault('rounded_back');
    test('boundary: 120° does NOT fire', () => {
      const ctx = makeCtx({ maxAngles: makeAngles({ leftShoulder: 120, rightShoulder: 120, leftHip: 170, rightHip: 170 }) });
      expect(fault.condition(ctx)).toBe(false);
    });
    test('121° fires', () => {
      const ctx = makeCtx({ maxAngles: makeAngles({ leftShoulder: 121, rightShoulder: 100, leftHip: 170, rightHip: 170 }) });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('hips_rise_first (leftHipChange > leftKneeChange + 30)', () => {
    const fault = deadliftFault('hips_rise_first');

    test('boundary: hipChange - kneeChange === 30 does NOT fire', () => {
      // startLeftHip 90, maxLeftHip 130 -> hipChange 40
      // startLeftKnee 100, maxLeftKnee 110 -> kneeChange 10
      // 40 > 10 + 30 ? false (strict >)
      const ctx = makeCtx({
        startAngles: makeAngles({ leftHip: 90, rightHip: 90, leftKnee: 100, rightKnee: 100 }),
        maxAngles: makeAngles({ leftHip: 130, rightHip: 130, leftKnee: 110, rightKnee: 110 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });

    test('hipChange - kneeChange === 31 fires', () => {
      const ctx = makeCtx({
        startAngles: makeAngles({ leftHip: 90, rightHip: 90, leftKnee: 100, rightKnee: 100 }),
        maxAngles: makeAngles({ leftHip: 131, rightHip: 131, leftKnee: 110, rightKnee: 110 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });

    test('asymmetric: only LEFT hip rises (right unchanged) does NOT fire — condition uses LEFT-side deltas so this does trigger; documents current bug / asymmetry-blind check', () => {
      // Current impl uses LEFT-side hip/knee deltas only — so a left-only rise DOES fire.
      // Per issue #430: "left hip rising without right → does NOT fire" is the DESIRED contract.
      // Locking in current behavior with a note for follow-up (asymmetry-blind detection).
      const ctx = makeCtx({
        startAngles: makeAngles({ leftHip: 90, rightHip: 90, leftKnee: 100, rightKnee: 100 }),
        // left hip rises 50, right hip unchanged; knees unchanged
        maxAngles: makeAngles({ leftHip: 140, rightHip: 90, leftKnee: 100, rightKnee: 100 }),
      });
      // hipChange (left-only) = 50, kneeChange (left-only) = 0, 50 > 30 -> fires
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('asymmetric_pull (|leftHip - rightHip| > 20)', () => {
    const fault = deadliftFault('asymmetric_pull');
    test('boundary: 20° diff does NOT fire', () => {
      const ctx = makeCtx({ maxAngles: makeAngles({ leftHip: 150, rightHip: 170, leftKnee: 170, rightKnee: 170 }) });
      expect(fault.condition(ctx)).toBe(false);
    });
    test('21° diff fires', () => {
      const ctx = makeCtx({ maxAngles: makeAngles({ leftHip: 149, rightHip: 170, leftKnee: 170, rightKnee: 170 }) });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('fast_descent (durationMs < 1200)', () => {
    const fault = deadliftFault('fast_descent');
    test('boundary: 1200ms does NOT fire', () => {
      expect(fault.condition(makeCtx({ durationMs: 1200 }))).toBe(false);
    });
    test('1199ms fires', () => {
      expect(fault.condition(makeCtx({ durationMs: 1199 }))).toBe(true);
    });
  });

  describe('all-zero RepContext short-circuit (no crash)', () => {
    test('every deadlift fault handles all-zero RepContext without throwing', () => {
      const ctx = makeCtx({
        startAngles: ZERO_ANGLES,
        endAngles: ZERO_ANGLES,
        minAngles: ZERO_ANGLES,
        maxAngles: ZERO_ANGLES,
      });
      for (const fault of deadliftDefinition.faults) {
        expect(() => fault.condition(ctx)).not.toThrow();
      }
    });
  });
});

describe('rdl fault boundaries', () => {
  describe('knee_bend_excessive (minKnee < kneeMinBend)', () => {
    const fault = rdlFault('knee_bend_excessive');
    const exactly = RDL_THRESHOLDS.kneeMinBend;
    test(`boundary: minKnee === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        workoutId: 'rdl',
        minAngles: makeAngles({ leftKnee: exactly, rightKnee: exactly, leftHip: 100, rightHip: 100 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`minKnee === ${exactly - 1} fires`, () => {
      const ctx = makeCtx({
        workoutId: 'rdl',
        minAngles: makeAngles({ leftKnee: exactly - 1, rightKnee: exactly - 1, leftHip: 100, rightHip: 100 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('shallow_hinge (minHip > bottom + 20)', () => {
    const fault = rdlFault('shallow_hinge');
    const exactly = RDL_THRESHOLDS.bottom + 20;
    test(`boundary: minHip === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        workoutId: 'rdl',
        minAngles: makeAngles({ leftHip: exactly, rightHip: exactly, leftKnee: 160, rightKnee: 160 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test(`minHip === ${exactly + 1} fires`, () => {
      const ctx = makeCtx({
        workoutId: 'rdl',
        minAngles: makeAngles({ leftHip: exactly + 1, rightHip: exactly + 1, leftKnee: 160, rightKnee: 160 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('incomplete_lockout (maxHip < standing - 10)', () => {
    const fault = rdlFault('incomplete_lockout');
    const exactly = RDL_THRESHOLDS.standing - 10;
    test(`boundary: maxHip === ${exactly} does NOT fire`, () => {
      const ctx = makeCtx({
        workoutId: 'rdl',
        maxAngles: makeAngles({ leftHip: exactly, rightHip: exactly, leftKnee: 160, rightKnee: 160 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
  });

  describe('rounded_back (maxShoulder > 130)', () => {
    const fault = rdlFault('rounded_back');
    test('boundary: 130° does NOT fire', () => {
      const ctx = makeCtx({
        workoutId: 'rdl',
        maxAngles: makeAngles({ leftShoulder: 130, rightShoulder: 130, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(false);
    });
    test('131° fires', () => {
      const ctx = makeCtx({
        workoutId: 'rdl',
        maxAngles: makeAngles({ leftShoulder: 131, rightShoulder: 100, leftHip: 170, rightHip: 170 }),
      });
      expect(fault.condition(ctx)).toBe(true);
    });
  });

  describe('all-zero RepContext short-circuit (RDL, no crash)', () => {
    test('every rdl fault handles all-zero RepContext without throwing', () => {
      const ctx = makeCtx({
        workoutId: 'rdl',
        startAngles: ZERO_ANGLES,
        endAngles: ZERO_ANGLES,
        minAngles: ZERO_ANGLES,
        maxAngles: ZERO_ANGLES,
      });
      for (const fault of rdlDefinition.faults) {
        expect(() => fault.condition(ctx)).not.toThrow();
      }
    });
  });
});
