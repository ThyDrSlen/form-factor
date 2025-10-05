/**
 * Template for Web Stub Implementation
 * 
 * This is a type-compatible stub that provides no-op implementations
 * for web builds. Copy and modify for your module.
 */

// ============================================================================
// Types (MUST match iOS implementation exactly)
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
// Module Implementation (Web Stubs)
// ============================================================================

export class MyModule {
  /**
   * Check if the module is available on this device
   * Always returns false on web
   */
  static isAvailable(): boolean {
    if (__DEV__) {
      console.warn('[MyModule.web] This module is not available on web platform');
    }
    return false;
  }

  /**
   * Initialize the module with options
   * No-op on web
   */
  static async initialize(options: MyModuleOptions): Promise<void> {
    console.warn('[MyModule.web] initialize() not available on web');
    // No-op
  }

  /**
   * Get current data from the module
   * Returns empty array on web
   */
  static async getData(): Promise<MyModuleData[]> {
    if (__DEV__) {
      console.warn('[MyModule.web] getData() not available on web');
    }
    return [];
  }

  /**
   * Get status information
   * Returns unavailable status on web
   */
  static getStatus(): MyModuleStatus {
    return {
      isAvailable: false,
      isEnabled: false,
    };
  }

  /**
   * Start the module
   * Throws error on web
   */
  static async start(): Promise<void> {
    throw new Error('MyModule is not available on web platform. This feature requires iOS.');
  }

  /**
   * Stop the module
   * No-op on web
   */
  static stop(): void {
    // No-op
  }
}

// ============================================================================
// React Hook (Web Stub)
// ============================================================================

import { useState } from 'react';

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
 * React hook for using MyModule (Web Stub)
 * Returns unavailable state on web
 */
export function useMyModule(
  options: MyModuleOptions = { enabled: true }
): UseMyModuleResult {
  const [data] = useState<MyModuleData[]>([]);
  const [status] = useState<MyModuleStatus>({
    isAvailable: false,
    isEnabled: false,
  });
  const [isLoading] = useState(false);
  const [error] = useState<Error | null>(null);

  const refresh = async () => {
    console.warn('[useMyModule.web] refresh() not available on web');
  };

  const start = async () => {
    throw new Error('MyModule is not available on web platform');
  };

  const stop = () => {
    // No-op
  };

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

