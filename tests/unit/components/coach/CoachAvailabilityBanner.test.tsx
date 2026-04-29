import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { CoachAvailabilityBanner } from '@/components/coach/CoachAvailabilityBanner';

// NetworkContext pulls `expo-network` which isn't reachable in the jest env.
// We stub the hook so the banner can be exercised in isolation — the
// `isOnlineOverride` prop is the actual seam the tests drive, and the mock
// just keeps the import resolvable.
jest.mock('@/contexts/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true, isConnected: true, networkType: null }),
}));

describe('CoachAvailabilityBanner', () => {
  it('renders when network is offline', () => {
    const { getByTestId, getByText } = render(
      <CoachAvailabilityBanner isOnlineOverride={false} />,
    );
    expect(getByTestId('coach-availability-banner')).toBeTruthy();
    expect(getByText('Coach offline')).toBeTruthy();
    expect(getByText('calibration still works')).toBeTruthy();
  });

  it('does not render when network is online', () => {
    const { queryByTestId } = render(
      <CoachAvailabilityBanner isOnlineOverride />,
    );
    expect(queryByTestId('coach-availability-banner')).toBeNull();
  });

  it('hides after the user taps Got it', () => {
    const onDismiss = jest.fn();
    const { getByText, queryByTestId } = render(
      <CoachAvailabilityBanner
        isOnlineOverride={false}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.press(getByText('Got it'));

    expect(queryByTestId('coach-availability-banner')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('exposes an alert role + a11y label for screen readers', () => {
    const { getByTestId } = render(
      <CoachAvailabilityBanner isOnlineOverride={false} />,
    );
    const banner = getByTestId('coach-availability-banner');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLabel).toMatch(/coach offline/i);
  });

  it('honours a custom testID prop for both banner and dismiss button', () => {
    const { getByTestId } = render(
      <CoachAvailabilityBanner isOnlineOverride={false} testID="custom-id" />,
    );
    expect(getByTestId('custom-id')).toBeTruthy();
    expect(getByTestId('custom-id-dismiss')).toBeTruthy();
  });

  it('falls back to NetworkContext when isOnlineOverride is omitted', () => {
    // The mock above returns { isOnline: true }, so omitting the override
    // should produce the "network is online" behavior (nothing rendered).
    const { queryByTestId } = render(<CoachAvailabilityBanner />);
    expect(queryByTestId('coach-availability-banner')).toBeNull();
  });
});
