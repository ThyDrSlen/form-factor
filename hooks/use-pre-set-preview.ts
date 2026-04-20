/**
 * React hook wrapper around `checkPreSetStance` (issue #460).
 *
 * Exposes the minimum state the UI needs to render the stance-preview
 * modal: a loading flag, the latest verdict (if any), any error, and
 * two imperative handles (`check`, `reset`). Callers pass the
 * FrameSnapshot + JointAngles + exercise name when they invoke
 * `check`; the hook takes care of single-flight guards (a second
 * `check()` while the first is in flight is ignored) and mount safety.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameSnapshot, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import {
  checkPreSetStance,
  type PreSetPreviewResult,
} from '@/lib/services/pre-set-preview';

export interface UsePreSetPreviewState {
  isChecking: boolean;
  verdict: PreSetPreviewResult | null;
  error: Error | null;
  check: (
    snapshot: FrameSnapshot,
    exerciseName: string,
    jointAngles: JointAngles
  ) => Promise<PreSetPreviewResult | null>;
  reset: () => void;
}

export function usePreSetPreview(): UsePreSetPreviewState {
  const [isChecking, setIsChecking] = useState(false);
  const [verdict, setVerdict] = useState<PreSetPreviewResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const check = useCallback(
    async (
      snapshot: FrameSnapshot,
      exerciseName: string,
      jointAngles: JointAngles
    ): Promise<PreSetPreviewResult | null> => {
      if (inFlightRef.current) {
        return null;
      }
      inFlightRef.current = true;
      setIsChecking(true);
      setError(null);
      try {
        const result = await checkPreSetStance(
          snapshot,
          exerciseName,
          jointAngles
        );
        if (mountedRef.current) {
          setVerdict(result);
        }
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) {
          setError(e);
          setVerdict(null);
        }
        return null;
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) {
          setIsChecking(false);
        }
      }
    },
    []
  );

  const reset = useCallback(() => {
    setVerdict(null);
    setError(null);
    setIsChecking(false);
    inFlightRef.current = false;
  }, []);

  return { isChecking, verdict, error, check, reset };
}
