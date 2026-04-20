import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

jest.mock('moti', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MotiView: View,
    MotiText: View,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

// eslint-disable-next-line import/first
import RepPulse from '../../../../components/form-tracking/RepPulse';

describe('RepPulse', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders its children', () => {
    const { getByText } = render(
      <RepPulse repCount={0}>
        <Text>5</Text>
      </RepPulse>,
    );
    expect(getByText('5')).toBeTruthy();
  });

  it('does not show the toast on initial render', () => {
    const { queryByTestId } = render(
      <RepPulse repCount={0}>
        <Text>0</Text>
      </RepPulse>,
    );
    expect(queryByTestId('rep-pulse-toast')).toBeNull();
  });

  it('shows the "+1 Rep" toast when repCount increments', () => {
    const { queryByTestId, rerender } = render(
      <RepPulse repCount={0}>
        <Text>0</Text>
      </RepPulse>,
    );
    rerender(
      <RepPulse repCount={1}>
        <Text>1</Text>
      </RepPulse>,
    );
    expect(queryByTestId('rep-pulse-toast')).not.toBeNull();
  });

  it('hides the toast after ~900ms', () => {
    const { queryByTestId, rerender } = render(
      <RepPulse repCount={0}>
        <Text>0</Text>
      </RepPulse>,
    );
    rerender(
      <RepPulse repCount={1}>
        <Text>1</Text>
      </RepPulse>,
    );
    expect(queryByTestId('rep-pulse-toast')).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(queryByTestId('rep-pulse-toast')).toBeNull();
  });

  it('honours a custom toast label', () => {
    const { rerender, getByTestId } = render(
      <RepPulse repCount={0} toastLabel="+1 Pull-up">
        <Text>0</Text>
      </RepPulse>,
    );
    rerender(
      <RepPulse repCount={1} toastLabel="+1 Pull-up">
        <Text>1</Text>
      </RepPulse>,
    );
    expect(getByTestId('rep-pulse-toast').props.accessibilityLabel).toMatch(/Pull-up/);
  });

  it('does not re-trigger when repCount drops (e.g., session reset)', () => {
    const { queryByTestId, rerender } = render(
      <RepPulse repCount={3}>
        <Text>3</Text>
      </RepPulse>,
    );
    rerender(
      <RepPulse repCount={0}>
        <Text>0</Text>
      </RepPulse>,
    );
    expect(queryByTestId('rep-pulse-toast')).toBeNull();
  });
});
