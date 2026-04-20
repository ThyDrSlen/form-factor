/**
 * use-calibration-failure-handler
 *
 * Binds to the calibration state stream and, when calibration sits in
 * `recalibration_required` for longer than a debounced window, emits a
 * one-shot failure event so the caller can open the recovery modal.
 *
 * Introduced by issue #479. The hook is purposely decoupled from any
 * UI / router — it returns an analysis + a `consume()` function. The
 * caller decides what to do with the event (navigate, toast, etc.).
 *
 * Telemetry: emits a `calibration_failure` local-telemetry event via a
 * small wrapper (`emitCalibrationFailureTelemetry`) with a
 * `TODO(#431)` comment so that it can route through the coach-telemetry
 * extension once PR #431 lands.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalibrationPhase, CalibrationState } from '@/lib/fusion/calibration';
import {
  analyzeCalibrationFailure,
  type CalibrationFailureAnalysis,
} from '@/lib/services/calibration-failure-analyzer';
import { logWithTs, warnWithTs } from '@/lib/logger';

// =============================================================================
// Telemetry shim (TODO(#431))
// =============================================================================

/**
 * Local lightweight wrapper for the `calibration_failure` telemetry event.
 *
 * TODO(#431): route through coach-telemetry once the extension lands.
 * Until then we log in dev for debugging and keep a call-count counter
 * in-module so integration tests can assert it without a real Supabase.
 */
let calibrationFailureEmitCount = 0;

export function emitCalibrationFailureTelemetry(analysis: CalibrationFailureAnalysis): void {
  calibrationFailureEmitCount += 1;
  if (__DEV__) {
    logWithTs('[calibration-telemetry] calibration_failure', {
      reason: analysis.reason,
      sampleCount: analysis.metrics.sampleCount,
      avgStability: analysis.metrics.avgStability,
      elapsedMs: analysis.metrics.elapsedMs,
      headDriftDegApprox: analysis.metrics.headDriftDegApprox,
    });
  }
}

/** Exposed for tests — do NOT rely on this from product code. */
export function _getCalibrationFailureEmitCount(): number {
  return calibrationFailureEmitCount;
}

/** Exposed for tests — reset the in-module counter. */
export function _resetCalibrationFailureEmitCount(): void {
  calibrationFailureEmitCount = 0;
}

// =============================================================================
// Hook
// =============================================================================

export interface UseCalibrationFailureHandlerInput {
  /** Current calibration phase. */
  phase: CalibrationPhase;
  /** Current calibration state (sample stream). */
  state: CalibrationState | null;
  /** Current monotonic clock value in ms. */
  nowMs: number;
  /** Threshold in ms before we open the modal. Default 8000. */
  thresholdMs?: number;
  /** Disable the whole hook (e.g. during practice mode). */
  disabled?: boolean;
}

export interface UseCalibrationFailureHandlerValue {
  /** True once a failure event has fired and has not been consumed yet. */
  hasFailure: boolean;
  /** Latest analysis — safe to read whenever `hasFailure` is true. */
  analysis: CalibrationFailureAnalysis | null;
  /** Clear the failure state (call when the recovery modal is dismissed). */
  consume: () => void;
}

/**
 * The phase that triggers the debounced failure event.
 */
const TRIGGER_PHASE: CalibrationPhase = 'recalibration_required';

/**
 * Debounce: how long the phase must remain in `recalibration_required`
 * before the hook decides calibration has truly failed (prevents flicker).
 */
const DEFAULT_THRESHOLD_MS = 8000;

export function useCalibrationFailureHandler(
  input: UseCalibrationFailureHandlerInput
): UseCalibrationFailureHandlerValue {
  const { phase, state, nowMs, thresholdMs = DEFAULT_THRESHOLD_MS, disabled = false } = input;

  const [analysis, setAnalysis] = useState<CalibrationFailureAnalysis | null>(null);
  const enteredAtRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (disabled) {
      enteredAtRef.current = null;
      firedRef.current = false;
      return;
    }

    if (phase !== TRIGGER_PHASE) {
      // Phase changed away from recalibration_required — reset the clock.
      enteredAtRef.current = null;
      firedRef.current = false;
      return;
    }

    if (enteredAtRef.current === null) {
      enteredAtRef.current = nowMs;
      return;
    }

    const dwellMs = nowMs - enteredAtRef.current;
    if (dwellMs >= thresholdMs && !firedRef.current && state) {
      firedRef.current = true;
      try {
        const next = analyzeCalibrationFailure({ state, nowMs });
        setAnalysis(next);
        emitCalibrationFailureTelemetry(next);
      } catch (error) {
        warnWithTs('[use-calibration-failure-handler] analysis failed', error);
      }
    }
  }, [phase, state, nowMs, thresholdMs, disabled]);

  const consume = useCallback<UseCalibrationFailureHandlerValue['consume']>(() => {
    setAnalysis(null);
    firedRef.current = false;
    enteredAtRef.current = null;
  }, []);

  return {
    hasFailure: analysis !== null,
    analysis,
    consume,
  };
}
