import { renderHook } from '@testing-library/react-native';

const mockActivate = jest.fn().mockResolvedValue(undefined);
const mockDeactivate = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (...args: unknown[]) => mockActivate(...args),
  deactivateKeepAwake: (...args: unknown[]) => mockDeactivate(...args),
}));

import { useKeepAwakeSmart } from '@/lib/a11y/useKeepAwakeSmart';

describe('useKeepAwakeSmart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('activates keep-awake with the provided tag when active=true', () => {
    renderHook(() => useKeepAwakeSmart('tracking-active', true));
    expect(mockActivate).toHaveBeenCalledWith('tracking-active');
  });

  it('does not activate when active=false', () => {
    renderHook(() => useKeepAwakeSmart('tracking-active', false));
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('releases the tag on unmount', () => {
    const { unmount } = renderHook(() => useKeepAwakeSmart('rest-long', true));
    expect(mockActivate).toHaveBeenCalledWith('rest-long');
    unmount();
    expect(mockDeactivate).toHaveBeenCalledWith('rest-long');
  });

  it('auto-deactivates after the 20-minute safety ceiling', () => {
    renderHook(() => useKeepAwakeSmart('tracking-active', true));
    jest.advanceTimersByTime(20 * 60 * 1000 + 1);
    expect(mockDeactivate).toHaveBeenCalledWith('tracking-active');
  });

  it('honours a custom maxDurationMs override', () => {
    renderHook(() => useKeepAwakeSmart('tracking-active', true, { maxDurationMs: 5_000 }));
    jest.advanceTimersByTime(5_001);
    expect(mockDeactivate).toHaveBeenCalledWith('tracking-active');
  });
});
