import {
  asymmetryCheck,
  sequenceCheck,
  validateAngleInRange,
  clampedDelta,
} from '@/lib/workouts/helpers';
import type { AngleRange } from '@/lib/types/workout-definitions';

const range: AngleRange = { min: 80, max: 120, optimal: 100, tolerance: 10 };

// ---------------------------------------------------------------------------
// asymmetryCheck
// ---------------------------------------------------------------------------

describe('asymmetryCheck', () => {
  test('returns true when left/right diverge beyond threshold', () => {
    expect(asymmetryCheck(90, 110, 15)).toBe(true);
  });

  test('returns false when left/right are within threshold', () => {
    expect(asymmetryCheck(100, 98, 5)).toBe(false);
  });

  test('returns false for identical values', () => {
    expect(asymmetryCheck(100, 100, 5)).toBe(false);
  });

  test('NaN guard: returns false when left is NaN', () => {
    expect(asymmetryCheck(NaN, 90, 10)).toBe(false);
  });

  test('NaN guard: returns false when right is NaN', () => {
    expect(asymmetryCheck(90, NaN, 10)).toBe(false);
  });

  test('NaN guard: returns false when threshold is NaN', () => {
    expect(asymmetryCheck(90, 110, NaN)).toBe(false);
  });

  test('returns false when both sides are zero', () => {
    expect(asymmetryCheck(0, 0, 10)).toBe(false);
  });

  test('returns false for negative threshold', () => {
    expect(asymmetryCheck(90, 110, -5)).toBe(false);
  });

  test('boundary: diff exactly equal to threshold is not a fault', () => {
    // 10% diff on larger=100, threshold 10% -> not strictly greater
    expect(asymmetryCheck(90, 100, 10)).toBe(false);
  });

  test('boundary: diff just over threshold is a fault', () => {
    // 10.1% diff on larger=100
    expect(asymmetryCheck(89.8, 100, 10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sequenceCheck
// ---------------------------------------------------------------------------

describe('sequenceCheck', () => {
  test('primary-leads: fault when primary delta is smaller than secondary', () => {
    // deadlift-style: hips (primary) should rise more than shoulders (secondary)
    expect(sequenceCheck(170, 172, 170, 180, true)).toBe(true);
  });

  test('primary-leads: no fault when primary delta outpaces secondary', () => {
    expect(sequenceCheck(90, 170, 90, 120, true)).toBe(false);
  });

  test('primary-follows: fault when primary outpaces secondary', () => {
    expect(sequenceCheck(90, 170, 90, 120, false)).toBe(true);
  });

  test('NaN guard: returns false when primaryStart is NaN', () => {
    expect(sequenceCheck(NaN, 170, 90, 120, true)).toBe(false);
  });

  test('NaN guard: returns false when any input is non-finite', () => {
    expect(sequenceCheck(1, Infinity, 1, 1, true)).toBe(false);
  });

  test('equal deltas: no fault under primary-leads (not strictly less)', () => {
    expect(sequenceCheck(100, 120, 100, 120, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateAngleInRange
// ---------------------------------------------------------------------------

describe('validateAngleInRange', () => {
  test('returns true for angle within bounds', () => {
    expect(validateAngleInRange(100, range)).toBe(true);
  });

  test('returns true at lower boundary (inclusive)', () => {
    expect(validateAngleInRange(80, range)).toBe(true);
  });

  test('returns true at upper boundary (inclusive)', () => {
    expect(validateAngleInRange(120, range)).toBe(true);
  });

  test('returns false below min', () => {
    expect(validateAngleInRange(79.9, range)).toBe(false);
  });

  test('returns false above max', () => {
    expect(validateAngleInRange(120.1, range)).toBe(false);
  });

  test('NaN guard: returns false on NaN angle', () => {
    expect(validateAngleInRange(NaN, range)).toBe(false);
  });

  test('NaN guard: returns false on malformed range', () => {
    const bad: AngleRange = { min: NaN, max: 100, optimal: 90, tolerance: 5 };
    expect(validateAngleInRange(90, bad)).toBe(false);
  });

  test('returns false when max < min (degenerate range)', () => {
    const inverted: AngleRange = { min: 120, max: 80, optimal: 100, tolerance: 5 };
    expect(validateAngleInRange(100, inverted)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clampedDelta
// ---------------------------------------------------------------------------

describe('clampedDelta', () => {
  test('returns the signed delta from-to', () => {
    expect(clampedDelta(100, 120)).toBe(20);
  });

  test('returns negative delta when to < from', () => {
    expect(clampedDelta(120, 100)).toBe(-20);
  });

  test('NaN guard: returns 0 on NaN from', () => {
    expect(clampedDelta(NaN, 100)).toBe(0);
  });

  test('NaN guard: returns 0 on NaN to', () => {
    expect(clampedDelta(100, NaN)).toBe(0);
  });

  test('NaN guard: returns 0 on Infinity', () => {
    expect(clampedDelta(100, Infinity)).toBe(0);
  });

  test('zero delta when from === to', () => {
    expect(clampedDelta(90, 90)).toBe(0);
  });
});
