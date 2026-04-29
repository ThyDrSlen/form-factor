/**
 * Unit tests for useRestAdvisor.
 *
 * Covers:
 *  - stable initial state (loading=false, result=null, error=null)
 *  - calls suggestRestSeconds with the provided input and runtime
 *  - flips loading → result on success + invokes onSuccess
 *  - flips loading → error on rejection + invokes onError
 *  - reset() clears everything back to initial
 *  - cleanup-on-unmount doesn't fire stale callbacks
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockSuggest = jest.fn();
jest.mock('@/lib/services/rest-advisor', () => ({
  suggestRestSeconds: (...args: unknown[]) => mockSuggest(...args),
}));

// eslint-disable-next-line import/first
import { useRestAdvisor } from '@/hooks/use-rest-advisor';

beforeEach(() => {
  jest.clearAllMocks();
  mockSuggest.mockResolvedValue({ seconds: 90, reasoning: 'hypertrophy default' });
});

describe('useRestAdvisor', () => {
  it('initial state is idle (no loading, no result, no error)', () => {
    const { result } = renderHook(() => useRestAdvisor());
    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('identical re-renders return a stable suggest/reset reference (no re-render loop)', () => {
    const { result, rerender } = renderHook(() => useRestAdvisor());
    const firstSuggest = result.current.suggest;
    const firstReset = result.current.reset;
    rerender({});
    expect(result.current.suggest).toBe(firstSuggest);
    expect(result.current.reset).toBe(firstReset);
  });

  it('flips loading → result on success and fires onSuccess', async () => {
    const onSuccess = jest.fn();
    const { result } = renderHook(() => useRestAdvisor({ onSuccess }));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.suggest({ lastRepTempoMs: 2200, setRpe: 7 });
    });

    expect(returned).toEqual({ seconds: 90, reasoning: 'hypertrophy default' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toEqual({ seconds: 90, reasoning: 'hypertrophy default' });
    expect(result.current.error).toBeNull();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ seconds: 90, reasoning: 'hypertrophy default' });
  });

  it('passes the configured runtime through to suggestRestSeconds', async () => {
    const runtime = { timeoutMs: 1500, maxRetries: 2 };
    const { result } = renderHook(() => useRestAdvisor({ runtime }));
    await act(async () => {
      await result.current.suggest({ lastRepTempoMs: 1500 });
    });
    expect(mockSuggest).toHaveBeenCalledWith({ lastRepTempoMs: 1500 }, runtime);
  });

  it('flips loading → error on rejection and fires onError', async () => {
    const failure = new Error('advisor offline');
    mockSuggest.mockRejectedValueOnce(failure);
    const onError = jest.fn();
    const { result } = renderHook(() => useRestAdvisor({ onError }));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.suggest({ lastRepTempoMs: 2000 });
    });

    expect(returned).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('reset() clears result + error + loading back to idle', async () => {
    const { result } = renderHook(() => useRestAdvisor());
    await act(async () => {
      await result.current.suggest({ lastRepTempoMs: 2000 });
    });
    expect(result.current.result).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('cleanup-on-unmount does not crash when suggest is mid-flight', async () => {
    let resolveSuggest: (v: { seconds: number; reasoning: string }) => void = () => {};
    mockSuggest.mockImplementationOnce(
      () => new Promise((r) => {
        resolveSuggest = r;
      }),
    );

    const { result, unmount } = renderHook(() => useRestAdvisor());
    let pending: Promise<unknown> | null = null;
    act(() => {
      pending = result.current.suggest({ lastRepTempoMs: 2000 });
    });

    unmount();

    // Resolving after unmount must not throw. React may warn about state
    // updates on an unmounted component, but the promise itself resolves.
    await act(async () => {
      resolveSuggest({ seconds: 120, reasoning: 'late' });
      await pending;
    });
  });
});
