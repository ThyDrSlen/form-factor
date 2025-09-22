/**
 * Apple HIG Design System - Theme Management
 * Centralized theme system with support for light/dark modes and accessibility preferences
 */

import { ColorSchemeName } from 'react-native';

// Apple's 8pt grid system
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
  xxxl: 48,
} as const;

// Apple's semantic color system
export const colors = {
  // System colors that adapt to light/dark mode
  primary: '#007AFF',
  secondary: '#5856D6',
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  
  // Neutral colors
  label: '#000000',
  secondaryLabel: '#3C3C43',
  tertiaryLabel: '#3C3C4399',
  quaternaryLabel: '#3C3C432E',
  
  // Background colors
  systemBackground: '#FFFFFF',
  secondarySystemBackground: '#F2F2F7',
  tertiarySystemBackground: '#FFFFFF',
  
  // Grouped background colors
  systemGroupedBackground: '#F2F2F7',
  secondarySystemGroupedBackground: '#FFFFFF',
  tertiarySystemGroupedBackground: '#F2F2F7',
  
  // Fill colors
  systemFill: '#78788033',
  secondarySystemFill: '#78788028',
  tertiarySystemFill: '#7676801E',
  quaternarySystemFill: '#74748014',
  
  // Separator colors
  separator: '#3C3C4349',
  opaqueSeparator: '#C6C6C8',
} as const;

// Dark mode color overrides
export const darkColors = {
  ...colors,
  label: '#FFFFFF',
  secondaryLabel: '#EBEBF5',
  tertiaryLabel: '#EBEBF599',
  quaternaryLabel: '#EBEBF52E',
  
  systemBackground: '#000000',
  secondarySystemBackground: '#1C1C1E',
  tertiarySystemBackground: '#2C2C2E',
  
  systemGroupedBackground: '#000000',
  secondarySystemGroupedBackground: '#1C1C1E',
  tertiarySystemGroupedBackground: '#2C2C2E',
  
  systemFill: '#78788066',
  secondarySystemFill: '#78788052',
  tertiarySystemFill: '#7676803D',
  quaternarySystemFill: '#74748029',
  
  separator: '#54545899',
  opaqueSeparator: '#38383A',
} as const;

// Authentication screen specific colors
export const authColors = {
  background: '#1A1A1A',
  cardBackground: '#2C2C2E',
  inputBackground: '#3A3A3C',
  inputBorder: '#48484A',
  inputFocusBorder: '#007AFF',
  placeholderText: '#8E8E93',
} as const;

// Typography system following Apple's text styles
export const typography = {
  largeTitle: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '400' as const,
  },
  title1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '400' as const,
  },
  title2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '400' as const,
  },
  title3: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '400' as const,
  },
  headline: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  callout: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '400' as const,
  },
  subheadline: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
  },
  caption1: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as const,
  },
  caption2: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '400' as const,
  },
} as const;

// Accessibility text sizes (AX1, AX2, AX3)
export const accessibilityTypography = {
  AX1: {
    largeTitle: { fontSize: 44, lineHeight: 52 },
    title1: { fontSize: 38, lineHeight: 46 },
    title2: { fontSize: 32, lineHeight: 39 },
    title3: { fontSize: 30, lineHeight: 37 },
    headline: { fontSize: 25, lineHeight: 31 },
    body: { fontSize: 25, lineHeight: 31 },
    callout: { fontSize: 24, lineHeight: 30 },
    subheadline: { fontSize: 23, lineHeight: 29 },
    footnote: { fontSize: 21, lineHeight: 26 },
    caption1: { fontSize: 20, lineHeight: 25 },
    caption2: { fontSize: 19, lineHeight: 24 },
  },
  AX2: {
    largeTitle: { fontSize: 48, lineHeight: 57 },
    title1: { fontSize: 42, lineHeight: 50 },
    title2: { fontSize: 36, lineHeight: 43 },
    title3: { fontSize: 34, lineHeight: 41 },
    headline: { fontSize: 29, lineHeight: 35 },
    body: { fontSize: 29, lineHeight: 35 },
    callout: { fontSize: 28, lineHeight: 34 },
    subheadline: { fontSize: 27, lineHeight: 33 },
    footnote: { fontSize: 25, lineHeight: 31 },
    caption1: { fontSize: 24, lineHeight: 30 },
    caption2: { fontSize: 23, lineHeight: 29 },
  },
  AX3: {
    largeTitle: { fontSize: 52, lineHeight: 61 },
    title1: { fontSize: 46, lineHeight: 55 },
    title2: { fontSize: 40, lineHeight: 48 },
    title3: { fontSize: 38, lineHeight: 46 },
    headline: { fontSize: 33, lineHeight: 40 },
    body: { fontSize: 33, lineHeight: 40 },
    callout: { fontSize: 32, lineHeight: 39 },
    subheadline: { fontSize: 31, lineHeight: 38 },
    footnote: { fontSize: 29, lineHeight: 35 },
    caption1: { fontSize: 28, lineHeight: 34 },
    caption2: { fontSize: 27, lineHeight: 33 },
  },
} as const;

// Border radius values
export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  round: 9999,
} as const;

// Shadow values
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

// Theme interface
export interface Theme {
  colors: typeof colors | typeof darkColors;
  spacing: typeof spacing;
  typography: typeof typography;
  borderRadius: typeof borderRadius;
  shadows: typeof shadows;
  isDark: boolean;
}

// Create theme function
export const createTheme = (colorScheme: ColorSchemeName): Theme => ({
  colors: colorScheme === 'dark' ? darkColors : colors,
  spacing,
  typography,
  borderRadius,
  shadows,
  isDark: colorScheme === 'dark',
});

// Default theme
export const defaultTheme = createTheme('light');