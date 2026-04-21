import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

const mockNotificationAsync = jest.fn((_type: string) => Promise.resolve());
jest.mock('expo-haptics', () => ({
  notificationAsync: (type: string) => mockNotificationAsync(type),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  impactAsync: jest.fn(() => Promise.resolve()),
}));

import FormTrackingPreCalibrationModal from '@/app/(modals)/form-tracking-pre-calibration';
import { PRE_CALIBRATION_CONSTANTS } from '@/hooks/use-pre-calibration-status';

describe('<FormTrackingPreCalibrationModal />', () => {
  beforeEach(async () => {
    mockBack.mockClear();
    mockNotificationAsync.mockClear();
    await AsyncStorage.clear();
  });

  it('renders the check step on mount with continue + cancel actions', async () => {
    const { getByTestId, getByText } = render(<FormTrackingPreCalibrationModal />);
    await waitFor(() => {
      expect(getByText('Pre-tracking check')).toBeTruthy();
    });
    expect(getByTestId('pre-calibration-continue')).toBeTruthy();
    expect(getByTestId('pre-calibration-cancel')).toBeTruthy();
  });

  it('Cancel calls router.back', async () => {
    const { getByTestId } = render(<FormTrackingPreCalibrationModal />);
    fireEvent.press(getByTestId('pre-calibration-cancel'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('Continue advances to the preview step', async () => {
    const { getByTestId, getByText } = render(<FormTrackingPreCalibrationModal />);
    fireEvent.press(getByTestId('pre-calibration-continue'));
    await waitFor(() => {
      expect(getByText('Calibrating tracker')).toBeTruthy();
    });
  });

  it('writes a success counter to AsyncStorage when markSuccess fires via Confirm', async () => {
    const { getByTestId } = render(<FormTrackingPreCalibrationModal />);
    fireEvent.press(getByTestId('pre-calibration-continue'));
    // Wait until preview step is in flight.
    await waitFor(() => {
      expect(getByTestId('pre-calibration-confirm')).toBeTruthy();
    });

    // The confirm button is disabled until isReady — we trigger markSuccess
    // by simulating enough recordFrame calls. To keep the test deterministic,
    // we let the internal interval fire by progressing real timers a tick.
    await waitFor(
      () => {
        const confirm = getByTestId('pre-calibration-confirm');
        // Once enabled, accessibilityState.disabled should be false.
        expect(confirm.props.accessibilityState?.disabled).toBeFalsy();
      },
      { timeout: 3000 }
    );

    fireEvent.press(getByTestId('pre-calibration-confirm'));

    await waitFor(async () => {
      const stored = await AsyncStorage.getItem(PRE_CALIBRATION_CONSTANTS.STORAGE_KEY);
      expect(stored).toBe('1');
    });
  });

  it('fires a success haptic exactly once on reaching the success state', async () => {
    const { getByTestId } = render(<FormTrackingPreCalibrationModal />);
    fireEvent.press(getByTestId('pre-calibration-continue'));

    // Drive the preview step forward via recordFrame until success.
    await waitFor(
      () => {
        const confirm = getByTestId('pre-calibration-confirm');
        expect(confirm.props.accessibilityState?.disabled).toBeFalsy();
      },
      { timeout: 3000 }
    );

    fireEvent.press(getByTestId('pre-calibration-confirm'));

    await waitFor(() => {
      expect(mockNotificationAsync).toHaveBeenCalledWith('success');
    });
    // Idempotent — shouldn't double-fire on subsequent effect runs.
    expect(mockNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
