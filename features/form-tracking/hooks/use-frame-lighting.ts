/**
 * useFrameLighting — debounced subscription to frame-brightness updates.
 *
 * Consumers (the lighting badge in scan-arkit, future telemetry surfaces)
 * call `report(brightness)` from their per-frame hook with a 0-255 mean. The
 * hook smooths via `LightingSmoother`, debounces emissions to ~100 ms, and
 * exposes the latest `LightingReading`.
 *
 * Decoupled from ARKit native plumbing — caller decides where the brightness
 * mean comes from (pose-logger sample, MediaPipe luminance, future sensor).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeLighting,
  LightingSmoother,
  type LightingReading,
} from '@/lib/services/lighting-detector';

const DEFAULT_DEBOUNCE_MS = 100;

export interface UseFrameLightingOptions {
  /**
   * Minimum interval between reading updates (ms). Defaults to 100 ms.
   */
  debounceMs?: number;
  /**
   * Median-filter window length, passed to `LightingSmoother`. Defaults to 3.
   */
  smoothingWindow?: number;
  /**
   * Optional precomputed histogram passthrough. The hook accepts a histogram
   * via `report` instead of this option for per-frame variance.
   */
  initialReading?: LightingReading;
}

export interface UseFrameLightingReturn {
  /** Latest debounced reading. `null` until the first frame arrives. */
  reading: LightingReading | null;
  /**
   * Push a new brightness sample (0-255 mean). Optional histogram bins are
   * passed through verbatim to the analyzer.
   */
  report: (brightness: number, histogram?: number[]) => void;
  /** Reset internal smoother + clear the latest reading. */
  reset: () => void;
}

/**
 * Hook entry — see file-level doc for usage.
 */
export function useFrameLighting(
  options: UseFrameLightingOptions = {}
): UseFrameLightingReturn {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const smoothingWindow = options.smoothingWindow ?? 3;

  const [reading, setReading] = useState<LightingReading | null>(
    options.initialReading ?? null
  );
  const smootherRef = useRef<LightingSmoother>(new LightingSmoother(smoothingWindow));
  const lastEmitMsRef = useRef<number>(0);
  const pendingHistogramRef = useRef<number[] | undefined>(undefined);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-create smoother if windowSize prop changes after mount.
  useEffect(() => {
    smootherRef.current = new LightingSmoother(smoothingWindow);
  }, [smoothingWindow]);

  // Cleanup pending timer on unmount.
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  const flush = useCallback((smoothed: number) => {
    const next = analyzeLighting({
      brightness: smoothed,
      histogram: pendingHistogramRef.current,
    });
    pendingHistogramRef.current = undefined;
    lastEmitMsRef.current = Date.now();
    setReading(next);
  }, []);

  const report = useCallback(
    (brightness: number, histogram?: number[]) => {
      const smoothed = smootherRef.current.push(brightness);
      if (histogram) pendingHistogramRef.current = histogram;

      const now = Date.now();
      const elapsed = now - lastEmitMsRef.current;

      if (lastEmitMsRef.current === 0 || elapsed >= debounceMs) {
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        flush(smoothed);
        return;
      }

      // Debounce: schedule a trailing flush if one is not already pending.
      if (!pendingTimerRef.current) {
        pendingTimerRef.current = setTimeout(() => {
          pendingTimerRef.current = null;
          flush(smoothed);
        }, debounceMs - elapsed);
      }
    },
    [debounceMs, flush]
  );

  const reset = useCallback(() => {
    smootherRef.current.reset();
    pendingHistogramRef.current = undefined;
    lastEmitMsRef.current = 0;
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setReading(null);
  }, []);

  return { reading, report, reset };
}

export default useFrameLighting;
