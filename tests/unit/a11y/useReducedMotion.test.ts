import { renderHook, act } from '@testing-library/react-native';

type Listener = (enabled: boolean) => void;
const mockListeners = new Set<{ event: string; fn: Listener }>();

const mockIsReduceMotionEnabled = jest.fn<Promise<boolean>, []>();
const mockIsScreenReaderEnabled = jest.fn<Promise<boolean>, []>();

jest.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => mockIsReduceMotionEnabled(),
    isScreenReaderEnabled: () => mockIsScreenReaderEnabled(),
    addEventListener: (event: string, fn: Listener) => {
      const entry = { event, fn };
      mockListeners.add(entry);
      return {
        remove: () => mockListeners.delete(entry),
      };
    },
  },
}));

import { useReducedMotion } from '@/lib/a11y/useReducedMotion';

function emit(event: string, value: boolean) {
  mockListeners.forEach((entry) => {
    if (entry.event === event) entry.fn(value);
  });
}

describe('useReducedMotion', () => {
  beforeEach(() => {
    mockListeners.clear();
    mockIsReduceMotionEnabled.mockReset();
    mockIsScreenReaderEnabled.mockReset();
    mockIsReduceMotionEnabled.mockResolvedValue(false);
    mockIsScreenReaderEnabled.mockResolvedValue(false);
  });

  it('returns false by default and flips when reduceMotionChanged fires', async () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    // allow initial promise resolution
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);

    act(() => emit('reduceMotionChanged', true));
    expect(result.current).toBe(true);

    act(() => emit('reduceMotionChanged', false));
    expect(result.current).toBe(false);
  });

  it('reads initial value from AccessibilityInfo.isReduceMotionEnabled', async () => {
    mockIsReduceMotionEnabled.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useReducedMotion());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useReducedMotion());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockListeners.size).toBe(1);
    unmount();
    expect(mockListeners.size).toBe(0);
  });
});
