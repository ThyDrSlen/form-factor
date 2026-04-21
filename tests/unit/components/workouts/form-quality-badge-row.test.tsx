import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('moti', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
  };
});

// eslint-disable-next-line import/first
import { FormQualityBadgeRow } from '@/components/workouts/FormQualityBadgeRow';

describe('FormQualityBadgeRow', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it('renders FormQualityBadge when score is a finite number', () => {
    const { getByTestId, queryByTestId } = render(
      <FormQualityBadgeRow exerciseName="Pull-Up" score={82} />,
    );
    // The underlying FormQualityBadge uses testID 'form-quality-badge'.
    expect(getByTestId('form-quality-badge')).toBeTruthy();
    expect(queryByTestId('form-quality-badge-row-empty')).toBeNull();
  });

  it('renders empty-state pill when score is null', () => {
    const { getByTestId, queryByTestId } = render(
      <FormQualityBadgeRow exerciseName="Pull-Up" score={null} />,
    );
    expect(getByTestId('form-quality-badge-row-empty')).toBeTruthy();
    expect(queryByTestId('form-quality-badge')).toBeNull();
  });

  it('renders empty-state pill when score is undefined', () => {
    const { getByTestId } = render(<FormQualityBadgeRow score={undefined} />);
    expect(getByTestId('form-quality-badge-row-empty')).toBeTruthy();
  });

  it('renders empty-state pill when score is NaN (not finite)', () => {
    const { getByTestId } = render(<FormQualityBadgeRow score={Number.NaN} />);
    expect(getByTestId('form-quality-badge-row-empty')).toBeTruthy();
  });

  it('routes to /(tabs)/scan-arkit when empty-state pill is pressed', () => {
    const { getByTestId } = render(
      <FormQualityBadgeRow exerciseName="Pull-Up" score={null} />,
    );
    fireEvent.press(getByTestId('form-quality-badge-row-empty'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/scan-arkit');
  });

  it('invokes onEmptyStatePress override when provided', () => {
    const onEmptyStatePress = jest.fn();
    const { getByTestId } = render(
      <FormQualityBadgeRow score={null} onEmptyStatePress={onEmptyStatePress} />,
    );
    fireEvent.press(getByTestId('form-quality-badge-row-empty'));
    expect(onEmptyStatePress).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('embeds exerciseName in the empty-state accessibility label', () => {
    const { getByLabelText } = render(
      <FormQualityBadgeRow exerciseName="Pull-Up" score={null} />,
    );
    expect(
      getByLabelText('Track form for Pull-Up to unlock form quality'),
    ).toBeTruthy();
  });
});
