/**
 * Fusion frame performance assertion.
 *
 * `runFusionFrame` is called on every camera frame (target 60fps). A single
 * invocation must complete well under 16ms (ideally <1ms in isolation) with
 * realistic angle/derived payloads and 3-5 cue passes attached.
 *
 * The existing tests/integration/fusion-latency.integration.test.ts only
 * benchmarks a dummy loop of integer math — it does not exercise the real
 * runFusionFrame() entry point. This replaces that gap with a realistic
 * workload benchmark.
 *
 * We keep the threshold generous (16ms / 60fps budget) so that CI noise on
 * GitHub runners does not flake the test, but still catches order-of-magnitude
 * regressions.
 */

import type { FusionFrameContext } from '@/lib/fusion/engine';
import { createFusionEngineState, runFusionFrame } from '@/lib/fusion/engine';

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index];
}

function realisticAngles(idx: number): Record<string, number> {
  // Bias each frame slightly so the engine doesn't optimize out identical work.
  const wiggle = Math.sin(idx * 0.1);
  return {
    leftElbow: 120 + 20 * wiggle,
    rightElbow: 120 + 20 * wiggle,
    leftShoulder: 90 + 5 * wiggle,
    rightShoulder: 90 + 5 * wiggle,
    leftHip: 160 + 10 * wiggle,
    rightHip: 160 + 10 * wiggle,
    leftKnee: 170 - 5 * wiggle,
    rightKnee: 170 - 5 * wiggle,
  };
}

function realisticDerived(angles: Record<string, number>): Record<string, number> {
  const le = angles.leftElbow ?? 0;
  const re = angles.rightElbow ?? 0;
  const ls = angles.leftShoulder ?? 0;
  const rs = angles.rightShoulder ?? 0;
  return {
    avgElbow: (le + re) / 2,
    elbowSymmetry: Math.abs(le - re),
    avgShoulder: (ls + rs) / 2,
    avgTorso: (angles.leftHip + angles.rightHip) / 2,
    kneeSymmetry: Math.abs(angles.leftKnee - angles.rightKnee),
  };
}

function cuePasses(): Array<(ctx: FusionFrameContext) => void> {
  // Each cue pass pulls angles + derived features via the registry so we exercise
  // the memoization path as real code does.
  return [
    (ctx) => {
      const a = ctx.getAngles();
      ctx.getFeature('romScore', () => Math.max(0, Math.min(100, 100 - Math.abs(180 - a.leftElbow))));
    },
    (ctx) => {
      const a = ctx.getAngles();
      ctx.getFeature('symmetryScore', () => 100 - Math.abs(a.leftElbow - a.rightElbow) * 2);
    },
    (ctx) => {
      const a = ctx.getAngles();
      ctx.getFeature('depthScore', () => 100 - Math.max(0, 90 - a.leftKnee));
    },
    (ctx) => {
      const a = ctx.getAngles();
      ctx.getFeature('hipStabilityScore', () => 100 - Math.abs(a.leftHip - a.rightHip));
    },
    (ctx) => {
      ctx.getFeature('overallScore', () => {
        const rom = ctx.getFeature('romScore', () => 80);
        const sym = ctx.getFeature('symmetryScore', () => 80);
        return (rom + sym) / 2;
      });
    },
  ];
}

describe('fusion frame perf integration', () => {
  test('runFusionFrame() p95 is under 16ms over 500 realistic frames', () => {
    const state = createFusionEngineState();
    const passes = cuePasses();
    const samplesMs: number[] = [];

    // Warm up once so the first-run JIT cost isn't billed against the p95.
    for (let i = 0; i < 10; i += 1) {
      runFusionFrame({
        state,
        timestampMs: i,
        cameraConfidence: 0.9,
        computeAngles: () => realisticAngles(i),
        computeDerived: realisticDerived,
        cuePasses: passes,
      });
    }

    const iterations = 500;
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      const out = runFusionFrame({
        state,
        timestampMs: 1000 + i,
        cameraConfidence: 0.9,
        computeAngles: () => realisticAngles(i),
        computeDerived: realisticDerived,
        cuePasses: passes,
      });
      const elapsed = performance.now() - start;
      samplesMs.push(elapsed);

      // Sanity-check output didn't degenerate — otherwise we could be "fast" by
      // short-circuiting.
      expect(out.bodyState).toBeDefined();
      expect(Number.isFinite(out.bodyState.confidence)).toBe(true);
    }

    const p95 = percentile(samplesMs, 95);
    const p99 = percentile(samplesMs, 99);
    // Document the actual numbers in CI logs to aid future perf regressions.
    // eslint-disable-next-line no-console
    console.log(`[fusion-frame-perf] p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms n=${iterations}`);
    expect(p95).toBeLessThan(16);
  });

  test('memoization: a single frame computes angles exactly once even with 5 cue passes reading them', () => {
    const state = createFusionEngineState();
    let callCount = 0;
    const out = runFusionFrame({
      state,
      timestampMs: 0,
      cameraConfidence: 0.9,
      computeAngles: () => {
        callCount += 1;
        return realisticAngles(0);
      },
      computeDerived: realisticDerived,
      cuePasses: cuePasses(),
    });
    expect(callCount).toBe(1);
    expect(out.debug.anglesComputeCount).toBe(1);
  });

  test('degraded mode scales confidence down when cameraConfidence < 0.5', () => {
    const state = createFusionEngineState();
    const out = runFusionFrame({
      state,
      timestampMs: 0,
      cameraConfidence: 0.2,
      computeAngles: () => realisticAngles(0),
    });
    expect(out.mode).toBe('degraded');
    expect(out.fallbackModeEnabled).toBe(true);
    // 0.2 * 0.75 = 0.15
    expect(out.bodyState.confidence).toBeCloseTo(0.15, 3);
  });

  test('full mode passes confidence through (clamped to [0,1])', () => {
    const state = createFusionEngineState();
    const out = runFusionFrame({
      state,
      timestampMs: 0,
      cameraConfidence: 1.5, // out-of-range
      computeAngles: () => realisticAngles(0),
    });
    expect(out.mode).toBe('full');
    expect(out.bodyState.confidence).toBe(1);
  });
});
