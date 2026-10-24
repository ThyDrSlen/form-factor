import { theme } from '../theme';

export const tabColors = {
  background: theme.colors.background,
  overlay: 'rgba(25, 28, 34, 0.9)',
  overlayMuted: 'rgba(25, 28, 34, 0.8)',
  overlaySubtle: 'rgba(25, 28, 34, 0.85)',
  overlayHeader: 'rgba(16, 18, 22, 0.6)',
  border: theme.colors.border,
  accent: '#4C8CFF',
  accentAlt: '#FF6B6B',
  accentSurface: 'rgba(76, 140, 255, 0.08)',
  accentSurfaceBorder: 'rgba(76, 140, 255, 0.2)',
  accentBorder: 'rgba(76, 140, 255, 0.3)',
  textPrimary: theme.colors.text,
  textSecondary: theme.colors.secondary,
  success: '#3CC8A9',
  error: '#FF3B30',
  errorDark: '#C1271A',
  neutral: '#000',
};

// Default export to satisfy Expo Router (this file is not a route)
export default null;
