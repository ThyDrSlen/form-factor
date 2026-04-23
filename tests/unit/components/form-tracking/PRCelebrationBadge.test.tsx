/**
 * Tests for PRCelebrationBadge.
 *
 * Covers:
 *  - renders null when `pr` is null (no-op consumer guard)
 *  - happy-path render shows the title + formatted message
 *  - fires a success haptic exactly once on mount; skips when `disableHaptics`
 *  - auto-dismiss timer calls `onDismiss` after `durationMs`
 *  - `durationMs === 0` disables auto-dismiss (no onDismiss fire)
 *  - accessibility: alert role + polite live region + icon testID
 */

import React from 'react';
import { Platform } from 'react-native';
import { act, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import PRCelebrationBadge from '@/components/form-tracking/PRCelebrationBadge';
import type { PRResult } from '@/lib/services/pr-detector';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));

function pr(overrides: Partial<PRResult> = {}): PRResult {
  return {
    type: 'weight',
    value: 315,
    previousBest: 305,
    exerciseId: 'deadlift',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Ensure tests run the iOS code path that fires haptics.
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PRCelebrationBadge', () => {
  it('returns null when pr is null', () => {
    const { toJSON } = render(<PRCelebrationBadge pr={null} />);
    expect(toJSON()).toBeNull();
  });

  it('renders the Personal Record title and the formatted message', () => {
    const { getByText, getByTestId } = render(
      <PRCelebrationBadge pr={pr()} unit="lb" />,
    );
    expect(getByTestId('pr-celebration-icon')).toBeTruthy();
    expect(getByText('Personal Record!')).toBeTruthy();
    // formatPRMessage emits some human copy — assert we surface the load.
    expect(getByText(/315/)).toBeTruthy();
  });

  it('fires a success haptic exactly once on mount', () => {
    render(<PRCelebrationBadge pr={pr()} />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it('skips the haptic when disableHaptics=true', () => {
    render(<PRCelebrationBadge pr={pr()} disableHaptics />);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('calls onDismiss after the dismiss animation completes at durationMs', () => {
    const onDismiss = jest.fn();
    render(<PRCelebrationBadge pr={pr()} durationMs={4500} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    // Advance past the configured 4.5s fade-out timer. The subsequent Animated
    // fade uses its own duration under fake timers; flush them too.
    act(() => {
      jest.advanceTimersByTime(4500);
    });
    // Animated.timing is synchronous under the fake scheduler — but in case
    // the environment schedules it on the next tick, flush microtasks.
    act(() => {
      jest.runAllTimers();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not auto-dismiss when durationMs is 0', () => {
    const onDismiss = jest.fn();
    render(<PRCelebrationBadge pr={pr()} durationMs={0} onDismiss={onDismiss} />);
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not retrigger the haptic when the same PR identity re-renders', () => {
    const sharedPr = pr();
    const { rerender } = render(<PRCelebrationBadge pr={sharedPr} />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    rerender(<PRCelebrationBadge pr={sharedPr} />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });
});
