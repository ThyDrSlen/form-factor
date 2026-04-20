/**
 * useTrackingLoss
 *
 * Debounced detector for "tracking is lost" during a live ARKit session.
 * Returns `true` once the most recent confidence readings have stayed under
 * `threshold` for at least `debounceMs` milliseconds. Flips back to
 * `false` immediately when confidence recovers above the threshold.
 *
 * The hook is pure JS (no native deps) so it can be tested directly with
 * jest fake timers.
 */

import { useEffect, useRef, useState } from 'react';

export interface UseTrackingLossOptions {
  /** Confidence reading below this is considered "lost". Default 0.3. */
  threshold?: number;
  /** How long confidence must stay below threshold before flipping to true. Default 500ms. */
  debounceMs?: number;
}

export interface UseTrackingLossResult {
  /** True once confidence has been below threshold for debounceMs+. */
  isLost: boolean;
  /** ms since confidence first dropped below threshold, or null. */
  lostForMs: number | null;
}

/**
 * @param confidence Current 0..1 confidence reading, or null when tracking is off.
 */
export function useTrackingLoss(
  confidence: number | null,
  options: UseTrackingLossOptions = {},
): UseTrackingLossResult {
  const { threshold = 0.3, debounceMs = 500 } = options;

  const [isLost, setIsLost] = useState(false);
  const [lostForMs, setLostForMs] = useState<number | null>(null);
  const droppedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };

    // Null confidence == tracking not active. Reset to not-lost.
    if (confidence == null) {
      droppedAtRef.current = null;
      clear();
      setIsLost(false);
      setLostForMs(null);
      return () => clear();
    }

    if (confidence < threshold) {
      if (droppedAtRef.current == null) {
        const startedAt = Date.now();
        droppedAtRef.current = startedAt;
        // schedule flip
        timerRef.current = setTimeout(() => {
          setIsLost(true);
          setLostForMs(Date.now() - startedAt);
          tickRef.current = setInterval(() => {
            setLostForMs(Date.now() - startedAt);
          }, 250);
        }, debounceMs);
      }
    } else {
      droppedAtRef.current = null;
      clear();
      setIsLost(false);
      setLostForMs(null);
    }

    return () => clear();
  }, [confidence, threshold, debounceMs]);

  return { isLost, lostForMs };
}

export default useTrackingLoss;
