/**
 * Typography accessibility helpers.
 *
 * `scaled(px, opts)` multiplies a design-time pixel value by the user's
 * system font scale (`PixelRatio.getFontScale()`) and clamps the result so
 * that tracking-HUD text never explodes past a sensible upper bound or
 * collapses below the Apple HIG 11pt minimum.
 */

import { PixelRatio } from 'react-native';

export const MIN_FONT_SIZE = 11;
/** Hard floor after scaling — prevents sub-11pt display on the tracking HUD. */
export const TRACKING_FONT_FLOOR = MIN_FONT_SIZE;
/** Soft upper cap on how much the system may scale a HUD string. */
export const MAX_FONT_SCALE = 1.3;

export interface ScaledOptions {
  /** Minimum resulting pixel size (defaults to {@link MIN_FONT_SIZE}). */
  min?: number;
  /** Maximum resulting pixel size. Defaults to `px * MAX_FONT_SCALE`. */
  max?: number;
  /** Maximum scale multiplier. Overrides global cap if provided. */
  maxScale?: number;
}

/**
 * Return a rounded, clamped font size that reflects the user's OS font-scale
 * preference without breaking the tracking HUD layout. Accepts both the
 * design-time pixel value and optional min/max overrides.
 */
export function scaled(px: number, opts?: ScaledOptions): number {
  const maxScale = opts?.maxScale ?? MAX_FONT_SCALE;
  const rawScale = safeGetFontScale();
  const scale = Math.min(Math.max(rawScale, 1), maxScale);
  const raw = px * scale;
  const min = opts?.min ?? MIN_FONT_SIZE;
  const max = opts?.max ?? Math.max(min, px * maxScale);
  // `max` must never clamp below `min`; otherwise the floor loses.
  const effectiveMax = Math.max(min, max);
  const clamped = Math.min(Math.max(raw, min), effectiveMax);
  return Math.round(clamped);
}

function safeGetFontScale(): number {
  try {
    const scale = PixelRatio.getFontScale();
    return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
  } catch {
    return 1;
  }
}
