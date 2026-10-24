/**
 * useRepCounterPosition
 *
 * Joins the rep counter (from the workout controller), the visible state
 * (from phase + occlusion guards), and the projected hip anchor (from
 * `rep-counter-overlay`) into a single value object the overlay component
 * can render.
 */

import { useMemo } from 'react';
import type { Joint2D, Joint3D } from '@/lib/arkit/ARKitBodyTracker';
import {
  computeRepCounterPosition,
  type RepCounterPosition,
} from '@/lib/services/rep-counter-overlay';

export interface UseRepCounterPositionInput {
  repCount: number;
  phase?: string | null;
  joints2D?: Joint2D[] | null;
  joints3D?: Joint3D[] | null;
  confidence?: number;
}

export interface UseRepCounterPositionReturn extends RepCounterPosition {
  repCount: number;
}

export function useRepCounterPosition(
  input: UseRepCounterPositionInput
): UseRepCounterPositionReturn {
  const position = useMemo(
    () =>
      computeRepCounterPosition({
        joints2D: input.joints2D,
        joints3D: input.joints3D,
        phase: input.phase,
        confidence: input.confidence,
      }),
    [input.joints2D, input.joints3D, input.phase, input.confidence]
  );

  return { ...position, repCount: input.repCount };
}

export default useRepCounterPosition;
