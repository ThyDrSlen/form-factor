/**
 * Rep Counter Overlay — 3D→2D projection helpers.
 *
 * The body-anchored rep counter mounts inside the existing scan-arkit SVG
 * layer. It renders a large rep number near the user's hip joint so the
 * user gets immediate visual feedback mid-rep without scanning the HUD.
 *
 * Service responsibilities:
 *   - Project the 3D hip joint into the 2D overlay coordinate space.
 *   - Cull the overlay when joint confidence is below 0.6 (occlusion guard).
 *   - Compute the active opacity given the workout phase
 *     ("rest" → fade out so the counter does not nag during recovery).
 *
 * The component (`RepCounterOverlay`) is presentational and consumes the
 * `RepCounterPosition` returned here.
 */

import type { Joint2D, Joint3D } from '@/lib/arkit/ARKitBodyTracker';

/** Confidence threshold below which we hide the counter (occlusion). */
export const OCCLUSION_CONFIDENCE_THRESHOLD = 0.6;
/** Fully visible opacity for the counter. */
export const COUNTER_OPACITY_ACTIVE = 1;
/** Faded opacity for the counter while resting between sets. */
export const COUNTER_OPACITY_REST = 0.25;

/** Joint names tried (in order) when locating the hip anchor. */
export const HIP_JOINT_ALIASES = ['hips_joint', 'root', 'spine_4_joint'] as const;

export interface RepCounterPosition {
  /** Normalized 2D coordinate (0-1) of the counter anchor. */
  x: number;
  y: number;
  /** Whether the counter should be rendered at all. */
  visible: boolean;
  /** Opacity 0-1 (lower during rest phase or low-confidence). */
  opacity: number;
}

interface FindHipInput {
  joints2D?: Joint2D[] | null;
  joints3D?: Joint3D[] | null;
}

/**
 * Locate the hip anchor in normalized 2D space. Tries `joints2D` first
 * (already projected by the camera) and falls back to projecting the 3D hip
 * joint with a simple orthographic projection (y inverted to match RN UI).
 */
export function findHipAnchor(input: FindHipInput): { x: number; y: number; isTracked: boolean; confidence: number } | null {
  const { joints2D, joints3D } = input;
  if (joints2D && joints2D.length > 0) {
    for (const alias of HIP_JOINT_ALIASES) {
      const found = joints2D.find((j) => j.name.toLowerCase() === alias);
      if (found) {
        return {
          x: found.x,
          y: found.y,
          isTracked: found.isTracked,
          // Joint2D does not carry a confidence; use isTracked as a proxy.
          confidence: found.isTracked ? 1 : 0,
        };
      }
    }
  }
  if (joints3D && joints3D.length > 0) {
    for (const alias of HIP_JOINT_ALIASES) {
      const found = joints3D.find((j) => j.name.toLowerCase() === alias);
      if (found) {
        // Naive orthographic projection: clamp into 0-1 by translating from
        // ARKit-world coords (origin near user). This is intentionally
        // simple — ARKit's `Joint2D` array is the canonical source. The 3D
        // path exists for tests + headless fixture playback.
        const x = clamp01(0.5 + found.x);
        const y = clamp01(0.5 - found.y);
        return {
          x,
          y,
          isTracked: found.isTracked,
          confidence: found.isTracked ? 1 : 0,
        };
      }
    }
  }
  return null;
}

export interface PositionInputs {
  joints2D?: Joint2D[] | null;
  joints3D?: Joint3D[] | null;
  /** Phase from the workout controller; used to fade during `rest`. */
  phase?: string | null;
  /** Override confidence (e.g., when caller has a smoothed value). */
  confidence?: number;
}

/**
 * Compute the rep-counter position + visibility + opacity from the latest
 * frame inputs. Returns a fully-derived `RepCounterPosition` ready for the
 * SVG overlay.
 */
export function computeRepCounterPosition(input: PositionInputs): RepCounterPosition {
  const anchor = findHipAnchor(input);
  if (!anchor) {
    return { x: 0.5, y: 0.5, visible: false, opacity: 0 };
  }

  const conf = typeof input.confidence === 'number' && Number.isFinite(input.confidence)
    ? clamp01(input.confidence)
    : anchor.confidence;

  // Occlusion guard: hide when confidence is below threshold OR joint is not
  // marked tracked.
  if (!anchor.isTracked || conf < OCCLUSION_CONFIDENCE_THRESHOLD) {
    return {
      x: anchor.x,
      y: anchor.y,
      visible: false,
      opacity: 0,
    };
  }

  const phase = input.phase?.toLowerCase() ?? null;
  const opacity = phase === 'rest' || phase === 'idle'
    ? COUNTER_OPACITY_REST
    : COUNTER_OPACITY_ACTIVE;

  return {
    x: anchor.x,
    y: anchor.y,
    visible: true,
    opacity,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
