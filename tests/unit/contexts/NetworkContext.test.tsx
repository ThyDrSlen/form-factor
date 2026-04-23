/**
 * NetworkContext polling + unmount regression coverage (wave-31, Pack C / C2).
 *
 * Complements the existing `network-context.test.tsx` with scenarios that
 * were previously untested:
 *   - interval cleanup count (exactly one clearInterval per provider mount)
 *   - rapid unmount while a poll is in flight must NOT fire setters after
 *     the provider unmounts (mounted-ref guard from the companion fix)
 *   - error path respects the mounted-ref guard too
 *   - initial default-online before the first poll resolves
 *
 * Paired with the `fix(NetworkContext): guard async setters with mounted-ref`
 * commit so the regression stays locked in.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type * as NetworkContextModule from '@/contexts/NetworkContext';

const mockGetNetworkStateAsync = jest.fn();

jest.mock('expo-network', () => ({
  getNetworkStateAsync: (...args: any[]) => mockGetNetworkStateAsync(...args),
  NetworkStateType: {
    NONE: 'NONE',
    WIFI: 'WIFI',
    CELLULAR: 'CELLULAR',
  },
}));

type NetworkModule = typeof NetworkContextModule;
let NetworkProvider: NetworkModule['NetworkProvider'];
let useNetwork: NetworkModule['useNetwork'];

beforeAll(() => {
  const mod = require('@/contexts/NetworkContext') as NetworkModule;
  NetworkProvider = mod.NetworkProvider;
  useNetwork = mod.useNetwork;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NetworkProvider>{children}</NetworkProvider>
);

/** Build a deferred promise we can resolve/reject from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('NetworkContext — polling + unmount (stale-closure regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetNetworkStateAsync.mockResolvedValue({
      isInternetReachable: true,
      isConnected: true,
      type: 'WIFI',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('defaults to online before the first poll resolves', () => {
    // Don't resolve the first poll — state should stay on its defaults.
    mockGetNetworkStateAsync.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useNetwork(), { wrapper });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.networkType).toBeNull();
  });

  it('clears the polling interval exactly once on unmount', async () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const { unmount } = renderHook(() => useNetwork(), { wrapper });

    await waitFor(() => {
      expect(mockGetNetworkStateAsync).toHaveBeenCalled();
    });

    // Exactly one interval got installed on mount.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const installedHandle = setIntervalSpy.mock.results[0].value;

    unmount();

    // clearInterval was called and specifically for our handle.
    expect(clearIntervalSpy).toHaveBeenCalled();
    const clearedForOurHandle = clearIntervalSpy.mock.calls.some(
      (call) => call[0] === installedHandle,
    );
    expect(clearedForOurHandle).toBe(true);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('resolving the poll AFTER unmount does not produce a setState-on-unmounted warning', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const d = deferred<any>();
    mockGetNetworkStateAsync.mockReturnValueOnce(d.promise);

    const { unmount } = renderHook(() => useNetwork(), { wrapper });

    // Unmount with the poll still in flight.
    unmount();

    // Now resolve the pending poll — the mounted-ref guard should swallow
    // the setters silently.
    await act(async () => {
      d.resolve({ isInternetReachable: true, isConnected: true, type: 'WIFI' });
    });

    const setStateWarning = errorSpy.mock.calls.find((call) =>
      String(call[0] ?? '').includes(
        "can't perform a React state update on an unmounted component",
      ),
    );
    expect(setStateWarning).toBeUndefined();

    errorSpy.mockRestore();
  });

  it('rejecting the poll AFTER unmount does not log errors or produce warnings', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const d = deferred<any>();
    mockGetNetworkStateAsync.mockReturnValueOnce(d.promise);

    const { unmount } = renderHook(() => useNetwork(), { wrapper });

    unmount();

    // Reject the poll post-unmount — guard should skip both the console.error
    // AND the setters in the catch block.
    await act(async () => {
      d.reject(new Error('network borked post-unmount'));
    });

    // Neither the NetworkContext error log nor a setState-on-unmounted warning.
    const contextErrorLog = errorSpy.mock.calls.find((call) =>
      String(call[0] ?? '').includes('[NetworkContext] Error checking network status'),
    );
    expect(contextErrorLog).toBeUndefined();

    const setStateWarning = errorSpy.mock.calls.find((call) =>
      String(call[0] ?? '').includes(
        "can't perform a React state update on an unmounted component",
      ),
    );
    expect(setStateWarning).toBeUndefined();

    errorSpy.mockRestore();
  });

  it('error path before unmount still falls back to online=true (regression guard)', async () => {
    mockGetNetworkStateAsync.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useNetwork(), { wrapper });

    await waitFor(() => {
      expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(1);
    });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.isConnected).toBe(true);

    // The context DID log the error pre-unmount.
    const contextErrorLog = errorSpy.mock.calls.find((call) =>
      String(call[0] ?? '').includes('[NetworkContext] Error checking network status'),
    );
    expect(contextErrorLog).toBeDefined();

    errorSpy.mockRestore();
  });

  it('updates state across subsequent polls while mounted (mounted-ref does not short-circuit)', async () => {
    mockGetNetworkStateAsync.mockResolvedValueOnce({
      isInternetReachable: true,
      isConnected: true,
      type: 'WIFI',
    });

    const { result } = renderHook(() => useNetwork(), { wrapper });

    await waitFor(() => {
      expect(result.current.networkType).toBe('WIFI');
    });

    // Swap to offline state for the next poll.
    mockGetNetworkStateAsync.mockResolvedValueOnce({
      isInternetReachable: false,
      isConnected: false,
      type: 'NONE',
    });

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(result.current.isOnline).toBe(false);
      expect(result.current.networkType).toBe('NONE');
    });

    expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(2);
  });
});
