import { act, renderHook } from '@testing-library/react-native';

import { useTrackingLoss, type UseTrackingLossResult } from '../../../hooks/use-tracking-loss';

describe('useTrackingLoss', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns isLost=false while confidence is healthy', () => {
    const { result } = renderHook<UseTrackingLossResult, { c: number | null }>(
      ({ c }) => useTrackingLoss(c),
      { initialProps: { c: 0.8 } },
    );
    expect(result.current.isLost).toBe(false);
    expect(result.current.lostForMs).toBeNull();
  });

  it('does not flag loss before debounceMs has elapsed', () => {
    const { result, rerender } = renderHook<UseTrackingLossResult, { c: number | null }>(
      ({ c }) => useTrackingLoss(c),
      { initialProps: { c: 0.8 } },
    );

    rerender({ c: 0.1 });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current.isLost).toBe(false);
  });

  it('flags loss after confidence stays under threshold for 500ms', () => {
    const { result, rerender } = renderHook<UseTrackingLossResult, { c: number | null }>(
      ({ c }) => useTrackingLoss(c),
      { initialProps: { c: 0.8 } },
    );

    rerender({ c: 0.1 });
    act(() => {
      jest.advanceTimersByTime(550);
    });
    expect(result.current.isLost).toBe(true);
    expect(result.current.lostForMs).toBeGreaterThanOrEqual(0);
  });

  it('clears loss state when confidence recovers above threshold', () => {
    const { result, rerender } = renderHook<UseTrackingLossResult, { c: number | null }>(
      ({ c }) => useTrackingLoss(c),
      { initialProps: { c: 0.8 } },
    );

    rerender({ c: 0.1 });
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(result.current.isLost).toBe(true);

    rerender({ c: 0.9 });
    expect(result.current.isLost).toBe(false);
    expect(result.current.lostForMs).toBeNull();
  });

  it('treats null confidence as tracking-off and stays not lost', () => {
    const { result, rerender } = renderHook<UseTrackingLossResult, { c: number | null }>(
      ({ c }) => useTrackingLoss(c),
      { initialProps: { c: 0.1 } },
    );

    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(result.current.isLost).toBe(true);

    rerender({ c: null });
    expect(result.current.isLost).toBe(false);
  });

  it('respects custom threshold and debounceMs', () => {
    const { result, rerender } = renderHook<UseTrackingLossResult, { c: number }>(
      ({ c }) => useTrackingLoss(c, { threshold: 0.5, debounceMs: 1000 }),
      { initialProps: { c: 0.8 } },
    );

    rerender({ c: 0.4 });
    act(() => {
      jest.advanceTimersByTime(900);
    });
    expect(result.current.isLost).toBe(false);

    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current.isLost).toBe(true);
  });
});
