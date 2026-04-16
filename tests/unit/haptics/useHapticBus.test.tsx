import { renderHook, act } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import { useHapticBus } from '@/lib/haptics/useHapticBus';
import { hapticBus } from '@/lib/haptics/haptic-bus';

describe('useHapticBus', () => {
  beforeEach(() => {
    hapticBus._reset();
    jest.spyOn(Date, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls onEvent whenever the bus plays an event', () => {
    const onEvent = jest.fn();
    const { result } = renderHook(() => useHapticBus({ onEvent }));
    act(() => {
      result.current.emit('pr.hit');
    });
    expect(onEvent).toHaveBeenCalledWith('pr.hit');
  });

  it('emit returns a stable function that forwards to the bus', () => {
    const onEvent = jest.fn();
    const unsub = hapticBus.onEvent(onEvent);
    const { result } = renderHook(() => useHapticBus());
    act(() => {
      result.current.emit('pr.hit');
    });
    expect(onEvent).toHaveBeenCalledWith('pr.hit');
    unsub();
  });

  it('exposes the module-level bus through `bus`', () => {
    const { result } = renderHook(() => useHapticBus());
    expect(result.current.bus).toBe(hapticBus);
  });
});
