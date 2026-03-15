import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type * as NetworkContextModule from '@/contexts/NetworkContext';

// Mock expo-network
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

describe('NetworkContext', () => {
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

  describe('initial state', () => {
    it('should default to online before network check completes', () => {
      // Don't resolve yet
      mockGetNetworkStateAsync.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useNetwork(), { wrapper });

      expect(result.current.isOnline).toBe(true);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.networkType).toBeNull();
    });

    it('should update state after network check', async () => {
      mockGetNetworkStateAsync.mockResolvedValue({
        isInternetReachable: true,
        isConnected: true,
        type: 'WIFI',
      });

      const { result } = renderHook(() => useNetwork(), { wrapper });

      await waitFor(() => {
        expect(result.current.networkType).toBe('WIFI');
      });

      expect(result.current.isOnline).toBe(true);
      expect(result.current.isConnected).toBe(true);
    });
  });

  describe('offline detection', () => {
    it('should detect offline state', async () => {
      mockGetNetworkStateAsync.mockResolvedValue({
        isInternetReachable: false,
        isConnected: false,
        type: 'NONE',
      });

      const { result } = renderHook(() => useNetwork(), { wrapper });

      await waitFor(() => {
        expect(result.current.isOnline).toBe(false);
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.networkType).toBe('NONE');
    });

    it('should detect connected but not internet reachable', async () => {
      mockGetNetworkStateAsync.mockResolvedValue({
        isInternetReachable: false,
        isConnected: true,
        type: 'WIFI',
      });

      const { result } = renderHook(() => useNetwork(), { wrapper });

      await waitFor(() => {
        expect(result.current.isOnline).toBe(false);
      });

      expect(result.current.isConnected).toBe(true);
      expect(result.current.networkType).toBe('WIFI');
    });
  });

  describe('periodic checks', () => {
    it('should poll network status every 30 seconds', async () => {
      const { result } = renderHook(() => useNetwork(), { wrapper });

      await waitFor(() => {
        expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(1);
      });

      // Change network state for next check
      mockGetNetworkStateAsync.mockResolvedValue({
        isInternetReachable: false,
        isConnected: false,
        type: 'NONE',
      });

      // Advance 30 seconds
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });

      await waitFor(() => {
        expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(2);
        expect(result.current.isOnline).toBe(false);
      });
    });

    it('should cleanup interval on unmount', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      const { unmount } = renderHook(() => useNetwork(), { wrapper });

      await waitFor(() => {
        expect(mockGetNetworkStateAsync).toHaveBeenCalled();
      });

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should default to online if network check fails', async () => {
      mockGetNetworkStateAsync.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useNetwork(), { wrapper });

      await waitFor(() => {
        // After error, should stay with defaults (online)
        expect(result.current.isOnline).toBe(true);
        expect(result.current.isConnected).toBe(true);
      });
    });
  });

  describe('useNetwork outside provider', () => {
    it('should return default values when used outside provider', () => {
      const { result } = renderHook(() => useNetwork());

      expect(result.current.isOnline).toBe(true);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.networkType).toBeNull();
    });
  });
});
