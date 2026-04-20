import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { InlineRestTimer } from '@/components/form-tracking/InlineRestTimer';

describe('InlineRestTimer', () => {
  it('renders nothing when not active', () => {
    const { queryByTestId } = render(
      <InlineRestTimer startedAt={null} targetSeconds={null} onExtend15={jest.fn()} onSkip={jest.fn()} />,
    );
    expect(queryByTestId('inline-rest-timer')).toBeNull();
  });

  it('shows remaining time formatted as M:SS', () => {
    const now = 1_700_000_000_000;
    const startedAt = new Date(now - 20_000).toISOString();
    const { getByTestId } = render(
      <InlineRestTimer
        startedAt={startedAt}
        targetSeconds={90}
        onExtend15={jest.fn()}
        onSkip={jest.fn()}
        now={() => now}
      />,
    );
    expect(getByTestId('inline-rest-timer-countdown').props.children).toBe('1:10');
  });

  it('clamps to 0:00 when elapsed exceeds target', () => {
    const now = 1_700_000_000_000;
    const startedAt = new Date(now - 120_000).toISOString();
    const { getByTestId } = render(
      <InlineRestTimer
        startedAt={startedAt}
        targetSeconds={90}
        onExtend15={jest.fn()}
        onSkip={jest.fn()}
        now={() => now}
      />,
    );
    expect(getByTestId('inline-rest-timer-countdown').props.children).toBe('0:00');
  });

  it('invokes onExtend15 when extend is tapped', () => {
    const onExtend15 = jest.fn();
    const now = 1_700_000_000_000;
    const { getByTestId } = render(
      <InlineRestTimer
        startedAt={new Date(now - 10_000).toISOString()}
        targetSeconds={60}
        onExtend15={onExtend15}
        onSkip={jest.fn()}
        now={() => now}
      />,
    );
    fireEvent.press(getByTestId('inline-rest-timer-extend'));
    expect(onExtend15).toHaveBeenCalledTimes(1);
  });

  it('invokes onSkip when skip is tapped', () => {
    const onSkip = jest.fn();
    const now = 1_700_000_000_000;
    const { getByTestId } = render(
      <InlineRestTimer
        startedAt={new Date(now - 10_000).toISOString()}
        targetSeconds={60}
        onExtend15={jest.fn()}
        onSkip={onSkip}
        now={() => now}
      />,
    );
    fireEvent.press(getByTestId('inline-rest-timer-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
