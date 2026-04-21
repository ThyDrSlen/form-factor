/**
 * CameraPermissionBanner (#542) — unit tests.
 *
 * Covers the three decision branches from `useCameraPermissionGuard`:
 *   - 'granted' or 'unknown' → nothing renders
 *   - 'denied' → banner renders, tap → openSettings()
 *   - 'revoked' → banner renders with the same copy
 *
 * Also exercises the accessibility contract (role, label, live region).
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { CameraPermissionBanner } from '@/components/form-tracking/CameraPermissionBanner';
import type {
  CameraPermissionStatus,
  UseCameraPermissionGuardResult,
} from '@/hooks/use-camera-permission-guard';

const mockOpenSettings = jest.fn(() => Promise.resolve());
const mockRefresh = jest.fn(() => Promise.resolve());
const mockRequest = jest.fn(() =>
  Promise.resolve<CameraPermissionStatus>('granted'),
);
const mockUseCameraPermissionGuard = jest.fn<
  UseCameraPermissionGuardResult,
  [unknown]
>();

jest.mock('@/hooks/use-camera-permission-guard', () => ({
  useCameraPermissionGuard: (opts: unknown) => mockUseCameraPermissionGuard(opts),
}));

function mockStatus(status: CameraPermissionStatus): UseCameraPermissionGuardResult {
  return {
    status,
    revoked: status === 'revoked',
    canAskAgain: status !== 'revoked',
    refresh: mockRefresh,
    openSettings: mockOpenSettings,
    request: mockRequest,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('<CameraPermissionBanner />', () => {
  it('renders nothing when status is granted', () => {
    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('granted'));
    const { queryByTestId } = render(<CameraPermissionBanner />);
    expect(queryByTestId('camera-permission-banner')).toBeNull();
  });

  it('renders nothing when status is unknown', () => {
    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('unknown'));
    const { queryByTestId } = render(<CameraPermissionBanner />);
    expect(queryByTestId('camera-permission-banner')).toBeNull();
  });

  it('renders the banner when status is denied', () => {
    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('denied'));
    const { getByTestId, getByText } = render(<CameraPermissionBanner />);
    expect(getByTestId('camera-permission-banner')).toBeTruthy();
    expect(getByText('Camera access required')).toBeTruthy();
    expect(getByText('Tap to grant')).toBeTruthy();
  });

  it('renders the banner when status is revoked', () => {
    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('revoked'));
    const { getByTestId, getByText } = render(<CameraPermissionBanner />);
    expect(getByTestId('camera-permission-banner')).toBeTruthy();
    expect(getByText('Camera access required')).toBeTruthy();
  });

  it('invokes openSettings when the banner is pressed', () => {
    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('denied'));
    const { getByTestId } = render(<CameraPermissionBanner />);
    fireEvent.press(getByTestId('camera-permission-banner'));
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('hides the banner when permission transitions back to granted', () => {
    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('denied'));
    const { queryByTestId, rerender } = render(<CameraPermissionBanner />);
    expect(queryByTestId('camera-permission-banner')).toBeTruthy();

    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('granted'));
    rerender(<CameraPermissionBanner />);
    expect(queryByTestId('camera-permission-banner')).toBeNull();
  });

  it('exposes button role + accessible label + polite live region', () => {
    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('denied'));
    const { getByTestId } = render(<CameraPermissionBanner />);
    const banner = getByTestId('camera-permission-banner');
    expect(banner.props.accessibilityRole).toBe('button');
    expect(banner.props.accessibilityLabel).toBe(
      'Camera access required. Tap to open Settings.',
    );
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
  });

  it('passes detectRevoke: true to the guard hook by default', () => {
    mockUseCameraPermissionGuard.mockReturnValue(mockStatus('granted'));
    render(<CameraPermissionBanner />);
    expect(mockUseCameraPermissionGuard).toHaveBeenCalledWith(
      expect.objectContaining({ detectRevoke: true }),
    );
  });
});
