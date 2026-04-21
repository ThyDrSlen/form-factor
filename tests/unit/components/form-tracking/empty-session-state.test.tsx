import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

import { EmptySessionState } from '@/components/form-tracking/EmptySessionState';

describe('EmptySessionState', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it('renders title and subtitle copy', () => {
    const { getByText } = render(<EmptySessionState />);
    expect(getByText('No sessions yet')).toBeTruthy();
    expect(
      getByText('Start your first form-tracking session to see analytics here.'),
    ).toBeTruthy();
  });

  it('routes to /(tabs)/scan-arkit when CTA pressed without onStartPress', () => {
    const { getByTestId } = render(<EmptySessionState />);
    fireEvent.press(getByTestId('empty-session-state-cta'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/scan-arkit');
  });

  it('invokes onStartPress override when provided', () => {
    const onStartPress = jest.fn();
    const { getByTestId } = render(<EmptySessionState onStartPress={onStartPress} />);
    fireEvent.press(getByTestId('empty-session-state-cta'));
    expect(onStartPress).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
