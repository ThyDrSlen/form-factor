export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
};

/**
 * Minimum font size permitted anywhere in the tracking HUD. Apple HIG caps
 * the smallest legible caption at 11pt; WCAG echoes this with a 1.3x scale
 * allowance. Keep this in sync with `lib/a11y/typography.ts::MIN_FONT_SIZE`.
 */
export const MIN_FONT_SIZE = 11;
