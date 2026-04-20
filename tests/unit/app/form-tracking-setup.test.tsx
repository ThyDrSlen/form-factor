import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

import FormTrackingSetupScreen from '@/app/(modals)/form-tracking-setup';
import { FIRST_SESSION_STORAGE_KEY } from '@/hooks/use-first-session-check';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}));

const mockUseCameraPermissions = jest.fn();
const mockRequestPermission = jest.fn();

jest.mock('expo-camera', () => ({
  useCameraPermissions: (...args: unknown[]) => mockUseCameraPermissions(...args),
}));

const openSettingsSpy = jest
  .spyOn(Linking, 'openSettings')
  .mockImplementation(() => Promise.resolve());

function setPermissionState(state: 'undetermined' | 'granted' | 'denied') {
  mockRequestPermission.mockReset();
  mockRequestPermission.mockResolvedValue({ granted: state === 'granted', status: state });
  mockUseCameraPermissions.mockReturnValue([
    {
      granted: state === 'granted',
      status: state,
      canAskAgain: state !== 'denied',
      expires: 'never',
    },
    mockRequestPermission,
    jest.fn(),
  ]);
}

describe('FormTrackingSetupScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    setPermissionState('undetermined');
  });

  it('starts on the intro step and shows progress 1 of 4', () => {
    const { getByTestId } = render(<FormTrackingSetupScreen />);
    expect(getByTestId('form-tracking-setup-step-intro')).toBeTruthy();
    expect(getByTestId('form-tracking-setup-step-label').props.children).toContain(
      'Step 1 of 4',
    );
  });

  it('advances forward through intro -> permission -> posture -> ready', () => {
    setPermissionState('granted');
    const { getByTestId } = render(<FormTrackingSetupScreen />);

    fireEvent.press(getByTestId('form-tracking-setup-next'));
    expect(getByTestId('form-tracking-setup-step-permission')).toBeTruthy();

    fireEvent.press(getByTestId('form-tracking-setup-next'));
    expect(getByTestId('form-tracking-setup-step-posture')).toBeTruthy();

    fireEvent.press(getByTestId('form-tracking-setup-next'));
    expect(getByTestId('form-tracking-setup-step-ready')).toBeTruthy();
  });

  it('supports the Back button on any step after the first', () => {
    setPermissionState('granted');
    const { getByTestId, queryByTestId } = render(<FormTrackingSetupScreen />);

    expect(queryByTestId('form-tracking-setup-back')).toBeNull();

    fireEvent.press(getByTestId('form-tracking-setup-next'));
    fireEvent.press(getByTestId('form-tracking-setup-back'));
    expect(getByTestId('form-tracking-setup-step-intro')).toBeTruthy();
  });

  it('renders the undetermined state and requests camera permission on press', async () => {
    setPermissionState('undetermined');
    const { getByTestId } = render(<FormTrackingSetupScreen />);

    fireEvent.press(getByTestId('form-tracking-setup-next'));

    expect(getByTestId('form-tracking-setup-permission-undetermined')).toBeTruthy();

    fireEvent.press(getByTestId('form-tracking-setup-request-permission'));

    await waitFor(() => {
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the granted state when permission is already granted', () => {
    setPermissionState('granted');
    const { getByTestId } = render(<FormTrackingSetupScreen />);
    fireEvent.press(getByTestId('form-tracking-setup-next'));
    expect(getByTestId('form-tracking-setup-permission-granted')).toBeTruthy();
  });

  it('opens Settings when the user is denied and taps Open Settings', () => {
    setPermissionState('denied');
    const { getByTestId } = render(<FormTrackingSetupScreen />);

    fireEvent.press(getByTestId('form-tracking-setup-next'));
    expect(getByTestId('form-tracking-setup-permission-denied')).toBeTruthy();

    fireEvent.press(getByTestId('form-tracking-setup-open-settings'));
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });

  it('marks setup as seen and pushes to the scan tab when Start is pressed', async () => {
    setPermissionState('granted');
    const { getByTestId } = render(<FormTrackingSetupScreen />);

    fireEvent.press(getByTestId('form-tracking-setup-next'));
    fireEvent.press(getByTestId('form-tracking-setup-next'));
    fireEvent.press(getByTestId('form-tracking-setup-next'));

    fireEvent.press(getByTestId('form-tracking-setup-start'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/(tabs)/scan-arkit');
    });

    await expect(
      AsyncStorage.getItem(FIRST_SESSION_STORAGE_KEY),
    ).resolves.toBe('true');
  });

  it('closes the wizard when the close button is pressed', () => {
    setPermissionState('granted');
    const { getByTestId } = render(<FormTrackingSetupScreen />);
    fireEvent.press(getByTestId('form-tracking-setup-close'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
