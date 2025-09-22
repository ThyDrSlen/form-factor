/**
 * Apple HIG Design System - Main Export
 * Centralized exports for the design system
 */

// Theme exports
export * from './theme';
export * from './ThemeProvider';
export * from './utils';

// Component exports
export * from './components';

// Re-export commonly used types
export type { ColorSchemeName } from 'react-native';
export type { Theme } from './theme';

