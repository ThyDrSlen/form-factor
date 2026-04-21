import { createFusionEngineState, runFusionFrame } from '@/lib/fusion/engine';

describe('fusion engine', () => {
  test('compute once: does_not_recompute_angles_for_cue_pass', () => {
    const state = createFusionEngineState();
    let computeCalls = 0;

    const output = runFusionFrame({
      state,
      timestampMs: 1700000000000,
      cameraConfidence: 0.9,
      computeAngles: () => {
        computeCalls += 1;
        return { leftKnee: 90, rightKnee: 91 };
      },
      cuePasses: [
        (ctx: { getAngles: () => Record<string, number> }) => {
          ctx.getAngles();
          ctx.getAngles();
        },
        (ctx: { getAngles: () => Record<string, number> }) => {
          ctx.getAngles();
        },
      ],
    });

    expect(computeCalls).toBe(1);
    expect(output.debug.anglesComputeCount).toBe(1);
  });

  test('low camera confidence transitions to degraded mode', () => {
    const state = createFusionEngineState();

    const output = runFusionFrame({
      state,
      timestampMs: 1700000000100,
      cameraConfidence: 0.35,
      computeAngles: () => ({ leftKnee: 90 }),
    });

    expect(output.mode).toBe('degraded');
    expect(output.bodyState.confidence).toBeLessThan(0.5);
    expect(output.fallbackModeEnabled).toBe(true);
  });

  test('thermal stride skips frames that are not on the stride boundary', () => {
    const state = createFusionEngineState();
    let computeCalls = 0;
    const computeAngles = () => {
      computeCalls += 1;
      return { leftKnee: 90 };
    };

    // stride=2 → process every 2nd frame. frameIndex increments to 1 (skip), 2 (process), 3 (skip), 4 (process)
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(
        runFusionFrame({
          state,
          timestampMs: 1700000000000 + i * 33,
          cameraConfidence: 0.9,
          thermalStride: 2,
          computeAngles,
        }),
      );
    }

    expect(results[0].frameSkipped).toBe(true);
    expect(results[1].frameSkipped).toBe(false);
    expect(results[2].frameSkipped).toBe(true);
    expect(results[3].frameSkipped).toBe(false);
    expect(computeCalls).toBe(2);
  });

  test('thermal stride of 1 processes every frame', () => {
    const state = createFusionEngineState();
    const output = runFusionFrame({
      state,
      timestampMs: 1700000000000,
      cameraConfidence: 0.9,
      thermalStride: 1,
      computeAngles: () => ({ leftKnee: 90 }),
    });
    expect(output.frameSkipped).toBe(false);
  });
});
