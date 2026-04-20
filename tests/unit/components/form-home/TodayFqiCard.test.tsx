import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TodayFqiCard } from '@/components/form-home/TodayFqiCard';

describe('TodayFqiCard', () => {
  it('renders the empty state when no data is supplied', () => {
    const { getByTestId, getByText } = render(
      <TodayFqiCard bestFqi={null} avgFqi={null} setCount={0} />,
    );
    expect(getByTestId('today-fqi-card-empty')).toBeTruthy();
    expect(getByText('No data')).toBeTruthy();
  });

  it('renders a spinner when loading', () => {
    const { getByTestId } = render(
      <TodayFqiCard
        bestFqi={null}
        avgFqi={null}
        setCount={0}
        loading
      />,
    );
    expect(getByTestId('today-fqi-card-spinner')).toBeTruthy();
  });

  it('renders best/avg/sets numbers and the Dialed-in label when >= 85', () => {
    const { getByText } = render(
      <TodayFqiCard bestFqi={91.2} avgFqi={86.7} setCount={5} />,
    );
    expect(getByText('91')).toBeTruthy();
    expect(getByText('87')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    expect(getByText('Dialed in')).toBeTruthy();
  });

  it('shows the Solid label for the 75-85 band', () => {
    const { getByText } = render(
      <TodayFqiCard bestFqi={78} avgFqi={76} setCount={3} />,
    );
    expect(getByText('Solid')).toBeTruthy();
  });

  it('shows the Needs attention label below 75', () => {
    const { getByText } = render(
      <TodayFqiCard bestFqi={60} avgFqi={58} setCount={3} />,
    );
    expect(getByText('Needs attention')).toBeTruthy();
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <TodayFqiCard
        bestFqi={88}
        avgFqi={84}
        setCount={4}
        onPress={onPress}
      />,
    );
    fireEvent.press(getByTestId('today-fqi-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
