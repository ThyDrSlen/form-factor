/**
 * HitTarget constants.
 *
 * Apple HIG and WCAG 2.5.5 both call for a minimum 44x44pt touch target.
 * Components that render smaller should still grow their effective hit
 * region via `hitSlop` to meet the spec.
 */

import type { Insets } from 'react-native';

export const MIN_TOUCH = 44;

/**
 * Default hitSlop for a 32x32 control nudged up to 44x44. Symmetric so it
 * can be spread onto any `Pressable`/`TouchableOpacity`.
 */
export const MIN_TOUCH_HIT_SLOP: Insets = Object.freeze({
  top: 6,
  bottom: 6,
  left: 6,
  right: 6,
}) as Insets;

/**
 * Build a `hitSlop` object that expands a rectangle of `actualSize` up to
 * {@link MIN_TOUCH} on every side. Returns `undefined` when the control
 * already meets the minimum.
 */
export function hitSlopFor(actualSize: number, minTouch: number = MIN_TOUCH): Insets | undefined {
  if (actualSize >= minTouch) return undefined;
  const delta = Math.ceil((minTouch - actualSize) / 2);
  return { top: delta, bottom: delta, left: delta, right: delta };
}
