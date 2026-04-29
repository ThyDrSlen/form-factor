/**
 * usePreCalibrationStatus
 *
 * Tracks pre-workout calibration readiness for the form-tracking overlay
 * modal. The hook owns the running confidence + frame counters; the modal
 * screen calls `markSuccess` / `markFailed` and `recordFrame(confidence)` to
 * advance state.
 *
 * `shouldShow` derives from AsyncStorage suppression: after the user has
 * completed *2* successful pre-calibration runs, the modal hides itself on
 * subsequent workouts (still surfacing for `failed` recoveries).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalibrationStatus } from '@/lib/types/workout-session';

const STORAGE_KEY = 'preCalibration.successCount';
const SUPPRESS_AFTER_SUCCESS_COUNT = 2;
const SUFFICIENT_CONFIDENCE = 0.75;
const REQUIRED_FRAMES = 30;

export interface PreCalibrationStatus {
  /** Lifecycle status — pending until enough frames + confidence collected. */
  status: CalibrationStatus;
  /** Mean confidence across collected frames (0-1). */
  confidence: number;
  /** Number of frames observed in the current pre-calibration session. */
  framesObserved: number;
  /** Whether the modal should mount at all (false after suppression cap). */
  shouldShow: boolean;
  /**
   * When true, the next session start bypasses the suppression check and
   * forces the pre-calibration modal to surface again even if the user
   * hit the success cap. Flipped by `setForceRecalibration(true)` from
   * the pre-set UI; consumed + reset by `reset()` so the force applies
   * only to the next session boundary.
   */
  forceRecalibration: boolean;
}

export interface UsePreCalibrationStatusReturn {
  status: PreCalibrationStatus;
  /** Push a per-frame confidence sample. Auto-marks success on convergence. */
  recordFrame: (confidence: number) => void;
  /** Mark the calibration as user-confirmed success. Persists suppression. */
  markSuccess: () => Promise<void>;
  /** Mark the calibration as failed (user cancel / timeout). */
  markFailed: () => void;
  /** Reset all collected state — used when a fresh workout begins. */
  reset: () => void;
  /** Toggle the one-shot force-recalibration flag from the pre-set UI. */
  setForceRecalibration: (value: boolean) => void;
}

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

export function usePreCalibrationStatus(): UsePreCalibrationStatusReturn {
  const [status, setStatus] = useState<PreCalibrationStatus>({
    status: 'pending',
    confidence: 0,
    framesObserved: 0,
    shouldShow: true,
    forceRecalibration: false,
  });
  const sumRef = useRef(0);
  const countRef = useRef(0);
  const completedSuccessRef = useRef(false);

  // Hydrate suppression state from AsyncStorage on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const successCount = raw ? Number(raw) : 0;
        if (!cancelled) {
          setStatus((prev) => ({
            ...prev,
            shouldShow: successCount < SUPPRESS_AFTER_SUCCESS_COUNT,
          }));
        }
      } catch {
        // AsyncStorage unavailable — default to showing (safe).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reset = useCallback(() => {
    sumRef.current = 0;
    countRef.current = 0;
    completedSuccessRef.current = false;
    setStatus((prev) => ({
      status: 'pending',
      confidence: 0,
      framesObserved: 0,
      shouldShow: prev.shouldShow,
      // Consume the one-shot force flag on reset so it only applies to
      // the session boundary immediately following the user toggle.
      forceRecalibration: false,
    }));
  }, []);

  const setForceRecalibration = useCallback((value: boolean) => {
    setStatus((prev) => {
      if (prev.forceRecalibration === value) return prev;
      return {
        ...prev,
        // When the user explicitly asks to recalibrate, ensure shouldShow
        // is true for the upcoming session boundary regardless of the
        // stored suppression count. reset() later drops the force flag.
        shouldShow: value ? true : prev.shouldShow,
        forceRecalibration: value,
      };
    });
  }, []);

  const markFailed = useCallback(() => {
    setStatus((prev) => ({
      ...prev,
      status: 'failed',
    }));
  }, []);

  const markSuccess = useCallback(async () => {
    if (completedSuccessRef.current) return;
    completedSuccessRef.current = true;
    setStatus((prev) => ({
      ...prev,
      status: 'success',
    }));
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const next = (raw ? Number(raw) : 0) + 1;
      await AsyncStorage.setItem(STORAGE_KEY, String(next));
      if (next >= SUPPRESS_AFTER_SUCCESS_COUNT) {
        setStatus((prev) => ({ ...prev, shouldShow: false }));
      }
    } catch {
      // Best-effort persistence; failing silently keeps the user unblocked.
    }
  }, []);

  const recordFrame = useCallback(
    (rawConfidence: number) => {
      const c = clamp01(rawConfidence);
      sumRef.current += c;
      countRef.current += 1;
      const mean = sumRef.current / countRef.current;
      const frames = countRef.current;

      setStatus((prev) => ({
        ...prev,
        confidence: Number(mean.toFixed(3)),
        framesObserved: frames,
      }));

      // Auto-success once thresholds reached.
      if (
        !completedSuccessRef.current &&
        frames >= REQUIRED_FRAMES &&
        mean >= SUFFICIENT_CONFIDENCE
      ) {
        // Fire-and-forget — caller does not await.
        void markSuccess();
      }
    },
    [markSuccess]
  );

  return {
    status,
    recordFrame,
    markSuccess,
    markFailed,
    reset,
    setForceRecalibration,
  };
}

export const PRE_CALIBRATION_CONSTANTS = {
  SUPPRESS_AFTER_SUCCESS_COUNT,
  SUFFICIENT_CONFIDENCE,
  REQUIRED_FRAMES,
  STORAGE_KEY,
} as const;

export default usePreCalibrationStatus;
