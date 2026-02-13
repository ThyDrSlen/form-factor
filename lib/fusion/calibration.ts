import type { Vec3 } from '@/lib/fusion/contracts';

export type CalibrationPhase = 'idle' | 'collecting' | 'calibrated' | 'recalibration_required';

export interface CalibrationSample {
  cameraUp: Vec3;
  watchForward: Vec3;
  headForward: Vec3;
  stability: number;
}

export interface CalibrationState {
  phase: CalibrationPhase;
  startedAtMs: number | null;
  completedAtMs: number | null;
  samples: CalibrationSample[];
}

export interface CalibrationResult {
  phase: CalibrationPhase;
  confidence: number;
  cameraUp: Vec3;
  watchForward: Vec3;
  headForward: Vec3;
  startedAtMs: number;
  completedAtMs: number;
}

export interface CalibrationDriftResult {
  requiresRecalibration: boolean;
  driftDeg: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v: Vec3): Vec3 {
  const mag = magnitude(v);
  if (mag <= Number.EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const na = normalize(a);
  const nb = normalize(b);
  const cosine = clamp(dot(na, nb), -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

function averageVector(vectors: Vec3[]): Vec3 {
  if (vectors.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const sum = vectors.reduce(
    (acc, current) => ({
      x: acc.x + current.x,
      y: acc.y + current.y,
      z: acc.z + current.z,
    }),
    { x: 0, y: 0, z: 0 }
  );

  return normalize({
    x: sum.x / vectors.length,
    y: sum.y / vectors.length,
    z: sum.z / vectors.length,
  });
}

function computeConfidence(samples: CalibrationSample[], baselineHeadForward: Vec3): number {
  if (samples.length === 0) {
    return 0;
  }

  const avgStability = samples.reduce((sum, sample) => sum + clamp(sample.stability, 0, 1), 0) / samples.length;
  const meanHeadDrift =
    samples.reduce((sum, sample) => sum + angleBetweenDeg(sample.headForward, baselineHeadForward), 0) /
    samples.length;
  const driftPenalty = clamp(meanHeadDrift / 60, 0, 0.35);
  return clamp(avgStability - driftPenalty, 0, 1);
}

export function createCalibrationState(): CalibrationState {
  return {
    phase: 'idle',
    startedAtMs: null,
    completedAtMs: null,
    samples: [],
  };
}

export function beginCalibration(state: CalibrationState, startedAtMs: number): void {
  state.phase = 'collecting';
  state.startedAtMs = startedAtMs;
  state.completedAtMs = null;
  state.samples = [];
}

export function collectCalibrationSample(state: CalibrationState, sample: CalibrationSample): void {
  if (state.phase !== 'collecting') {
    return;
  }
  state.samples.push(sample);
}

export function finalizeCalibration(state: CalibrationState, completedAtMs: number): CalibrationResult | null {
  if (state.phase !== 'collecting' || state.startedAtMs === null || state.samples.length === 0) {
    return null;
  }

  const cameraUp = averageVector(state.samples.map((sample) => sample.cameraUp));
  const watchForward = averageVector(state.samples.map((sample) => sample.watchForward));
  const headForward = averageVector(state.samples.map((sample) => sample.headForward));
  const confidence = computeConfidence(state.samples, headForward);

  state.phase = 'calibrated';
  state.completedAtMs = completedAtMs;

  return {
    phase: state.phase,
    confidence,
    cameraUp,
    watchForward,
    headForward,
    startedAtMs: state.startedAtMs,
    completedAtMs,
  };
}

export function evaluateCalibrationDrift(input: {
  baselineForward: Vec3;
  currentForward: Vec3;
  maxDriftDeg: number;
}): CalibrationDriftResult {
  const driftDeg = angleBetweenDeg(input.baselineForward, input.currentForward);
  return {
    requiresRecalibration: driftDeg > input.maxDriftDeg,
    driftDeg,
  };
}
