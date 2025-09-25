/**
 * Apple HIG Design System - Utility Functions
 * Helper functions for working with the design system
 */

import { TextStyle, ViewStyle } from 'react-native';
import { accessibilityTypography, Theme, typography } from './theme';

/**
 * Get typography style with optional accessibility scaling
 */
export const getTypographyStyle = (
  textStyle: keyof typeof typography,
  accessibilitySize: 'default' | 'AX1' | 'AX2' | 'AX3' = 'default'
): TextStyle => {
  if (accessibilitySize === 'default') {
    return typography[textStyle];
  }
  
  const accessibilityStyle = accessibilityTypography[accessibilitySize][textStyle];
  return {
    ...typography[textStyle],
    ...accessibilityStyle,
  };
};

/**
 * Create a style object with proper spacing using the 8pt grid
 */
export const createSpacingStyle = (
  spacing: number | { top?: number; right?: number; bottom?: number; left?: number }
): ViewStyle => {
  if (typeof spacing === 'number') {
    return {
      padding: spacing,
    };
  }

  return {
    paddingTop: spacing.top,
    paddingRight: spacing.right,
    paddingBottom: spacing.bottom,
    paddingLeft: spacing.left,
  };
};

/**
 * Create margin style using the 8pt grid
 */
export const createMarginStyle = (
  margin: number | { top?: number; right?: number; bottom?: number; left?: number }
): ViewStyle => {
  if (typeof margin === 'number') {
    return {
      margin: margin,
    };
  }

  return {
    marginTop: margin.top,
    marginRight: margin.right,
    marginBottom: margin.bottom,
    marginLeft: margin.left,
  };
};

/**
 * Get color with opacity
 */
export const getColorWithOpacity = (color: string, opacity: number): string => {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
    return `#${hex}${alpha}`;
  }
  
  // Handle rgba colors
  if (color.startsWith('rgba')) {
    return color.replace(/[\d\.]+\)$/g, `${opacity})`);
  }
  
  // Handle rgb colors
  if (color.startsWith('rgb')) {
    return color.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
  }
  
  return color;
};

/**
 * Check if a color meets WCAG AA contrast requirements
 */
export const meetsContrastRequirements = (
  foreground: string,
  background: string,
  level: 'AA' | 'AAA' = 'AA'
): boolean => {
  // This is a simplified implementation
  // In a production app, you'd want to use a proper color contrast library
  const requiredRatio = level === 'AA' ? 4.5 : 7;
  
  // For now, return true - implement proper contrast checking with a library like 'color'
  return true;
};

/**
 * Get safe area insets for different device types
 */
export const getSafeAreaInsets = () => {
  // This would typically use react-native-safe-area-context
  // For now, return default values
  return {
    top: 44,
    bottom: 34,
    left: 0,
    right: 0,
  };
};

/**
 * Create a style for cards with proper shadows and borders
 */
export const createCardStyle = (theme: Theme, elevation: 'sm' | 'md' | 'lg' | 'xl' = 'md'): ViewStyle => ({
  backgroundColor: theme.colors.secondarySystemGroupedBackground,
  borderRadius: theme.borderRadius.lg,
  ...theme.shadows[elevation],
  ...(theme.isDark && {
    borderWidth: 1,
    borderColor: theme.colors.separator,
  }),
});

/**
 * Create button style based on Apple's button system
 */
export const createButtonStyle = (
  theme: Theme,
  variant: 'primary' | 'secondary' | 'destructive' = 'primary',
  size: 'small' | 'medium' | 'large' = 'medium'
): ViewStyle => {
  const baseStyle: ViewStyle = {
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  };

  // Size variations
  const sizeStyles = {
    small: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      minHeight: 32,
    },
    medium: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.sm,
      minHeight: 44,
    },
    large: {
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.md,
      minHeight: 50,
    },
  };

  // Variant styles
  const variantStyles = {
    primary: {
      backgroundColor: theme.colors.primary,
    },
    secondary: {
      backgroundColor: theme.colors.secondarySystemFill,
      borderWidth: 1,
      borderColor: theme.colors.separator,
    },
    destructive: {
      backgroundColor: theme.colors.error,
    },
  };

  return {
    ...baseStyle,
    ...sizeStyles[size],
    ...variantStyles[variant],
  };
};

/**
 * Create input field style following Apple's form design
 */
export const createInputStyle = (
  theme: Theme,
  isFocused: boolean = false,
  hasError: boolean = false
): ViewStyle => ({
  backgroundColor: theme.colors.tertiarySystemFill,
  borderRadius: theme.borderRadius.sm,
  borderWidth: 1,
  borderColor: hasError 
    ? theme.colors.error 
    : isFocused 
      ? theme.colors.primary 
      : theme.colors.separator,
  paddingHorizontal: theme.spacing.md,
  paddingVertical: theme.spacing.sm,
  minHeight: 44,
});

/**
 * Animation duration constants respecting reduce motion
 */
export const getAnimationDuration = (
  duration: number,
  isReduceMotionEnabled: boolean
): number => {
  return isReduceMotionEnabled ? 0 : duration;
};

/**
 * Standard animation durations following Apple's guidelines
 */
export const animationDurations = {
  fast: 200,
  normal: 300,
  slow: 500,
} as const;