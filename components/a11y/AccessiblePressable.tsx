/**
 * AccessiblePressable
 *
 * Thin wrapper over `<Pressable>` that guarantees the rendered control has
 * at least a 44x44pt hit region. If the provided style produces a smaller
 * rectangle, a `hitSlop` is auto-computed so the effective hit region still
 * meets Apple HIG / WCAG 2.5.5.
 *
 * Callers must supply `accessibilityRole` and `accessibilityLabel`.
 */

import React from 'react';
import {
  Pressable,
  type PressableProps,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type Insets,
} from 'react-native';
import { MIN_TOUCH, hitSlopFor } from '@/lib/a11y/HitTargets';

export interface AccessiblePressableProps extends PressableProps {
  /** Required a11y role. */
  accessibilityRole: NonNullable<PressableProps['accessibilityRole']>;
  /** Required a11y label. */
  accessibilityLabel: string;
  /**
   * Opt out of automatic hitSlop expansion. Use this when the control is
   * already guaranteed to be >=44pt by design.
   */
  disableMinHitSlop?: boolean;
}

interface FlattenedSize {
  width?: number;
  height?: number;
}

function readFlattenedSize(style: StyleProp<ViewStyle>): FlattenedSize {
  const flat = StyleSheet.flatten(style);
  if (!flat) return {};
  return {
    width: typeof flat.width === 'number' ? flat.width : undefined,
    height: typeof flat.height === 'number' ? flat.height : undefined,
  };
}

export const AccessiblePressable = React.forwardRef<React.ComponentRef<typeof Pressable>, AccessiblePressableProps>(
  function AccessiblePressable(
    { style, hitSlop, disableMinHitSlop, children, ...rest },
    ref,
  ) {
    // Resolve static style to see whether a hitSlop bump is needed.
    const staticStyle = typeof style === 'function' ? undefined : style;
    const size = readFlattenedSize(staticStyle);
    const smaller = Math.min(size.width ?? Infinity, size.height ?? Infinity);
    const autoSlop = disableMinHitSlop || smaller >= MIN_TOUCH ? undefined : hitSlopFor(smaller);

    // Caller-provided hitSlop takes precedence; otherwise use the auto value.
    const resolvedHitSlop: Insets | undefined = (hitSlop as Insets | undefined) ?? autoSlop;

    return (
      <Pressable ref={ref} style={style} hitSlop={resolvedHitSlop} {...rest}>
        {children}
      </Pressable>
    );
  },
);

export default AccessiblePressable;
