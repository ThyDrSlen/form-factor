import { act, renderHook } from '@testing-library/react-native';
import { useFrameLighting } from '@/hooks/use-frame-lighting';

describe('useFrameLighting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits the first reading immediately on report()', () => {
    const { result } = renderHook(() => useFrameLighting());
    expect(result.current.reading).toBeNull();
    act(() => {
      result.current.report(20);
    });
    expect(result.current.reading?.bucket).toBe('dark');
  });

  it('debounces subsequent reports within the window', () => {
    const { result } = renderHook(() => useFrameLighting({ debounceMs: 100 }));
    act(() => {
      result.current.report(20);
    });
    const first = result.current.reading;
    expect(first?.bucket).toBe('dark');

    // Burst of reports within 100 ms — only one trailing flush should occur.
    act(() => {
      jest.advanceTimersByTime(10);
      result.current.report(150);
      jest.advanceTimersByTime(10);
      result.current.report(150);
      jest.advanceTimersByTime(10);
      result.current.report(150);
    });
    // Still last-emitted reading because debounce window not yet elapsed.
    expect(result.current.reading?.bucket).toBe('dark');

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current.reading?.bucket).toBe('good');
  });

  it('reset() clears the latest reading', () => {
    const { result } = renderHook(() => useFrameLighting());
    act(() => {
      result.current.report(20);
    });
    expect(result.current.reading).not.toBeNull();
    act(() => {
      result.current.reset();
    });
    expect(result.current.reading).toBeNull();
  });
});
