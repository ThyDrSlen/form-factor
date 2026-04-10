import {
  computeAdaptivePhaseHoldMs,
  computeAdaptiveRepDurationMs,
  createPhaseTimeoutTracker,
  isValidAngle,
  PHASE_TIMEOUT_MS,
  shouldEndRep,
  shouldStartRep,
} from '@/lib/services/workout-runtime';
import type { RepBoundary } from '@/lib/types/workout-definitions';

// =============================================================================
// Existing rep boundary tests
// =============================================================================

test('rep starts on transition into startPhase', () => {
  const boundary: RepBoundary<'a' | 'b'> = { startPhase: 'a', endPhase: 'b', minDurationMs: 400 };
  expect(shouldStartRep(boundary, 'b', 'a')).toBe(true);
  expect(shouldStartRep(boundary, 'a', 'a')).toBe(false);
});

test('rep ends on transition into endPhase after debounce', () => {
  const boundary: RepBoundary<'a' | 'b'> = { startPhase: 'a', endPhase: 'b', minDurationMs: 400 };
  expect(shouldEndRep(boundary, 'a', 'b', true, 1000, 0)).toBe(true);
  expect(shouldEndRep(boundary, 'a', 'b', true, 200, 0)).toBe(false);
});

test('adaptive rep duration follows cadence and tracking quality', () => {
  const highQuality = computeAdaptiveRepDurationMs({
    baseMinDurationMs: 400,
    recentRepDurationsMs: [1200, 1100, 1000],
    trackingQuality: 0.95,
  });
  const lowQuality = computeAdaptiveRepDurationMs({
    baseMinDurationMs: 400,
    recentRepDurationsMs: [1200, 1100, 1000],
    trackingQuality: 0.35,
  });

  expect(highQuality).toBeGreaterThanOrEqual(260);
  expect(highQuality).toBeLessThanOrEqual(560);
  expect(lowQuality).toBeGreaterThan(highQuality);
});

test('adaptive phase hold increases for poor tracking and higher drift', () => {
  const stable = computeAdaptivePhaseHoldMs({ trackingQuality: 0.95, shadowMeanAbsDelta: 2 });
  const unstable = computeAdaptivePhaseHoldMs({ trackingQuality: 0.4, shadowMeanAbsDelta: 18 });

  expect(stable).toBeGreaterThanOrEqual(40);
  expect(stable).toBeLessThanOrEqual(120);
  expect(unstable).toBeGreaterThan(stable);
});

// =============================================================================
// Phase Timeout Tracker Tests
// =============================================================================

describe('PhaseTimeoutTracker', () => {
  test('stuck phase returns initial phase after timeout', () => {
    const tracker = createPhaseTimeoutTracker('idle');
    const now = Date.now();

    // First update in 'top' phase
    expect(tracker.check('top', now)).toBe(false);

    // Still in 'top' after timeout expires — check returns true on timeout
    const timedOut = tracker.check('top', now + PHASE_TIMEOUT_MS + 500);
    expect(timedOut).toBe(true);
  });

  test('idle/setup phases never timeout', () => {
    const tracker = createPhaseTimeoutTracker('idle');
    const now = Date.now();

    // Stay in idle for a very long time
    expect(tracker.check('idle', now)).toBe(false);
    expect(tracker.check('idle', now + PHASE_TIMEOUT_MS * 10)).toBe(false);

    // Also test 'setup' as initial
    const tracker2 = createPhaseTimeoutTracker('setup');
    expect(tracker2.check('setup', now + PHASE_TIMEOUT_MS * 10)).toBe(false);
  });

  test('phase change resets the timeout timer', () => {
    const tracker = createPhaseTimeoutTracker('idle');
    const now = Date.now();

    // Enter 'top' phase
    tracker.check('top', now);

    // Wait almost to timeout
    expect(tracker.check('top', now + PHASE_TIMEOUT_MS - 500)).toBe(false);

    // Change phase to 'eccentric' -- resets timer
    expect(tracker.check('eccentric', now + PHASE_TIMEOUT_MS - 200)).toBe(false);

    // Now even after original timeout, no reset because timer was reset
    expect(tracker.check('eccentric', now + PHASE_TIMEOUT_MS + 200)).toBe(false);
  });

  test('reset clears the tracker state', () => {
    const tracker = createPhaseTimeoutTracker('idle');
    const now = Date.now();

    tracker.check('top', now);
    tracker.reset();

    // After reset, tracker should not remember the 'top' phase timing
    // (starts fresh)
    expect(tracker.check('idle', now + PHASE_TIMEOUT_MS + 1000)).toBe(false);
  });

  test('very slow rep (10s) with valid phase changes does NOT timeout', () => {
    const tracker = createPhaseTimeoutTracker('idle');
    const now = Date.now();

    // Simulate a slow rep: idle -> pull (2.5s) -> top (2.5s) -> hang (2.5s) -> pull (2.5s)
    tracker.check('idle', now);
    expect(tracker.check('pull', now + 2500)).toBe(false);
    expect(tracker.check('top', now + 5000)).toBe(false); // 2.5s in pull -- OK
    expect(tracker.check('hang', now + 7500)).toBe(false); // 2.5s in top -- OK
    expect(tracker.check('pull', now + 10000)).toBe(false); // 2.5s in hang -- OK
  });

  test('very fast rep (400ms) does NOT trigger timeout', () => {
    const tracker = createPhaseTimeoutTracker('idle');
    const now = Date.now();

    // Simulate a fast rep cycle
    tracker.check('idle', now);
    expect(tracker.check('pull', now + 50)).toBe(false);
    expect(tracker.check('top', now + 200)).toBe(false);
    expect(tracker.check('hang', now + 350)).toBe(false);
    expect(tracker.check('pull', now + 400)).toBe(false);
  });
});

// =============================================================================
// Rep Duration Edge Cases
// =============================================================================

describe('rep duration edge cases', () => {
  const boundary: RepBoundary<'start' | 'end' | 'other'> = {
    startPhase: 'start',
    endPhase: 'end',
    minDurationMs: 350,
  };

  test('very fast rep (400ms, above minDurationMs 350) counts', () => {
    // 400ms > 350ms minDurationMs, should count
    expect(shouldEndRep(boundary, 'other', 'end', true, 400, 0)).toBe(true);
  });

  test('sub-minimum rep (200ms, below minDurationMs 350) does NOT count', () => {
    // 200ms < 350ms minDurationMs, should NOT count
    expect(shouldEndRep(boundary, 'other', 'end', true, 200, 0)).toBe(false);
  });

  test('rep at exact minDurationMs boundary counts', () => {
    // Exactly 350ms should count (>= check)
    expect(shouldEndRep(boundary, 'other', 'end', true, 350, 0)).toBe(true);
  });

  test('rep does not count when repActive is false', () => {
    expect(shouldEndRep(boundary, 'other', 'end', false, 1000, 0)).toBe(false);
  });
});

// =============================================================================
// Angle Validation Tests (tracking drop guard)
// =============================================================================

describe('isValidAngle', () => {
  test('valid angles return true', () => {
    expect(isValidAngle(90)).toBe(true);
    expect(isValidAngle(1)).toBe(true);
    expect(isValidAngle(179)).toBe(true);
    expect(isValidAngle(0.5)).toBe(true);
  });

  test('NaN returns false', () => {
    expect(isValidAngle(NaN)).toBe(false);
  });

  test('null/undefined returns false', () => {
    expect(isValidAngle(null)).toBe(false);
    expect(isValidAngle(undefined)).toBe(false);
  });

  test('zero is valid (finite number)', () => {
    expect(isValidAngle(0)).toBe(true);
  });

  test('negative values are valid (finite number)', () => {
    expect(isValidAngle(-10)).toBe(true);
  });

  test('Infinity returns false', () => {
    expect(isValidAngle(Infinity)).toBe(false);
    expect(isValidAngle(-Infinity)).toBe(false);
  });

  test('large values are valid (finite number)', () => {
    expect(isValidAngle(360)).toBe(true);
    expect(isValidAngle(500)).toBe(true);
  });
});
