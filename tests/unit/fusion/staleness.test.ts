/**
 * Frame-staleness invalidation tests for the fusion engine.
 *
 * Issue #417 finding #4: if pose inference stalls, FrameFeatureRegistry
 * previously served the same cached angles for subsequent frames with no
 * detection. The engine now tracks a per-frame timestamp and exposes
 * `isFusionStateStale()` / `getAnglesIfFresh()` so the rep detector can
 * treat stale angles the same as missing data.
 */

import {
  FRAME_STALENESS_MS,
  createFusionEngineState,
  getAnglesIfFresh,
  isFusionStateStale,
  runFusionFrame,
} from '@/lib/fusion/engine';

describe('fusion engine — frame staleness', () => {
  test('FRAME_STALENESS_MS matches 30fps (≈33ms)', () => {
    expect(FRAME_STALENESS_MS).toBe(33);
  });

  test('isFusionStateStale returns true before any frame is processed', () => {
    const state = createFusionEngineState();
    expect(isFusionStateStale(state, 100)).toBe(true);
  });

  test('angles are fresh immediately after a runFusionFrame call', () => {
    const state = createFusionEngineState();
    runFusionFrame({
      state,
      timestampMs: 1000,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90, rightKnee: 91 }),
    });

    expect(isFusionStateStale(state, 1000)).toBe(false);
    expect(isFusionStateStale(state, 1020)).toBe(false);
  });

  test('angles become stale once more than 33ms has passed', () => {
    const state = createFusionEngineState();
    runFusionFrame({
      state,
      timestampMs: 1000,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90 }),
    });

    expect(isFusionStateStale(state, 1034)).toBe(true);
    expect(isFusionStateStale(state, 1100)).toBe(true);
  });

  test('getAnglesIfFresh returns null when stale', () => {
    const state = createFusionEngineState();
    runFusionFrame({
      state,
      timestampMs: 1000,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90 }),
    });

    expect(getAnglesIfFresh(state, 1000)).toEqual({ leftKnee: 90 });
    expect(getAnglesIfFresh(state, 1034)).toBeNull();
  });

  test('custom staleness window is respected', () => {
    const state = createFusionEngineState();
    runFusionFrame({
      state,
      timestampMs: 1000,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90 }),
    });

    expect(isFusionStateStale(state, 1100, 200)).toBe(false);
    expect(isFusionStateStale(state, 1100, 50)).toBe(true);
  });

  test('runFusionFrame reports anglesStale=false on first frame', () => {
    const state = createFusionEngineState();
    const out = runFusionFrame({
      state,
      timestampMs: 1000,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90 }),
    });

    expect(out.anglesStale).toBe(false);
    expect(out.anglesAgeMs).toBe(0);
  });

  test('runFusionFrame refreshes staleness clock each frame (recomputes angles)', () => {
    const state = createFusionEngineState();
    let computeCount = 0;

    runFusionFrame({
      state,
      timestampMs: 1000,
      cameraConfidence: 0.9,
      computeAngles: () => {
        computeCount += 1;
        return { leftKnee: 90 };
      },
    });

    // Even though the calling code stalled for 200ms between frames, when
    // runFusionFrame is finally invoked it forces a fresh compute and
    // consumers see anglesStale=false for the new output.
    const out2 = runFusionFrame({
      state,
      timestampMs: 1200,
      cameraConfidence: 0.9,
      computeAngles: () => {
        computeCount += 1;
        return { leftKnee: 92 };
      },
    });

    expect(computeCount).toBe(2);
    expect(out2.anglesStale).toBe(false);
  });

  test('empty computeAngles result does not refresh the staleness clock', () => {
    const state = createFusionEngineState();

    runFusionFrame({
      state,
      timestampMs: 1000,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90 }),
    });
    expect(state.lastAnglesTimestampMs).toBe(1000);

    // Simulate stall: computeAngles returns {} at t=1100
    runFusionFrame({
      state,
      timestampMs: 1100,
      cameraConfidence: 0.9,
      computeAngles: () => ({}),
    });
    // lastAnglesTimestampMs should still reflect the last GOOD compute
    expect(state.lastAnglesTimestampMs).toBe(1000);
    expect(isFusionStateStale(state, 1100)).toBe(true);
  });

  test('non-finite timestamps are treated as stale', () => {
    const state = createFusionEngineState();
    runFusionFrame({
      state,
      timestampMs: 1000,
      cameraConfidence: 0.9,
      computeAngles: () => ({ leftKnee: 90 }),
    });

    expect(isFusionStateStale(state, Number.NaN)).toBe(true);
    expect(isFusionStateStale(state, Number.POSITIVE_INFINITY)).toBe(true);
  });
});
