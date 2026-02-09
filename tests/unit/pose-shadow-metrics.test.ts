import { compareJointAngles, createShadowStatsAccumulator, accumulateShadowStats, finalizeShadowStats } from '@/lib/pose/shadow-metrics';
import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';

const primary: JointAngles = {
  leftKnee: 100,
  rightKnee: 100,
  leftElbow: 100,
  rightElbow: 100,
  leftHip: 100,
  rightHip: 100,
  leftShoulder: 100,
  rightShoulder: 100,
};

const shadow: JointAngles = {
  leftKnee: 110,
  rightKnee: 90,
  leftElbow: 100,
  rightElbow: 95,
  leftHip: 105,
  rightHip: 115,
  leftShoulder: 80,
  rightShoulder: 100,
};

test('compareJointAngles computes per-joint and aggregate deltas', () => {
  const comparison = compareJointAngles(primary, shadow, {
    provider: 'mediapipe_proxy',
    modelVersion: 'mediapipe-shadow-proxy@0.1.0',
  });

  expect(comparison.comparedJoints).toBe(8);
  expect(comparison.deltaByJoint.leftKnee).toBe(10);
  expect(comparison.deltaByJoint.rightKnee).toBe(10);
  expect(comparison.deltaByJoint.leftShoulder).toBe(20);
  expect(comparison.meanAbsDelta).toBeCloseTo(8.125, 6);
  expect(comparison.p95AbsDelta).toBe(20);
  expect(comparison.maxAbsDelta).toBe(20);
});

test('shadow stats accumulator aggregates frame comparisons', () => {
  const comparison = compareJointAngles(primary, shadow, {
    provider: 'mediapipe_proxy',
    modelVersion: 'mediapipe-shadow-proxy@0.1.0',
  });

  const accumulator = createShadowStatsAccumulator();
  accumulateShadowStats(accumulator, comparison);
  accumulateShadowStats(accumulator, comparison);

  const summary = finalizeShadowStats(accumulator);
  expect(summary.framesCompared).toBe(2);
  expect(summary.meanAbsDelta).toBeCloseTo(8.125, 6);
  expect(summary.maxAbsDelta).toBe(20);
  expect(summary.coverageRatio).toBeCloseTo(1, 6);
});

test('finalizeShadowStats returns null metrics when no frames were compared', () => {
  const summary = finalizeShadowStats(createShadowStatsAccumulator());
  expect(summary.framesCompared).toBe(0);
  expect(summary.meanAbsDelta).toBeNull();
  expect(summary.p95AbsDelta).toBeNull();
  expect(summary.maxAbsDelta).toBeNull();
  expect(summary.coverageRatio).toBeNull();
});
