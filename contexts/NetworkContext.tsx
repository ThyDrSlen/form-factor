import * as Network from 'expo-network';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useOptionalToast } from '@/contexts/ToastContext';
import { errorWithTs, logWithTs } from '@/lib/logger';

interface NetworkContextValue {
  isOnline: boolean;
  isConnected: boolean;
  networkType: string | null;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  isConnected: true,
  networkType: null,
});

export const NetworkProvider = ({ children }: { children: ReactNode }) => {
  const [isOnline, setIsOnline] = useState(true);
  const [isConnected, setIsConnected] = useState(true);
  const [networkType, setNetworkType] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { show: showToast } = useOptionalToast();
  // Track the last seen `isOnline` so we can detect a false -> true
  // transition and surface a "back online" toast. Initialized to null so
  // the first reading is treated as a baseline (no toast on mount).
  const prevOnlineRef = useRef<boolean | null>(null);

  const checkNetworkStatus = useCallback(async () => {
    try {
      const networkState = await Network.getNetworkStateAsync();
      setIsOnline(networkState.isInternetReachable ?? true);
      setIsConnected(networkState.isConnected ?? true);
      setNetworkType(networkState.type || null);

      logWithTs('[NetworkContext] Network status:', {
        isOnline: networkState.isInternetReachable,
        isConnected: networkState.isConnected,
        type: networkState.type,
      });
    } catch (error) {
      errorWithTs('[NetworkContext] Error checking network status:', error);
      // Default to online if we can't determine status
      setIsOnline(true);
      setIsConnected(true);
    }
  }, []);

  useEffect(() => {
    // Check initial network status
    checkNetworkStatus();

    // Clear any previous interval before creating a new one
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
    }

    // Set up periodic checks (every 30 seconds)
    intervalRef.current = setInterval(checkNetworkStatus, 30000);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [checkNetworkStatus]);

  // Surface a toast when connectivity recovers (false -> true).
  // The very first reading just seeds the ref so we don't fire on mount.
  useEffect(() => {
    const prev = prevOnlineRef.current;
    if (prev === null) {
      prevOnlineRef.current = isOnline;
      return;
    }
    if (prev === false && isOnline === true) {
      showToast('Back online — syncing now', { type: 'info' });
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline, showToast]);

  const value = useMemo(
    () => ({ isOnline, isConnected, networkType }),
    [isOnline, isConnected, networkType],
  );

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => useContext(NetworkContext);

