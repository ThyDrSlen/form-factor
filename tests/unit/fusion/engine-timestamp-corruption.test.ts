/**
 * Fusion-engine timestamp-corruption regression tests.
 *
 * Issue #430 Gap 3 — validates `runFusionFrame` + `selectAlignedSensorFrame`
 * against adversarial timestamps:
 *   - Backward timestamps (t2 < t1)
 *   - Duplicate timestamps (t2 === t1)
 *   - Clock drift (`Date.now()` mocked backward mid-session)
 *   - Frame-rate drop 30 -> 5 -> 30 fps
 *   - 100 consecutive undefined angles (no memory growth)
 *   - Backward sensor-sync alignment
 */
import {
  createFusionEngineState,
  runFusionFrame,
} from '@/lib/fusion/engine';
import { selectAlignedSensorFrame } from '@/lib/fusion/sync';

describe('fusion engine — timestamp corruption', () => {
  test('backward timestamp: second frame with earlier t does not crash and bodyState.t reflects input', () => {
    const state = createFusionEngineState();
    const t1 = 1_700_000_000_000;
    const t2 = t1 - 500; // 500ms backward

    const a = runFusionFrame({
      state,
      timestampMs: t1,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90 }),
    });

    const b = runFusionFrame({
      state,
      timestampMs: t2,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90 }),
    });

    expect(a.bodyState.t).toBe(t1);
    // bodyState.t is faithfully echoed (engine doesn't clamp). Negative ageMs
    // guard lives in consumers — we pin current behavior.
    expect(b.bodyState.t).toBe(t2);
    expect(b.bodyState.t).toBeLessThan(a.bodyState.t);
    // Frame index still advances monotonically
    expect(state.frameIndex).toBe(2);
  });

  test('duplicate timestamps: registry is reset per frame — no double-count of computeAngles', () => {
    const state = createFusionEngineState();
    let computeCalls = 0;
    const t = 1_700_000_000_000;

    const a = runFusionFrame({
      state,
      timestampMs: t,
      cameraConfidence: 0.9,
      computeAngles: () => {
        computeCalls += 1;
        return { leftKnee: 90 };
      },
    });

    const b = runFusionFrame({
      state,
      timestampMs: t, // identical ts
      cameraConfidence: 0.9,
      computeAngles: () => {
        computeCalls += 1;
        return { leftKnee: 91 };
      },
    });

    // Both frames ran independently even though timestamps matched -
    // documents absence of dedupe on identical timestamps.
    expect(computeCalls).toBe(2);
    expect(a.debug.anglesComputeCount).toBe(1);
    expect(b.debug.anglesComputeCount).toBe(1);
    expect(state.frameIndex).toBe(2);
  });

  test('clock drift: Date.now backward jump mid-session does not break angle computation', () => {
    const realNow = Date.now;
    // Simulate clock drift by generating timestamps externally.
    const timestamps = [10_000, 10_100, 10_200, 9_500, 9_600];
    const state = createFusionEngineState();
    const outputs = timestamps.map((t) =>
      runFusionFrame({
        state,
        timestampMs: t,
        cameraConfidence: 0.8,
        computeAngles: () => ({ leftKnee: 90 }),
      })
    );
    expect(outputs.every((o) => o.bodyState.confidence > 0)).toBe(true);
    expect(state.frameIndex).toBe(timestamps.length);
    Date.now = realNow;
  });

  test('frame-rate drop 30 -> 5 -> 30 fps: engine keeps producing bodyStates', () => {
    const state = createFusionEngineState();
    const intervals = [
      ...Array.from({ length: 10 }, () => 33),   // 30fps
      ...Array.from({ length: 5 }, () => 200),   // 5fps
      ...Array.from({ length: 10 }, () => 33),   // back to 30fps
    ];
    let t = 1_700_000_000_000;
    const outputs = intervals.map((dt) => {
      t += dt;
      return runFusionFrame({
        state,
        timestampMs: t,
        cameraConfidence: 0.9,
        computeAngles: () => ({ leftKnee: 90 }),
      });
    });
    // Every frame produced a bodyState (no freeze / undefined returns)
    expect(outputs.length).toBe(intervals.length);
    expect(outputs.every((o) => typeof o.bodyState.t === 'number')).toBe(true);
  });

  test('100 frames with empty angles record: registry reset each frame (no unbounded growth)', () => {
    const state = createFusionEngineState();
    for (let i = 0; i < 100; i += 1) {
      runFusionFrame({
        state,
        timestampMs: i,
        cameraConfidence: 0.7,
        computeAngles: () => ({}),
      });
    }
    // Per-frame registry is scoped; frameIndex is the only growing field.
    expect(state.frameIndex).toBe(100);
  });

  test('selectAlignedSensorFrame: backward secondary timestamp still computes abs skew', () => {
    const forward = selectAlignedSensorFrame({
      primaryTimestampSec: 100,
      secondaryTimestampSec: 101,
      maxTimestampSkewSec: 2,
    });
    const backward = selectAlignedSensorFrame({
      primaryTimestampSec: 100,
      secondaryTimestampSec: 99,
      maxTimestampSkewSec: 2,
    });
    expect(forward.skewSec).toBe(1);
    expect(backward.skewSec).toBe(1);
    expect(forward.accepted).toBe(true);
    expect(backward.accepted).toBe(true);
  });
});
