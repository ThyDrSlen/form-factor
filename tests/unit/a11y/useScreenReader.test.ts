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

import { useScreenReader } from '@/lib/a11y/useScreenReader';

function emit(event: string, value: boolean) {
  mockListeners.forEach((entry) => {
    if (entry.event === event) entry.fn(value);
  });
}

describe('useScreenReader', () => {
  beforeEach(() => {
    mockListeners.clear();
    mockIsReduceMotionEnabled.mockReset();
    mockIsScreenReaderEnabled.mockReset();
    mockIsReduceMotionEnabled.mockResolvedValue(false);
    mockIsScreenReaderEnabled.mockResolvedValue(false);
  });

  it('reads the initial screen-reader state', async () => {
    mockIsScreenReaderEnabled.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useScreenReader());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isScreenReaderEnabled).toBe(true);
  });

  it('reacts to screenReaderChanged events', async () => {
    const { result } = renderHook(() => useScreenReader());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isScreenReaderEnabled).toBe(false);

    act(() => emit('screenReaderChanged', true));
    expect(result.current.isScreenReaderEnabled).toBe(true);
  });
});
