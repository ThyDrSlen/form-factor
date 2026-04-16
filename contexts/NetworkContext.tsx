import * as Network from 'expo-network';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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

  const checkNetworkStatus = useCallback(async () => {
    try {
      const networkState = await Network.getNetworkStateAsync();
      setIsOnline(networkState.isInternetReachable ?? true);
      setIsConnected(networkState.isConnected ?? true);
      setNetworkType(networkState.type || null);

      console.log('[NetworkContext] Network status:', {
        isOnline: networkState.isInternetReachable,
        isConnected: networkState.isConnected,
        type: networkState.type,
      });
    } catch (error) {
      console.error('[NetworkContext] Error checking network status:', error);
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

