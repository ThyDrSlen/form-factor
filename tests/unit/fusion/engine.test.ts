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
});
