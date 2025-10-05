/**
 * Template for iOS Native Module Implementation
 * 
 * Copy this file to create new platform-specific modules:
 * 1. Copy this file to your-module.ios.ts
 * 2. Copy native-module-template.web.ts to your-module.web.ts
 * 3. Implement your native functionality
 * 4. Update types to match your needs
 */

import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

// Import the native module
const NativeMyModule = requireNativeModule('MyModuleName');

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for the module
 */
export interface MyModuleOptions {
  enabled: boolean;
  interval?: number;
  // Add your options here
}

/**
 * Data returned from the module
 */
export interface MyModuleData {
  id: string;
  value: number;
  timestamp: number;
  // Add your data fields here
}

/**
 * Status information
 */
export interface MyModuleStatus {
  isAvailable: boolean;
  isEnabled: boolean;
  lastUpdate?: number;
}

// ============================================================================
// Module Implementation
// ============================================================================

export class MyModule {
  /**
   * Check if the module is available on this device
   */
  static isAvailable(): boolean {
    if (Platform.OS !== 'ios') {
      return false;
    }
    try {
      return NativeMyModule.isAvailable();
    } catch (error) {
      console.error('[MyModule] Error checking availability:', error);
      return false;
    }
  }

  /**
   * Initialize the module with options
   */
  static async initialize(options: MyModuleOptions): Promise<void> {
    try {
      await NativeMyModule.initialize(options);
    } catch (error) {
      console.error('[MyModule] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get current data from the module
   */
  static async getData(): Promise<MyModuleData[]> {
    try {
      const data = await NativeMyModule.getData();
      return data;
    } catch (error) {
      console.error('[MyModule] Failed to get data:', error);
      return [];
    }
  }

  /**
   * Get status information
   */
  static getStatus(): MyModuleStatus {
    try {
      return NativeMyModule.getStatus();
    } catch (error) {
      console.error('[MyModule] Failed to get status:', error);
      return {
        isAvailable: false,
        isEnabled: false,
      };
    }
  }

  /**
   * Start the module
   */
  static async start(): Promise<void> {
    try {
      await NativeMyModule.start();
    } catch (error) {
      console.error('[MyModule] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the module
   */
  static stop(): void {
    try {
      NativeMyModule.stop();
    } catch (error) {
      console.error('[MyModule] Failed to stop:', error);
    }
  }
}

// ============================================================================
// React Hook (Optional)
// ============================================================================

import { useState, useEffect, useCallback } from 'react';

export interface UseMyModuleResult {
  data: MyModuleData[];
  status: MyModuleStatus;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * React hook for using MyModule
 */
export function useMyModule(
  options: MyModuleOptions = { enabled: true }
): UseMyModuleResult {
  const [data, setData] = useState<MyModuleData[]>([]);
  const [status, setStatus] = useState<MyModuleStatus>({
    isAvailable: false,
    isEnabled: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Check availability on mount
  useEffect(() => {
    const available = MyModule.isAvailable();
    setStatus(prev => ({ ...prev, isAvailable: available }));

    if (available && options.enabled) {
      MyModule.initialize(options).catch(err => {
        console.error('[useMyModule] Initialization error:', err);
        setError(err);
      });
    }
  }, [options.enabled]);

  const refresh = useCallback(async () => {
    if (!status.isAvailable) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newData = await MyModule.getData();
      setData(newData);
      setStatus(MyModule.getStatus());
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('[useMyModule] Refresh error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [status.isAvailable]);

  const start = useCallback(async () => {
    if (!status.isAvailable) {
      throw new Error('Module is not available');
    }

    try {
      await MyModule.start();
      setStatus(prev => ({ ...prev, isEnabled: true }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  }, [status.isAvailable]);

  const stop = useCallback(() => {
    if (!status.isAvailable) {
      return;
    }

    try {
      MyModule.stop();
      setStatus(prev => ({ ...prev, isEnabled: false }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    }
  }, [status.isAvailable]);

  return {
    data,
    status,
    isLoading,
    error,
    refresh,
    start,
    stop,
  };
}

