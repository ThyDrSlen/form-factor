import {
  beginCalibration,
  collectCalibrationSample,
  createCalibrationState,
  evaluateCalibrationDrift,
  finalizeCalibration,
} from '@/lib/fusion/calibration';

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
});
