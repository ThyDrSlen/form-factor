/**
 * useHapticWiring
 *
 * Observes transient tracking signals (tracking-loss, FQI bucket changes)
 * and emits the corresponding events on the haptic bus. Sits next to the
 * scan-arkit tree so its inputs stay close to the data that drives them,
 * without having to modify the PR #424 tracking-loss hook directly.
 *
 * Returns nothing; all side-effects go through `hapticBus.emit`.
 */

import { useEffect, useRef } from 'react';
import { hapticBus } from '@/lib/haptics/haptic-bus';

export interface UseHapticWiringInput {
  /** True while ARKit is actively tracking a body. */
  isTracking: boolean;
  /** Normalized 0..1 tracking-quality score, or undefined when unknown. */
  trackingQuality?: number;
  /** Current FQI bucket (e.g. 0-49, 50-74, 75-89, 90+). */
  fqiBucket?: number | null;
}

/** Threshold below which tracking counts as "lost". */
const LOST_THRESHOLD = 0.25;
/** Hysteresis buffer so we don't flap around LOST_THRESHOLD. */
const RECOVERED_THRESHOLD = 0.5;

export function useHapticWiring(input: UseHapticWiringInput): void {
  const { isTracking, trackingQuality, fqiBucket } = input;

  const lastQualityStateRef = useRef<'ok' | 'lost' | null>(null);
  const lastFqiBucketRef = useRef<number | null>(null);

  // Reset state whenever tracking stops — we don't want a stale quality
  // reading to emit as soon as tracking resumes.
  useEffect(() => {
    if (!isTracking) {
      lastQualityStateRef.current = null;
      lastFqiBucketRef.current = null;
    }
  }, [isTracking]);

  useEffect(() => {
    if (!isTracking || typeof trackingQuality !== 'number') return;

    const prev = lastQualityStateRef.current;
    if (trackingQuality <= LOST_THRESHOLD && prev !== 'lost') {
      lastQualityStateRef.current = 'lost';
      hapticBus.emit('tracking.lost');
    } else if (trackingQuality >= RECOVERED_THRESHOLD && prev === 'lost') {
      lastQualityStateRef.current = 'ok';
      hapticBus.emit('tracking.recovered');
    } else if (trackingQuality > LOST_THRESHOLD && prev === null) {
      // Establish baseline without emitting.
      lastQualityStateRef.current = 'ok';
    }
  }, [isTracking, trackingQuality]);

  useEffect(() => {
    if (!isTracking || fqiBucket == null) return;
    const prev = lastFqiBucketRef.current;
    if (prev === null) {
      lastFqiBucketRef.current = fqiBucket;
      return;
    }
    if (fqiBucket < prev) {
      hapticBus.emit('fqi.bucket-down');
    } else if (fqiBucket > prev) {
      hapticBus.emit('fqi.bucket-up');
    }
    lastFqiBucketRef.current = fqiBucket;
  }, [isTracking, fqiBucket]);
}

export default useHapticWiring;
