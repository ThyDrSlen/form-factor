/**
 * Calibration Failure Analyzer
 *
 * Pure classifier over `CalibrationState` samples. Given a partial
 * calibration attempt that failed or stalled, returns a reason code,
 * human-friendly remediation copy, and optionally a suggested exercise
 * the user could fall back to.
 *
 * Used by `hooks/use-calibration-failure-handler.ts` (and the
 * `app/(modals)/calibration-failure-recovery.tsx` modal) to surface a
 * recovery UX instead of silently stalling in `recalibration_required`.
 *
 * Introduced by issue #479.
 */

import type { CalibrationPhase, CalibrationState } from '@/lib/fusion/calibration';

// =============================================================================
// Types
// =============================================================================

export type CalibrationFailureReason =
  | 'low_stability'
  | 'insufficient_samples'
  | 'excessive_drift'
  | 'timeout';

export interface CalibrationFailureAnalysis {
  reason: CalibrationFailureReason;
  /** One-liner headline copy for the modal header. */
  title: string;
  /** Longer remediation suggestion (1-2 sentences). */
  remediation: string;
  /** Optional suggested exercise the user could try instead. */
  suggestedExercise?: string;
  /** Raw metrics that drove the classification (for telemetry / tests). */
  metrics: {
    sampleCount: number;
    avgStability: number;
    elapsedMs: number | null;
    headDriftDegApprox: number;
  };
}

export interface AnalyzeCalibrationInput {
  state: CalibrationState;
  nowMs: number;
  /** Upper bound for how long calibration should take before we consider it timed-out. */
  timeoutMs?: number;
  /** Minimum stability (0-1) below which we call it `low_stability`. */
  minStability?: number;
  /** Minimum sample count expected before finalise. */
  minSamples?: number;
  /** Head drift in degrees above which we call it `excessive_drift`. */
  maxDriftDeg?: number;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MIN_STABILITY = 0.55;
const DEFAULT_MIN_SAMPLES = 30;
const DEFAULT_MAX_DRIFT_DEG = 25;

// =============================================================================
// Helpers
// =============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function avgStability(state: CalibrationState): number {
  if (state.samples.length === 0) return 0;
  const sum = state.samples.reduce(
    (acc, sample) => acc + clamp(sample.stability, 0, 1),
    0
  );
  return sum / state.samples.length;
}

function approxHeadDriftDeg(state: CalibrationState): number {
  if (state.samples.length < 2) return 0;
  // Simple worst-pair approximation: compare first and last headForward angles.
  const first = state.samples[0].headForward;
  const last = state.samples[state.samples.length - 1].headForward;
  const dot =
    first.x * last.x + first.y * last.y + first.z * last.z;
  const magFirst = Math.sqrt(first.x ** 2 + first.y ** 2 + first.z ** 2);
  const magLast = Math.sqrt(last.x ** 2 + last.y ** 2 + last.z ** 2);
  if (magFirst <= Number.EPSILON || magLast <= Number.EPSILON) return 0;
  const cosine = clamp(dot / (magFirst * magLast), -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

function elapsedMs(state: CalibrationState, nowMs: number): number | null {
  if (state.startedAtMs === null) return null;
  return Math.max(0, nowMs - state.startedAtMs);
}

// =============================================================================
// Reason-specific suggestions
// =============================================================================

function suggestionFor(reason: CalibrationFailureReason): {
  title: string;
  remediation: string;
  suggestedExercise?: string;
} {
  switch (reason) {
    case 'low_stability':
      return {
        title: 'Hold still for calibration',
        remediation:
          'The camera isn\'t getting a steady read. Place the phone on a stable surface, step into view, and stand relaxed for 3 seconds before retrying.',
        suggestedExercise: 'dead_hang',
      };
    case 'insufficient_samples':
      return {
        title: 'Not enough data yet',
        remediation:
          'Calibration needs you fully in frame. Step back so your whole body is visible, then hit retry.',
        suggestedExercise: 'squat',
      };
    case 'excessive_drift':
      return {
        title: 'You drifted out of frame',
        remediation:
          'The tracking frame is moving. Steady the phone, check you\'re inside the guide markers, and try again.',
        suggestedExercise: 'pushup',
      };
    case 'timeout':
    default:
      return {
        title: 'Calibration timed out',
        remediation:
          'We couldn\'t lock in a baseline. Check lighting and camera framing, then retry. If it keeps happening, open the camera placement guide.',
        suggestedExercise: undefined,
      };
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Classify a stalled or failed calibration attempt.
 *
 * This function is pure — it does not read the clock internally or
 * trigger any side effects. Pass the current time explicitly.
 */
export function analyzeCalibrationFailure(
  input: AnalyzeCalibrationInput
): CalibrationFailureAnalysis {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minStability = input.minStability ?? DEFAULT_MIN_STABILITY;
  const minSamples = input.minSamples ?? DEFAULT_MIN_SAMPLES;
  const maxDriftDeg = input.maxDriftDeg ?? DEFAULT_MAX_DRIFT_DEG;

  const state = input.state;
  const stability = avgStability(state);
  const driftDeg = approxHeadDriftDeg(state);
  const elapsed = elapsedMs(state, input.nowMs);

  const reason = classify({
    elapsed,
    timeoutMs,
    sampleCount: state.samples.length,
    minSamples,
    stability,
    minStability,
    driftDeg,
    maxDriftDeg,
  });

  const suggestion = suggestionFor(reason);

  return {
    reason,
    title: suggestion.title,
    remediation: suggestion.remediation,
    suggestedExercise: suggestion.suggestedExercise,
    metrics: {
      sampleCount: state.samples.length,
      avgStability: stability,
      elapsedMs: elapsed,
      headDriftDegApprox: driftDeg,
    },
  };
}

interface ClassifyArgs {
  elapsed: number | null;
  timeoutMs: number;
  sampleCount: number;
  minSamples: number;
  stability: number;
  minStability: number;
  driftDeg: number;
  maxDriftDeg: number;
}

function classify(args: ClassifyArgs): CalibrationFailureReason {
  // Drift is the loudest signal — if the user has physically moved, nothing
  // else matters. Check it first.
  if (args.driftDeg > args.maxDriftDeg) {
    return 'excessive_drift';
  }

  // Low stability trumps sample count: we collected samples but they're
  // noisy. Tell the user to hold still rather than step further back.
  if (args.sampleCount >= Math.max(10, Math.floor(args.minSamples / 3)) && args.stability < args.minStability) {
    return 'low_stability';
  }

  // If we haven't accumulated enough samples and we haven't run out the clock,
  // the user probably isn't in-frame.
  if (args.sampleCount < args.minSamples) {
    if (args.elapsed !== null && args.elapsed > args.timeoutMs) {
      return 'timeout';
    }
    return 'insufficient_samples';
  }

  // Past minimum samples, at acceptable stability, and not drifting — but we
  // still failed. Must be a timeout.
  if (args.elapsed !== null && args.elapsed > args.timeoutMs) {
    return 'timeout';
  }

  return 'timeout';
}

/**
 * Utility for callers that only want to know whether a `CalibrationPhase`
 * warrants surfacing the recovery modal.
 */
export function isRecoverablePhase(phase: CalibrationPhase): boolean {
  return phase === 'recalibration_required' || phase === 'collecting';
}
