/**
 * Apple HIG Design System - Text Component
 * Typography component with Dynamic Type support and accessibility
 */

import * as React from 'react';
import { Text as RNText, TextProps as RNTextProps, TextStyle } from 'react-native';
import { typography } from '../theme';
import { useTheme } from '../ThemeProvider';
import { getTypographyStyle } from '../utils';

interface TextProps extends RNTextProps {
  variant?: keyof typeof typography;
  color?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  weight?: 'normal' | 'bold' | 'semibold' | 'light';
  children: React.ReactNode;
}

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color,
  align = 'left',
  weight,
  style,
  children,
  ...props
}) => {
  const { theme, accessibilityTextSize } = useTheme();

  const baseStyle = getTypographyStyle(variant, accessibilityTextSize);
  
  const textStyle: TextStyle = {
    ...baseStyle,
    color: color || theme.colors.label,
    textAlign: align,
    ...(weight && { fontWeight: weight }),
  };

  const combinedStyle = [textStyle, style];

  return (
    <RNText
      style={combinedStyle}
      allowFontScaling={true}
      maxFontSizeMultiplier={3}
      {...props}
    >
      {children}
    </RNText>
  );
};