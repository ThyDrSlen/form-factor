import type { JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type {
  JointAngleKey,
  ShadowAngleComparison,
  ShadowStatsAccumulator,
  ShadowStatsSummary,
  PoseProvider,
} from '@/lib/pose/types';

const JOINT_KEYS: JointAngleKey[] = [
  'leftKnee',
  'rightKnee',
  'leftElbow',
  'rightElbow',
  'leftHip',
  'rightHip',
  'leftShoulder',
  'rightShoulder',
];

const MAX_DELTA_SAMPLES = 5000;

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function compareJointAngles(
  primary: JointAngles,
  shadow: JointAngles,
  meta: {
    provider: PoseProvider;
    modelVersion: string;
    inferenceMs?: number;
    coverageRatio?: number;
  },
): ShadowAngleComparison {
  const deltaByJoint: Partial<Record<JointAngleKey, number>> = {};
  const shadowAngles: Partial<Record<JointAngleKey, number>> = {};
  const absDeltas: number[] = [];

  for (const key of JOINT_KEYS) {
    const primaryValue = primary[key];
    const shadowValue = shadow[key];
    if (!Number.isFinite(primaryValue) || !Number.isFinite(shadowValue)) {
      continue;
    }

    shadowAngles[key] = shadowValue;
    const absDelta = Math.abs(primaryValue - shadowValue);
    deltaByJoint[key] = absDelta;
    absDeltas.push(absDelta);
  }

  const comparedJoints = absDeltas.length;
  const meanAbsDelta = comparedJoints > 0 ? absDeltas.reduce((sum, value) => sum + value, 0) / comparedJoints : 0;

  return {
    provider: meta.provider,
    modelVersion: meta.modelVersion,
    inferenceMs: meta.inferenceMs,
    comparedJoints,
    coverageRatio: meta.coverageRatio ?? comparedJoints / JOINT_KEYS.length,
    meanAbsDelta,
    p95AbsDelta: percentile(absDeltas, 95),
    maxAbsDelta: comparedJoints > 0 ? Math.max(...absDeltas) : 0,
    deltaByJoint,
    shadowAngles,
  };
}

export function createShadowStatsAccumulator(): ShadowStatsAccumulator {
  return {
    framesCompared: 0,
    comparedJointSamples: 0,
    cumulativeAbsDelta: 0,
    maxAbsDelta: 0,
    cumulativeCoverage: 0,
    deltaSamples: [],
  };
}

export function accumulateShadowStats(acc: ShadowStatsAccumulator, comparison: ShadowAngleComparison): void {
  if (comparison.comparedJoints <= 0) {
    return;
  }

  acc.framesCompared += 1;
  acc.comparedJointSamples += comparison.comparedJoints;
  acc.cumulativeCoverage += comparison.coverageRatio;
  acc.cumulativeAbsDelta += comparison.meanAbsDelta * comparison.comparedJoints;
  acc.maxAbsDelta = Math.max(acc.maxAbsDelta, comparison.maxAbsDelta);

  for (const value of Object.values(comparison.deltaByJoint)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      acc.deltaSamples.push(value);
    }
  }

  if (acc.deltaSamples.length > MAX_DELTA_SAMPLES) {
    acc.deltaSamples.splice(0, acc.deltaSamples.length - MAX_DELTA_SAMPLES);
  }
}

export function finalizeShadowStats(acc: ShadowStatsAccumulator): ShadowStatsSummary {
  if (acc.framesCompared === 0 || acc.comparedJointSamples === 0) {
    return {
      framesCompared: 0,
      meanAbsDelta: null,
      p95AbsDelta: null,
      maxAbsDelta: null,
      coverageRatio: null,
    };
  }

  return {
    framesCompared: acc.framesCompared,
    meanAbsDelta: acc.cumulativeAbsDelta / acc.comparedJointSamples,
    p95AbsDelta: percentile(acc.deltaSamples, 95),
    maxAbsDelta: acc.maxAbsDelta,
    coverageRatio: acc.cumulativeCoverage / acc.framesCompared,
  };
}
