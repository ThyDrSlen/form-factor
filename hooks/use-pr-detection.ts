/**
 * usePRDetection
 *
 * Thin React hook that wraps `lib/services/pr-detector.detectNewPR` so the
 * scan-arkit post-session flow can fire a PR check once per completed set
 * without baking Supabase calls into its render tree.
 *
 * Usage:
 *   const { pr, checkForPR, clearPR } = usePRDetection();
 *   // when set completes:
 *   await checkForPR(userId, exerciseId, { weight, reps, avgFqi });
 *   // later:
 *   <PRCelebrationBadge pr={pr} onDismiss={clearPR} />
 *
 * Issue #447 W3-C item #2.
 */

import { useCallback, useRef, useState } from 'react';
import { detectNewPR, type PRResult, type Set as PRSet } from '@/lib/services/pr-detector';
import { errorWithTs } from '@/lib/logger';

export interface UsePRDetectionResult {
  /** Current PR (if any). Null when none detected yet or after `clearPR()`. */
  pr: PRResult | null;
  /** Runs the PR query. No-ops if a check is already in-flight. Returns the PR or null. */
  checkForPR: (userId: string, exerciseId: string, set: PRSet) => Promise<PRResult | null>;
  /** Clear any outstanding PR (e.g. after badge dismiss or modal close). */
  clearPR: () => void;
  /** True while a detectNewPR call is in flight. */
  isChecking: boolean;
}

export function usePRDetection(): UsePRDetectionResult {
  const [pr, setPR] = useState<PRResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const inFlight = useRef(false);

  const checkForPR = useCallback(
    async (userId: string, exerciseId: string, set: PRSet): Promise<PRResult | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setIsChecking(true);
      try {
        const result = await detectNewPR(userId, exerciseId, set);
        if (result) setPR(result);
        return result;
      } catch (err) {
        // detectNewPR already logs & returns null on error, but catch here as
        // a belt-and-braces guard so the hook never throws into the render tree.
        errorWithTs('[usePRDetection] Unexpected error in checkForPR', err);
        return null;
      } finally {
        inFlight.current = false;
        setIsChecking(false);
      }
    },
    [],
  );

  const clearPR = useCallback(() => {
    setPR(null);
  }, []);

  return { pr, checkForPR, clearPR, isChecking };
}
