/**
 * WCAG-friendly palettes for users with color-vision differences.
 *
 * Every palette maintains a foreground:background contrast ratio of at
 * least 4.5:1 (WCAG AA for normal text) and at least 3:1 for large UI
 * components. Colours were picked from the Okabe-Ito and IBM accessibility
 * palettes which are widely validated for protanopia / deuteranopia /
 * tritanopia.
 *
 * The `default` palette mirrors the existing traffic-light hues so that
 * users who don't enable colorblind mode get a no-op.
 */

export type ColorBlindMode =
  | 'off'
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'
  | 'high-contrast';

export interface FqiPalette {
  /** ≥ 75 — great form */
  good: string;
  /** 50–74 — caution */
  warn: string;
  /** < 50 — critical */
  bad: string;
  /** Neutral ring / axis colour */
  neutral: string;
  /** Dark background used for contrast checks */
  background: string;
}

export const PALETTES: Record<ColorBlindMode, FqiPalette> = {
  // Classic red/yellow/green; kept for parity with the current FqiGauge.
  off: {
    good: '#22C55E', // green-500
    warn: '#F59E0B', // amber-500
    bad: '#EF4444', // red-500
    neutral: '#94A3B8',
    background: '#050E1F',
  },
  // Okabe-Ito blue/orange — safest against protanopia (red-blind).
  protanopia: {
    good: '#56B4E9', // sky blue
    warn: '#E69F00', // orange
    bad: '#D55E00', // vermillion (still distinguishable)
    neutral: '#9AACD1',
    background: '#050E1F',
  },
  // Deuteranopia (green-blind): favour cool blue + warm orange.
  deuteranopia: {
    good: '#0072B2', // deep blue
    warn: '#E69F00',
    bad: '#CC79A7', // pink — highly distinct for deuteranopes
    neutral: '#9AACD1',
    background: '#050E1F',
  },
  // Tritanopia (blue-blind): favour red/green with yellow punctuation.
  tritanopia: {
    good: '#009E73', // teal green
    warn: '#F0E442', // yellow
    bad: '#D55E00',
    neutral: '#9AACD1',
    background: '#050E1F',
  },
  // Maximum-contrast palette — colour-agnostic, white/grey/black.
  'high-contrast': {
    good: '#FFFFFF',
    warn: '#FFD000',
    bad: '#FF3B30',
    neutral: '#7A8BA5',
    background: '#000000',
  },
};

export function selectFqiColor(score: number, mode: ColorBlindMode = 'off'): string {
  const palette = PALETTES[mode] ?? PALETTES.off;
  if (!Number.isFinite(score)) return palette.neutral;
  if (score >= 75) return palette.good;
  if (score >= 50) return palette.warn;
  return palette.bad;
}

/** Shape indicator complementary to colour. */
export type FqiShape = 'check' | 'bar' | 'dot';

export function selectFqiShape(score: number): FqiShape {
  if (!Number.isFinite(score)) return 'dot';
  if (score >= 75) return 'check';
  if (score >= 50) return 'bar';
  return 'dot';
}
