import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FormTrackingSetupScreen from '@/app/(modals)/form-tracking-setup';
import { FORM_TRACKING_ONBOARDING_DISMISSED_KEY } from '@/features/form-tracking/components/TrackingOnboardingOverlay';
import { FIRST_SESSION_STORAGE_KEY } from '@/features/form-tracking/hooks/use-first-session-check';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
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
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
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

  it.each([
    { top: 62, bottom: 34, left: 0, right: 0 },
    { top: 0, bottom: 21, left: 62, right: 62 },
    { top: 20, bottom: 0, left: 0, right: 0 },
  ])('keeps content inside the measured safe area %j', (insets) => {
    jest.mocked(useSafeAreaInsets).mockReturnValue(insets);
    const { getByTestId, rerender } = render(<FormTrackingSetupScreen />);
    expect(StyleSheet.flatten(getByTestId('form-tracking-setup').props.style)).toMatchObject({
      paddingTop: insets.top,
      paddingBottom: insets.bottom,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    });
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, bottom: 21, left: 62, right: 62 });
    rerender(<FormTrackingSetupScreen />);
    expect(StyleSheet.flatten(getByTestId('form-tracking-setup').props.style)).toMatchObject({
      paddingTop: 0, paddingBottom: 21, paddingLeft: 62, paddingRight: 62,
    });
  });

  it('reserves header and footer space while the body scrolls without double insets', () => {
    const { getByTestId } = render(<FormTrackingSetupScreen />);
    for (const id of ['form-tracking-setup-header', 'form-tracking-setup-footer']) {
      expect(StyleSheet.flatten(getByTestId(id).props.style)).toMatchObject({ flexShrink: 0 });
    }
    const body = getByTestId('form-tracking-setup-step-intro');
    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
    expect(body.props.contentInsetAdjustmentBehavior).toBe('never');
  });

  it('remounts each step viewport so an old scroll offset cannot hide the next heading', () => {
    setPermissionState('granted');
    const { getByTestId } = render(<FormTrackingSetupScreen />);
    const intro = getByTestId('form-tracking-setup-step-intro');
    fireEvent.press(getByTestId('form-tracking-setup-next'));
    expect(getByTestId('form-tracking-setup-step-permission')).not.toBe(intro);
    fireEvent.press(getByTestId('form-tracking-setup-back'));
    expect(getByTestId('form-tracking-setup-step-intro')).not.toBe(intro);
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

  it('marks setup as seen, suppresses duplicate teaching, and replaces to the scan tab', async () => {
    setPermissionState('granted');
    const { getByTestId } = render(<FormTrackingSetupScreen />);

    fireEvent.press(getByTestId('form-tracking-setup-next'));
    fireEvent.press(getByTestId('form-tracking-setup-next'));
    fireEvent.press(getByTestId('form-tracking-setup-next'));

    fireEvent.press(getByTestId('form-tracking-setup-start'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/scan-arkit');
    });
    expect(mockPush).not.toHaveBeenCalled();

    await expect(
      AsyncStorage.getItem(FIRST_SESSION_STORAGE_KEY),
    ).resolves.toBe('true');
    await expect(
      AsyncStorage.getItem(FORM_TRACKING_ONBOARDING_DISMISSED_KEY),
    ).resolves.toBe('true');
  });

  it('closes the wizard when the close button is pressed', () => {
    setPermissionState('granted');
    const { getByTestId } = render(<FormTrackingSetupScreen />);
    fireEvent.press(getByTestId('form-tracking-setup-close'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
