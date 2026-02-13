import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ResetPasswordScreen from '../../../app/reset-password';

const mockPush = jest.fn();
const mockGetInitialURL = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('expo-linking', () => ({
  getInitialURL: (...args: unknown[]) => mockGetInitialURL(...args),
}));

describe('ResetPasswordScreen', () => {
  const mockSupabaseAuth = (global as any).__mockSupabaseAuth;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInitialURL.mockResolvedValue(null);

    mockSupabaseAuth.getSession.mockResolvedValue({
      data: { session: { access_token: 'access-token', user: { id: 'user-1' } } },
      error: null,
    });

    mockSupabaseAuth.setSession.mockResolvedValue({
      data: { session: { access_token: 'access-token', user: { id: 'user-1' } } },
      error: null,
    });

    mockSupabaseAuth.updateUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
  });

  it('updates password successfully and shows confirmation', async () => {
    const { getByTestId, getByText } = render(<ResetPasswordScreen />);

    fireEvent.changeText(getByTestId('reset-password-input'), 'newPassword123');
    fireEvent.changeText(getByTestId('reset-password-confirm-input'), 'newPassword123');
    fireEvent.press(getByTestId('reset-password-submit-button'));

    await waitFor(() => {
      expect(getByTestId('reset-password-success-message')).toBeTruthy();
      expect(getByText('Password Updated')).toBeTruthy();
    });

    expect(mockSupabaseAuth.updateUser).toHaveBeenCalledWith({
      password: 'newPassword123',
    });
  });

  it('shows validation error when passwords do not match', async () => {
    const { getByTestId, getByText } = render(<ResetPasswordScreen />);

    fireEvent.changeText(getByTestId('reset-password-input'), 'newPassword123');
    fireEvent.changeText(getByTestId('reset-password-confirm-input'), 'mismatch123');
    fireEvent.press(getByTestId('reset-password-submit-button'));

    await waitFor(() => {
      expect(getByTestId('reset-password-error-message')).toBeTruthy();
      expect(getByText('Passwords do not match.')).toBeTruthy();
    });

    expect(mockSupabaseAuth.updateUser).not.toHaveBeenCalled();
  });

  it('recovers session from deep link tokens before updating password', async () => {
    mockSupabaseAuth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    mockGetInitialURL.mockResolvedValue(
      'formfactor://reset-password#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery'
    );

    const { getByTestId } = render(<ResetPasswordScreen />);

    fireEvent.changeText(getByTestId('reset-password-input'), 'newPassword123');
    fireEvent.changeText(getByTestId('reset-password-confirm-input'), 'newPassword123');
    fireEvent.press(getByTestId('reset-password-submit-button'));

    await waitFor(() => {
      expect(mockSupabaseAuth.setSession).toHaveBeenCalledWith({
        access_token: 'recovery-access',
        refresh_token: 'recovery-refresh',
      });
      expect(mockSupabaseAuth.updateUser).toHaveBeenCalledWith({
        password: 'newPassword123',
      });
    });
  });

  it('shows expired-link message when no recovery session can be established', async () => {
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockGetInitialURL.mockResolvedValue(null);

    const { getByTestId, getByText } = render(<ResetPasswordScreen />);

    fireEvent.changeText(getByTestId('reset-password-input'), 'newPassword123');
    fireEvent.changeText(getByTestId('reset-password-confirm-input'), 'newPassword123');
    fireEvent.press(getByTestId('reset-password-submit-button'));

    await waitFor(() => {
      expect(getByTestId('reset-password-error-message')).toBeTruthy();
      expect(getByText('Recovery link is invalid or expired. Please request a new password reset email.')).toBeTruthy();
    });

    expect(mockSupabaseAuth.updateUser).not.toHaveBeenCalled();
  });
});
