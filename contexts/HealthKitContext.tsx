import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAvailabilityAsync, getPermissionStatusAsync, requestPermissionsAsync } from '@/lib/services/healthkit';
import type { HealthKitPermissions, HealthPermissionStatus } from '@/lib/services/healthkit';

interface HealthKitContextValue {
  isAvailable: boolean;
  status: HealthPermissionStatus | null;
  isLoading: boolean;
  error?: string;
  requestPermissions: () => Promise<void>;
}

const HealthKitContext = createContext<HealthKitContextValue | undefined>(undefined);

const DEFAULT_PERMISSIONS: HealthKitPermissions = {
  read: ['heartRate', 'activeEnergyBurned', 'basalEnergyBurned', 'stepCount', 'bodyMass', 'height', 'workouts'],
  write: ['workouts', 'activeEnergyBurned', 'heartRate'],
};

export function HealthKitProvider({ children }: { children: React.ReactNode }) {
  const [isAvailable, setIsAvailable] = useState<boolean>(false);
  const [status, setStatus] = useState<HealthPermissionStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const available = await getAvailabilityAsync();
      setIsAvailable(available);
      const st = await getPermissionStatusAsync(DEFAULT_PERMISSIONS);
      setStatus(st);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to query HealthKit');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestPermissions = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const st = await requestPermissionsAsync(DEFAULT_PERMISSIONS);
      setStatus(st);
      setIsAvailable(st.isAvailable);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to request HealthKit permissions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = useMemo<HealthKitContextValue>(
    () => ({ isAvailable, status, isLoading, error, requestPermissions }),
    [isAvailable, status, isLoading, error, requestPermissions]
  );

  return <HealthKitContext.Provider value={value}>{children}</HealthKitContext.Provider>;
}

export function useHealthKit(): HealthKitContextValue {
  const ctx = useContext(HealthKitContext);
  if (!ctx) throw new Error('useHealthKit must be used within HealthKitProvider');
  return ctx;
}
