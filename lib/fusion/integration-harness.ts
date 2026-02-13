import { buildNonEmptySensorMatrix, classifySensorAvailability } from '@/lib/fusion/sync';

export interface LatencyHarnessResult {
  samples: number;
  p95Ms: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index];
}

export function runLatencyHarness(input: {
  iterations: number;
  runner: () => unknown;
}): LatencyHarnessResult {
  const safeIterations = Math.max(1, input.iterations);
  const samplesMs: number[] = [];

  for (let i = 0; i < safeIterations; i += 1) {
    const start = performance.now();
    input.runner();
    samplesMs.push(performance.now() - start);
  }

  return {
    samples: safeIterations,
    p95Ms: percentile(samplesMs, 95),
  };
}

export function verifyDegradationMatrix(): {
  totalScenarios: number;
  passedScenarios: number;
  failedKeys: string[];
} {
  const matrix = buildNonEmptySensorMatrix();
  const failedKeys: string[] = [];

  for (const scenario of matrix) {
    const classification = classifySensorAvailability(scenario.presence);
    if (classification.key !== scenario.key || classification.mode !== scenario.expectedMode) {
      failedKeys.push(scenario.key);
    }
  }

  return {
    totalScenarios: matrix.length,
    passedScenarios: matrix.length - failedKeys.length,
    failedKeys,
  };
}
