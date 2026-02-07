import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ForgotPasswordScreen from '../../../app/(auth)/forgot-password';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string) => `formfactor://${path}`),
}));

describe('ForgotPasswordScreen', () => {
  const mockSupabaseAuth = (global as any).__mockSupabaseAuth;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseAuth.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it('submits reset request successfully and shows confirmation', async () => {
    const { getByTestId, getByText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByTestId('forgot-password-email-input'), 'test@example.com');
    fireEvent.press(getByTestId('forgot-password-submit-button'));

    await waitFor(() => {
      expect(getByTestId('forgot-password-success-message')).toBeTruthy();
      expect(getByText('Check Your Email')).toBeTruthy();
    });

    expect(mockSupabaseAuth.resetPasswordForEmail).toHaveBeenCalledWith(
      'test@example.com',
      expect.objectContaining({
        redirectTo: expect.stringContaining('reset-password'),
      })
    );
  });

  it('shows validation message for invalid email errors', async () => {
    mockSupabaseAuth.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'Invalid email address', status: 400 },
    });

    const { getByTestId, getByText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByTestId('forgot-password-email-input'), 'not-an-email');
    fireEvent.press(getByTestId('forgot-password-submit-button'));

    await waitFor(() => {
      expect(getByTestId('forgot-password-error-message')).toBeTruthy();
      expect(getByText('Please enter a valid email address.')).toBeTruthy();
    });
  });

  it('shows rate limit message for 429 responses', async () => {
    mockSupabaseAuth.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'Too many requests', status: 429 },
    });

    const { getByTestId, getByText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByTestId('forgot-password-email-input'), 'test@example.com');
    fireEvent.press(getByTestId('forgot-password-submit-button'));

    await waitFor(() => {
      expect(getByText('Too many reset attempts. Please wait a minute and try again.')).toBeTruthy();
    });
  });

  it('shows network error message when request throws', async () => {
    mockSupabaseAuth.resetPasswordForEmail.mockRejectedValue(new Error('Network request failed'));

    const { getByTestId, getByText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByTestId('forgot-password-email-input'), 'test@example.com');
    fireEvent.press(getByTestId('forgot-password-submit-button'));

    await waitFor(() => {
      expect(getByText('Connection issue. Please check your internet and try again.')).toBeTruthy();
    });
  });

  it('shows server error message for 5xx responses', async () => {
    mockSupabaseAuth.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'Server error', status: 500 },
    });

    const { getByTestId, getByText } = render(<ForgotPasswordScreen />);

    fireEvent.changeText(getByTestId('forgot-password-email-input'), 'test@example.com');
    fireEvent.press(getByTestId('forgot-password-submit-button'));

    await waitFor(() => {
      expect(getByText('Reset service is temporarily unavailable. Please try again shortly.')).toBeTruthy();
    });
  });
});
