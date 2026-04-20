import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Ionicons: (props: { name: string }) => <Text>{props.name}</Text>,
  };
});

import { StartSessionCta } from '@/components/form-home/StartSessionCta';

describe('StartSessionCta', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it('renders the Start form session label and icon', () => {
    const { getByText, getByTestId } = render(<StartSessionCta />);
    expect(getByTestId('start-session-cta')).toBeTruthy();
    expect(getByText('Start form session')).toBeTruthy();
    expect(getByText('scan-outline')).toBeTruthy();
  });

  it('navigates to the scan-arkit tab when pressed', () => {
    const { getByTestId } = render(<StartSessionCta />);
    fireEvent.press(getByTestId('start-session-cta'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/scan-arkit');
  });

  it('invokes onPress override if provided', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<StartSessionCta onPress={onPress} />);
    fireEvent.press(getByTestId('start-session-cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
