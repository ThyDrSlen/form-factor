import {
  beginCalibration,
  collectCalibrationSample,
  createCalibrationState,
  evaluateCalibrationDrift,
  finalizeCalibration,
} from '@/lib/fusion/calibration';
import { hapticBus } from '@/lib/haptics/haptic-bus';

describe('fusion calibration', () => {
  test('success path produces confidence >= 0.85 for stable neutral samples', () => {
    const state = createCalibrationState();
    beginCalibration(state, 1000);

    for (let i = 0; i < 8; i += 1) {
      collectCalibrationSample(state, {
        cameraUp: { x: 0, y: 1, z: 0 },
        watchForward: { x: 0, y: 0, z: -1 },
        headForward: { x: 0, y: 0, z: -1 },
        stability: 0.98,
      });
    }

    const result = finalizeCalibration(state, 2000);

    expect(result).not.toBeNull();
    expect(result?.phase).toBe('calibrated');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  test('drift trigger marks recalibration required when drift exceeds threshold', () => {
    const drift = evaluateCalibrationDrift({
      baselineForward: { x: 0, y: 0, z: -1 },
      currentForward: { x: 0.5, y: 0, z: -0.5 },
      maxDriftDeg: 12,
    });

    expect(drift.requiresRecalibration).toBe(true);
    expect(drift.driftDeg).toBeGreaterThan(12);
  });

  test('state transitions are explicit and deterministic', () => {
    const state = createCalibrationState();
    expect(state.phase).toBe('idle');

    beginCalibration(state, 1000);
    expect(state.phase).toBe('collecting');

    collectCalibrationSample(state, {
      cameraUp: { x: 0, y: 1, z: 0 },
      watchForward: { x: 0, y: 0, z: -1 },
      headForward: { x: 0, y: 0, z: -1 },
      stability: 1,
    });

    const result = finalizeCalibration(state, 1100);
    expect(result?.phase).toBe('calibrated');
  });

  // ---------------------------------------------------------------------------
  // Wave 30 C1 — edge-case hardening.
  //
  // Covers the failure / no-op / numeric-guard branches of the calibration
  // module. The internal helpers `averageVector` and `angleBetweenDeg` are
  // not exported, so they are exercised indirectly via finalizeCalibration
  // (all-zero samples path) and evaluateCalibrationDrift (zero-denominator
  // path) — which is also how real callers use them.
  // ---------------------------------------------------------------------------

  describe('edge cases (wave-30 C1)', () => {
    beforeEach(() => {
      hapticBus._reset();
    });

    test('finalizeCalibration with empty sample buffer emits calibration.failed and returns null', () => {
      const events: string[] = [];
      hapticBus.onEvent((e) => events.push(e));

      const state = createCalibrationState();
      beginCalibration(state, 0);
      // No samples collected before finalize.

      const result = finalizeCalibration(state, 50);

      expect(result).toBeNull();
      expect(events).toContain('calibration.failed');
      // State stays in `collecting` — finalize did not flip it to calibrated
      // because no samples were available.
      expect(state.phase).toBe('collecting');
      expect(state.completedAtMs).toBeNull();
    });

    test('finalizeCalibration during non-collecting phase early-returns without mutating state', () => {
      const events: string[] = [];
      hapticBus.onEvent((e) => events.push(e));

      const state = createCalibrationState();
      // State is still `idle` — no beginCalibration called.
      const snapshotBefore = { ...state, samples: [...state.samples] };

      const result = finalizeCalibration(state, 999);

      expect(result).toBeNull();
      // Failed haptic still fires because finalize routes idle-phase hits
      // through the same `failure` emitter.
      expect(events).toContain('calibration.failed');
      expect(state.phase).toBe(snapshotBefore.phase);
      expect(state.startedAtMs).toBe(snapshotBefore.startedAtMs);
      expect(state.completedAtMs).toBe(snapshotBefore.completedAtMs);
      expect(state.samples).toEqual(snapshotBefore.samples);
    });

    test('finalizeCalibration with all-zero vector samples returns a finite zero-vector result (no NaN)', () => {
      // Covers the averageVector({x:0,y:0,z:0}) branch: the internal
      // `normalize` helper must early-return {0,0,0} when magnitude <= EPSILON
      // instead of dividing by zero and producing NaN.
      const state = createCalibrationState();
      beginCalibration(state, 0);

      for (let i = 0; i < 4; i += 1) {
        collectCalibrationSample(state, {
          cameraUp: { x: 0, y: 0, z: 0 },
          watchForward: { x: 0, y: 0, z: 0 },
          headForward: { x: 0, y: 0, z: 0 },
          stability: 0.9,
        });
      }

      const result = finalizeCalibration(state, 100);

      expect(result).not.toBeNull();
      expect(result?.cameraUp).toEqual({ x: 0, y: 0, z: 0 });
      expect(result?.watchForward).toEqual({ x: 0, y: 0, z: 0 });
      expect(result?.headForward).toEqual({ x: 0, y: 0, z: 0 });
      // And none of these are NaN.
      expect(Number.isNaN(result?.cameraUp.x)).toBe(false);
      expect(Number.isNaN(result?.watchForward.y)).toBe(false);
      expect(Number.isNaN(result?.headForward.z)).toBe(false);
      // Confidence must be finite too — NaN propagation here would poison
      // the drift-detection path downstream.
      expect(Number.isFinite(result?.confidence)).toBe(true);
    });

    test('evaluateCalibrationDrift guards the zero-denominator angle path (no NaN)', () => {
      // When both vectors are zero, internal angleBetweenDeg normalises them
      // to {0,0,0}, dot=0, cosine clamps to 0, and acos(0) = 90°. The key
      // guarantee here is that no NaN leaks out — the result must be a
      // finite number so callers can compare against thresholds safely.
      const drift = evaluateCalibrationDrift({
        baselineForward: { x: 0, y: 0, z: 0 },
        currentForward: { x: 0, y: 0, z: 0 },
        maxDriftDeg: 12,
      });

      expect(Number.isFinite(drift.driftDeg)).toBe(true);
      expect(Number.isNaN(drift.driftDeg)).toBe(false);
      expect(drift.driftDeg).toBeGreaterThanOrEqual(0);
      expect(drift.driftDeg).toBeLessThanOrEqual(180);
      expect(typeof drift.requiresRecalibration).toBe('boolean');
    });
  });
});
