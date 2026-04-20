import { renderHook } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import { hapticBus } from '@/lib/haptics/haptic-bus';
import { useHapticWiring } from '@/hooks/use-haptic-wiring';

describe('useHapticWiring', () => {
  beforeEach(() => {
    hapticBus._reset();
    jest.spyOn(Date, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits tracking.lost when quality drops below threshold', () => {
    const events: string[] = [];
    hapticBus.onEvent((e) => events.push(e));

    const { rerender } = renderHook(
      (props: { q: number }) => useHapticWiring({ isTracking: true, trackingQuality: props.q }),
      { initialProps: { q: 0.8 } },
    );
    expect(events).toEqual([]);

    rerender({ q: 0.1 });
    expect(events).toContain('tracking.lost');
  });

  it('emits tracking.recovered only after loss', () => {
    const events: string[] = [];
    hapticBus.onEvent((e) => events.push(e));

    const { rerender } = renderHook(
      (props: { q: number }) => useHapticWiring({ isTracking: true, trackingQuality: props.q }),
      { initialProps: { q: 0.8 } },
    );

    rerender({ q: 0.1 });
    rerender({ q: 0.7 });
    expect(events).toEqual(['tracking.lost', 'tracking.recovered']);
  });

  it('emits fqi.bucket-up / -down on bucket change only', () => {
    const events: string[] = [];
    hapticBus.onEvent((e) => events.push(e));

    const { rerender } = renderHook(
      (props: { fqiBucket: number }) => useHapticWiring({ isTracking: true, fqiBucket: props.fqiBucket }),
      { initialProps: { fqiBucket: 2 } },
    );
    // First render establishes baseline.
    expect(events).toEqual([]);

    rerender({ fqiBucket: 3 });
    expect(events).toContain('fqi.bucket-up');

    // advance time past the 1000ms debounce
    (Date.now as jest.Mock).mockReturnValue(3000);
    rerender({ fqiBucket: 1 });
    expect(events).toContain('fqi.bucket-down');
  });

  it('does not emit while tracking is inactive', () => {
    const events: string[] = [];
    hapticBus.onEvent((e) => events.push(e));
    renderHook(() =>
      useHapticWiring({ isTracking: false, trackingQuality: 0.05, fqiBucket: 4 }),
    );
    expect(events).toEqual([]);
  });
});
