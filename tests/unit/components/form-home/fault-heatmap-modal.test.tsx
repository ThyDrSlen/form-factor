import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockBack = jest.fn();

jest.mock('expo-router', () => {
  const { View } = jest.requireActual('react-native');
  return {
    useRouter: () => ({ back: mockBack, push: jest.fn() }),
    Stack: { Screen: (props: { children?: React.ReactNode }) => <View>{props.children ?? null}</View> },
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Ionicons: (props: { name: string }) => <Text>{props.name}</Text>,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import FaultHeatmapModal from '@/app/(modals)/fault-heatmap';

describe('FaultHeatmapModal (route render)', () => {
  beforeEach(() => {
    mockBack.mockReset();
  });

  it('renders the header title and close button', () => {
    const { getByText, getByTestId } = render(<FaultHeatmapModal />);
    expect(getByText('Fault heatmap')).toBeTruthy();
    expect(getByTestId('fault-heatmap-close')).toBeTruthy();
  });

  it('calls router.back when the close button is pressed', () => {
    const { getByTestId } = render(<FaultHeatmapModal />);
    fireEvent.press(getByTestId('fault-heatmap-close'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
