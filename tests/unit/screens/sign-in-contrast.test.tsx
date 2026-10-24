import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, TextInput } from 'react-native';
import SignInScreen from '@/app/(auth)/sign-in';
import { styles } from '@/features/auth/styles/sign-in.styles';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ isSigningIn: false, error: null, clearError: jest.fn() }),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('app-owned sign-in text contrast', () => {
  it.each(['sign-in', 'sign-up', 'magic-link'])('keeps %s placeholders at enhanced 7:1 contrast', (mode) => {
    render(<SignInScreen />);
    if (mode === 'sign-up') fireEvent.press(screen.getByText('Sign up'));
    if (mode === 'magic-link') fireEvent.press(screen.getByText('Send magic link instead'));

    for (const input of screen.UNSAFE_getAllByType(TextInput)) {
      const background = StyleSheet.flatten(input.props.style).backgroundColor;
      expect(contrast(input.props.placeholderTextColor, background)).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps secondary labels readable on the actual app background', () => {
    for (const style of [styles.subtitle, styles.dividerText, styles.inputLabel, styles.signUpText, styles.magicLinkToggleText]) {
      expect(contrast(style.color, styles.container.backgroundColor)).toBeGreaterThanOrEqual(7);
    }
  });
});
