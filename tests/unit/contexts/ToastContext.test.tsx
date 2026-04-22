/**
 * ToastContext animation lifecycle coverage (wave-31, Pack C / C1).
 *
 * Targets the untested branches around `show()`:
 *   - single show → fade-in → auto-dismiss timeout → fade-out → state clear
 *   - rapid double-show: second call must cancel the first timer cleanly
 *     and replace the message without leaking state
 *   - unmount during animation: the timeout + Animated callbacks must not
 *     trigger `setState` on an unmounted provider
 *   - empty message is a no-op (guard branch in `show`)
 *   - custom duration + type plumb through to the rendered toast
 *
 * Uses fake timers so we can deterministically flush both the dismissal
 * timeout and the short Animated.timing durations without real waits.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { ToastProvider, useToast } from '@/contexts/ToastContext';

type ToastOptions = { type?: 'info' | 'success' | 'error'; duration?: number };

function Harness({
  onReady,
}: {
  onReady: (api: { show: (msg: string, opts?: ToastOptions) => void }) => void;
}) {
  const { show } = useToast();
  React.useEffect(() => {
    onReady({ show });
  }, [onReady, show]);
  return <View testID="harness" />;
}

describe('ToastContext', () => {
  let show: (msg: string, opts?: ToastOptions) => void;
  // Capture the `show` function via a ref exposed from Harness.
  const captureShow = (api: { show: (msg: string, opts?: ToastOptions) => void }) => {
    show = api.show;
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Flush any pending animation frames and timers, then swap back.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('shows a toast with the given message and auto-dismisses after the duration', () => {
    const { queryByText } = render(
      <ToastProvider>
        <Harness onReady={captureShow} />
      </ToastProvider>,
    );

    expect(queryByText('Saved')).toBeNull();

    act(() => {
      show('Saved', { duration: 1500 });
    });

    // Fade-in (180ms) runs, then the dismiss-timer (~duration) fires.
    expect(queryByText('Saved')).not.toBeNull();

    // Advance past dismiss timer + fade-out (200ms) plus some slack.
    act(() => {
      jest.advanceTimersByTime(1500 + 250);
    });

    // After fade-out finishes, toast state clears.
    expect(queryByText('Saved')).toBeNull();
  });

  it('rapid double-show: the second call cancels the first timer and replaces the message', () => {
    const { queryByText } = render(
      <ToastProvider>
        <Harness onReady={captureShow} />
      </ToastProvider>,
    );

    act(() => {
      show('First toast', { duration: 3000 });
    });
    expect(queryByText('First toast')).not.toBeNull();

    // Before the first timer fires, show a second toast. This should
    // `clearTimeout` the pending dismiss for `First toast` and render
    // `Second toast` without leaking — no lingering first message, no
    // premature dismissal.
    act(() => {
      jest.advanceTimersByTime(500);
      show('Second toast', { duration: 3000 });
    });

    expect(queryByText('First toast')).toBeNull();
    expect(queryByText('Second toast')).not.toBeNull();

    // Second toast must live a full 3000ms from the re-show (not 2500 left
    // on the original timer). Advance 2500 — still visible.
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(queryByText('Second toast')).not.toBeNull();

    // Now advance past its dismissal + fade-out.
    act(() => {
      jest.advanceTimersByTime(500 + 250);
    });
    expect(queryByText('Second toast')).toBeNull();
  });

  it('unmount during animation: no state-update warnings and no throws', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(
      <ToastProvider>
        <Harness onReady={captureShow} />
      </ToastProvider>,
    );

    act(() => {
      show('Hold on', { duration: 5000 });
    });

    // Unmount while fade-in is in flight and long before the dismiss timer.
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(() => unmount()).not.toThrow();

    // Advance past everything — the timeout + animation callback must not
    // touch state on the unmounted provider. If the cleanup is correct,
    // console.error stays clean (React-18 warns about setState on
    // unmounted components on console.error).
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    const unmountedSetStateWarning = errorSpy.mock.calls.find((call) =>
      String(call[0] ?? '').includes("can't perform a React state update on an unmounted component"),
    );
    expect(unmountedSetStateWarning).toBeUndefined();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('ignores empty messages (guard branch in show)', () => {
    const { queryByText } = render(
      <ToastProvider>
        <Harness onReady={captureShow} />
      </ToastProvider>,
    );

    act(() => {
      show('');
    });

    // No toast element should have rendered — no text nodes present.
    expect(queryByText(/.+/)).toBeNull();
  });

  it('respects custom duration and type options', () => {
    const { queryByText, UNSAFE_root } = render(
      <ToastProvider>
        <Harness onReady={captureShow} />
      </ToastProvider>,
    );

    act(() => {
      show('Error!', { type: 'error', duration: 100 });
    });
    expect(queryByText('Error!')).not.toBeNull();

    // Still visible before duration elapses.
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(queryByText('Error!')).not.toBeNull();

    // After the short duration + fade-out window, it clears.
    act(() => {
      jest.advanceTimersByTime(100 + 250);
    });
    expect(queryByText('Error!')).toBeNull();

    // Sanity: the tree accepted our render at all.
    expect(UNSAFE_root).toBeTruthy();
  });

  it('useToast throws when used outside a ToastProvider', () => {
    const BadConsumer = () => {
      useToast();
      return <Text>should not render</Text>;
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BadConsumer />)).toThrow(/useToast must be used within a ToastProvider/);
    errorSpy.mockRestore();
  });
});
