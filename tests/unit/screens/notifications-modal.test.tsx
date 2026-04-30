import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { PermissionStatus } from 'expo-modules-core';

import NotificationSettingsModal from '../../../app/(modals)/notifications';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import {
  getNotificationPermissions,
  loadNotificationPreferences,
} from '@/lib/services/notifications';

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/contexts/ToastContext', () => ({
  useToast: jest.fn(),
}));

jest.mock('@/hooks/use-safe-back', () => ({
  useSafeBack: () => jest.fn(),
}));

jest.mock('@/lib/platform-utils', () => ({
  isAndroid: () => false,
  isIOS: () => true,
}));

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
}));

jest.mock('@/lib/utils/open-external', () => ({
  openExternalUrl: jest.fn(),
  openSystemSettings: jest.fn(),
}));

jest.mock('@/lib/services/notifications', () => ({
  getNotificationPermissions: jest.fn(),
  loadNotificationPreferences: jest.fn(),
  registerDevicePushToken: jest.fn(),
  requestNotificationPermissions: jest.fn(),
  updateNotificationPreferences: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseToast = useToast as jest.MockedFunction<typeof useToast>;
const mockGetNotificationPermissions = getNotificationPermissions as jest.MockedFunction<typeof getNotificationPermissions>;
const mockLoadNotificationPreferences = loadNotificationPreferences as jest.MockedFunction<typeof loadNotificationPreferences>;

describe('NotificationSettingsModal', () => {
  const toast = { show: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseToast.mockReturnValue(toast as ReturnType<typeof useToast>);
    mockGetNotificationPermissions.mockResolvedValue(PermissionStatus.GRANTED);
  });

  it('renders load-error state with Retry for a signed-in user when preferences fail to load', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-123' } } as ReturnType<typeof useAuth>);
    mockLoadNotificationPreferences.mockRejectedValue(new Error('load failed'));

    const { getByText } = render(<NotificationSettingsModal />);

    await waitFor(() => {
      expect(getByText('We could not load your notification settings.')).toBeTruthy();
    });

    expect(getByText('Retry')).toBeTruthy();
    expect(toast.show).toHaveBeenCalledWith('Unable to load notification settings', { type: 'error' });

    fireEvent.press(getByText('Retry'));

    await waitFor(() => {
      expect(mockLoadNotificationPreferences).toHaveBeenCalledTimes(2);
    });
  });

  it('renders the signed-out message instead of load-error copy when no user is signed in', async () => {
    mockUseAuth.mockReturnValue({ user: null } as ReturnType<typeof useAuth>);

    const { getByText, queryByText } = render(<NotificationSettingsModal />);

    await waitFor(() => {
      expect(getByText('Sign in to adjust your notification settings.')).toBeTruthy();
    });

    expect(queryByText('We could not load your notification settings.')).toBeNull();
    expect(queryByText('Retry')).toBeNull();
    expect(mockLoadNotificationPreferences).not.toHaveBeenCalled();
  });
});
