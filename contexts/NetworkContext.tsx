import * as Network from 'expo-network';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';

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

  const checkNetworkStatus = async () => {
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
  };

  useEffect(() => {
    // Check initial network status
    checkNetworkStatus();

    // Set up periodic checks (every 30 seconds)
    const interval = setInterval(checkNetworkStatus, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline, isConnected, networkType }}>
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => useContext(NetworkContext);

