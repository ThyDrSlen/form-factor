/**
 * Unit tests for calibration-failure-analyzer.
 *
 * Acceptance criterion from issue #479:
 *   "Calibration failure analyzer correctly classifies all 4 failure
 *    reasons"
 *
 * We assemble crafted `CalibrationState` inputs that target each reason
 * and assert the classifier picks the right one, including prioritisation
 * when multiple signals fire at once.
 */

import {
  analyzeCalibrationFailure,
  isRecoverablePhase,
  type CalibrationFailureReason,
} from '@/lib/services/calibration-failure-analyzer';
import {
  createCalibrationState,
  type CalibrationSample,
  type CalibrationState,
} from '@/lib/fusion/calibration';

const HEAD_BASELINE = { x: 0, y: 0, z: 1 };
const HEAD_DRIFTED = { x: Math.sin((30 * Math.PI) / 180), y: 0, z: Math.cos((30 * Math.PI) / 180) };
const CAMERA_UP = { x: 0, y: 1, z: 0 };
const WATCH_FWD = { x: 0, y: 0, z: 1 };

function makeSample(stability: number, drifted: boolean): CalibrationSample {
  return {
    cameraUp: CAMERA_UP,
    watchForward: WATCH_FWD,
    headForward: drifted ? HEAD_DRIFTED : HEAD_BASELINE,
    stability,
  };
}

function makeState(opts: {
  sampleCount: number;
  stability: number;
  driftSamples?: number;
  startedAtMs?: number;
}): CalibrationState {
  const state = createCalibrationState();
  state.phase = 'collecting';
  state.startedAtMs = opts.startedAtMs ?? 0;
  state.completedAtMs = null;
  state.samples = [];

  const driftIndex = opts.driftSamples ?? 0;
  for (let i = 0; i < opts.sampleCount; i++) {
    const drifted = driftIndex > 0 && i >= opts.sampleCount - driftIndex;
    state.samples.push(makeSample(opts.stability, drifted));
  }
  return state;
}

// ---------------------------------------------------------------------------
// Per-reason classification
// ---------------------------------------------------------------------------

describe('analyzeCalibrationFailure — reason classification', () => {
  it('classifies insufficient_samples when samples < minSamples and time is not up', () => {
    const state = makeState({ sampleCount: 5, stability: 0.8 });
    const result = analyzeCalibrationFailure({
      state,
      nowMs: 2000,
    });
    expect(result.reason).toBe<CalibrationFailureReason>('insufficient_samples');
    expect(result.metrics.sampleCount).toBe(5);
    expect(result.title.length).toBeGreaterThan(5);
    expect(result.remediation.length).toBeGreaterThan(10);
  });

  it('classifies low_stability when enough samples arrived but the signal is noisy', () => {
    const state = makeState({ sampleCount: 40, stability: 0.25 });
    const result = analyzeCalibrationFailure({
      state,
      nowMs: 3000,
    });
    expect(result.reason).toBe<CalibrationFailureReason>('low_stability');
    expect(result.metrics.avgStability).toBeCloseTo(0.25, 2);
  });

  it('classifies excessive_drift when head orientation changed mid-calibration', () => {
    const state = makeState({
      sampleCount: 40,
      stability: 0.9,
      driftSamples: 20,
    });
    const result = analyzeCalibrationFailure({
      state,
      nowMs: 4000,
      maxDriftDeg: 20,
    });
    expect(result.reason).toBe<CalibrationFailureReason>('excessive_drift');
    expect(result.metrics.headDriftDegApprox).toBeGreaterThan(20);
  });

  it('classifies timeout when the clock ran out with acceptable samples + stability', () => {
    const state = makeState({ sampleCount: 40, stability: 0.75, startedAtMs: 0 });
    const result = analyzeCalibrationFailure({
      state,
      nowMs: 12000,
      timeoutMs: 8000,
    });
    expect(result.reason).toBe<CalibrationFailureReason>('timeout');
    expect(result.metrics.elapsedMs).toBe(12000);
  });

  it('still flags timeout when samples were insufficient and clock expired', () => {
    const state = makeState({ sampleCount: 4, stability: 0.8, startedAtMs: 0 });
    const result = analyzeCalibrationFailure({
      state,
      nowMs: 15000,
      timeoutMs: 8000,
    });
    expect(result.reason).toBe<CalibrationFailureReason>('timeout');
  });
});

// ---------------------------------------------------------------------------
// Prioritisation: drift wins over low stability and insufficient samples
// ---------------------------------------------------------------------------

describe('analyzeCalibrationFailure — prioritisation', () => {
  it('drift beats low stability', () => {
    const state = makeState({
      sampleCount: 40,
      stability: 0.2, // would be low_stability
      driftSamples: 20, // but user also drifted
    });
    const result = analyzeCalibrationFailure({ state, nowMs: 4000 });
    expect(result.reason).toBe<CalibrationFailureReason>('excessive_drift');
  });

  it('low stability beats insufficient_samples once enough samples are present', () => {
    const state = makeState({ sampleCount: 15, stability: 0.2 });
    const result = analyzeCalibrationFailure({
      state,
      nowMs: 3000,
      minSamples: 30,
    });
    expect(result.reason).toBe<CalibrationFailureReason>('low_stability');
  });
});

// ---------------------------------------------------------------------------
// Payload fields
// ---------------------------------------------------------------------------

describe('analyzeCalibrationFailure — payload fields', () => {
  it('returns a suggestedExercise for actionable reasons', () => {
    const noise = analyzeCalibrationFailure({
      state: makeState({ sampleCount: 30, stability: 0.1 }),
      nowMs: 3000,
    });
    expect(noise.suggestedExercise).toBeDefined();

    const insufficient = analyzeCalibrationFailure({
      state: makeState({ sampleCount: 5, stability: 0.8 }),
      nowMs: 3000,
    });
    expect(insufficient.suggestedExercise).toBeDefined();

    const drift = analyzeCalibrationFailure({
      state: makeState({ sampleCount: 40, stability: 0.9, driftSamples: 20 }),
      nowMs: 4000,
    });
    expect(drift.suggestedExercise).toBeDefined();
  });

  it('returns metrics with sampleCount, avgStability, elapsedMs, headDriftDegApprox', () => {
    const result = analyzeCalibrationFailure({
      state: makeState({ sampleCount: 10, stability: 0.7 }),
      nowMs: 3000,
    });
    expect(result.metrics.sampleCount).toBe(10);
    expect(result.metrics.avgStability).toBeCloseTo(0.7, 5);
    expect(result.metrics.elapsedMs).toBe(3000);
    expect(result.metrics.headDriftDegApprox).toBeGreaterThanOrEqual(0);
  });

  it('elapsedMs is null when the state never started', () => {
    const fresh = createCalibrationState();
    const result = analyzeCalibrationFailure({ state: fresh, nowMs: 5000 });
    expect(result.metrics.elapsedMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isRecoverablePhase
// ---------------------------------------------------------------------------

describe('isRecoverablePhase', () => {
  it('flags recalibration_required and collecting as recoverable', () => {
    expect(isRecoverablePhase('recalibration_required')).toBe(true);
    expect(isRecoverablePhase('collecting')).toBe(true);
  });

  it('does not flag idle or calibrated', () => {
    expect(isRecoverablePhase('idle')).toBe(false);
    expect(isRecoverablePhase('calibrated')).toBe(false);
  });
});
