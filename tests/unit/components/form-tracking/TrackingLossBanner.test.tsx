import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('moti', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

// eslint-disable-next-line import/first
import TrackingLossBanner from '../../../../components/form-tracking/TrackingLossBanner';

describe('TrackingLossBanner', () => {
  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(<TrackingLossBanner visible={false} />);
    expect(queryByTestId('tracking-loss-banner')).toBeNull();
  });

  it('renders an assertive alert when visible', () => {
    const { getByTestId } = render(<TrackingLossBanner visible lostForMs={1500} />);
    const node = getByTestId('tracking-loss-banner');
    expect(node.props.accessibilityRole).toBe('alert');
    expect(node.props.accessibilityLiveRegion).toBe('assertive');
    expect(node.props.accessibilityLabel).toMatch(/2s|1s/);
  });

  it('omits the duration badge when lostForMs is null', () => {
    const { getByTestId } = render(<TrackingLossBanner visible lostForMs={null} />);
    expect(getByTestId('tracking-loss-banner').props.accessibilityLabel).not.toMatch(/\ds\./);
  });

  it('fires onDismiss when the close button is pressed', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <TrackingLossBanner visible lostForMs={700} onDismiss={onDismiss} />,
    );
    fireEvent.press(getByTestId('tracking-loss-banner-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('hides the close button when no onDismiss is provided', () => {
    const { queryByTestId } = render(<TrackingLossBanner visible />);
    expect(queryByTestId('tracking-loss-banner-dismiss')).toBeNull();
  });
});
