/**
 * AccessibleText
 *
 * Drop-in replacement for `<Text>` that defaults to accessibility-friendly
 * font-scaling behaviour:
 *   - `allowFontScaling` defaults to true (respect OS Dynamic Type)
 *   - `maxFontSizeMultiplier` defaults to {@link MAX_FONT_SCALE} so HUD
 *     layouts never explode when the user picks the largest text size.
 *
 * Passes through every other Text prop unchanged.
 */

import React from 'react';
import { Text, type TextProps } from 'react-native';
import { MAX_FONT_SCALE } from './typography';

export type AccessibleTextProps = TextProps;

export const AccessibleText = React.forwardRef<Text, AccessibleTextProps>(function AccessibleText(
  { allowFontScaling = true, maxFontSizeMultiplier = MAX_FONT_SCALE, ...rest },
  ref,
) {
  return (
    <Text
      ref={ref}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
    />
  );
});

export default AccessibleText;
