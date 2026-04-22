/**
 * CameraPermissionBanner — A17 undetermined state + onResume.
 *
 * Covers the wave-30 behavior:
 *   - permission undetermined → inline "Allow" banner rendered with a
 *     button that invokes requestPermission().
 *   - permission transitions denied → granted → onResume fires exactly
 *     once for the transition.
 */
import React from 'react';
import { fireEvent, render, act } from '@testing-library/react-native';

import { CameraPermissionBanner } from '@/components/form-tracking/CameraPermissionBanner';
import type {
  CameraPermissionStatus,
  UseCameraPermissionGuardResult,
} from '@/hooks/use-camera-permission-guard';

const mockOpenSettings = jest.fn(() => Promise.resolve());
const mockRefresh = jest.fn(() => Promise.resolve());
const mockRequestFromGuard = jest.fn(() =>
  Promise.resolve<CameraPermissionStatus>('granted'),
);
const mockUseCameraPermissionGuard = jest.fn<
  UseCameraPermissionGuardResult,
  [unknown]
>();

jest.mock('@/hooks/use-camera-permission-guard', () => ({
  useCameraPermissionGuard: (opts: unknown) => mockUseCameraPermissionGuard(opts),
}));

const mockRequestPermission = jest.fn(() =>
  Promise.resolve({ granted: true, status: 'granted', canAskAgain: true }),
);
const mockUseCameraPermissions = jest.fn();
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => mockUseCameraPermissions(),
}));

function guardStatus(status: CameraPermissionStatus): UseCameraPermissionGuardResult {
  return {
    status,
    revoked: status === 'revoked',
    canAskAgain: status !== 'revoked',
    refresh: mockRefresh,
    openSettings: mockOpenSettings,
    request: mockRequestFromGuard,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CameraPermissionBanner — A17', () => {
  it('renders the inline Allow button when permission is undetermined', () => {
    // Guard reports 'denied' (never-asked maps there); expo-camera hook
    // reports status 'undetermined'.
    mockUseCameraPermissionGuard.mockReturnValue(guardStatus('denied'));
    mockUseCameraPermissions.mockReturnValue([
      { granted: false, status: 'undetermined', canAskAgain: true },
      mockRequestPermission,
    ]);

    const { getByTestId } = render(<CameraPermissionBanner />);
    const btn = getByTestId('camera-permission-banner-allow-button');
    expect(btn).toBeTruthy();

    fireEvent.press(btn);
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('fires onResume when permission transitions denied → granted', () => {
    const onResume = jest.fn();

    // First render: denied
    mockUseCameraPermissionGuard.mockReturnValue(guardStatus('denied'));
    mockUseCameraPermissions.mockReturnValue([
      { granted: false, status: 'denied', canAskAgain: false },
      mockRequestPermission,
    ]);

    const { rerender } = render(<CameraPermissionBanner onResume={onResume} />);
    expect(onResume).not.toHaveBeenCalled();

    // Second render: granted
    mockUseCameraPermissionGuard.mockReturnValue(guardStatus('granted'));
    mockUseCameraPermissions.mockReturnValue([
      { granted: true, status: 'granted', canAskAgain: true },
      mockRequestPermission,
    ]);

    act(() => {
      rerender(<CameraPermissionBanner onResume={onResume} />);
    });

    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
