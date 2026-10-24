import { Platform } from 'react-native';
import { theme } from '@/styles/theme';

// Use the installed iOS faces; other platforms keep a bundled/local fallback.
export const authFonts = Platform.select({
  ios: {
    regular: 'Futura-Medium',
    medium: 'Futura-Medium',
    bold: 'Futura-CondensedExtraBold',
  },
  web: {
    regular: 'Futura, "Trebuchet MS", sans-serif',
    medium: 'Futura, "Trebuchet MS", sans-serif',
    bold: 'Futura, "Trebuchet MS", sans-serif',
  },
  default: theme.font,
});
