import {
  computeAdaptivePhaseHoldMs,
  computeAdaptiveRepDurationMs,
  shouldEndRep,
  shouldStartRep,
} from '@/lib/services/workout-runtime';
import type { RepBoundary } from '@/lib/types/workout-definitions';

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
