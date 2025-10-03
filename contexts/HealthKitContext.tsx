import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getAvailabilityAsync, getPermissionStatusAsync, requestPermissionsAsync } from '@/lib/services/healthkit';
import type { HealthKitPermissions, HealthPermissionStatus } from '@/lib/services/healthkit';
import {
  getLatestHeartRateAsync,
  getStepCountForTodayAsync,
  getLatestBodyMassKgAsync,
  getStepHistoryAsync,
  getWeightHistoryAsync,
  type HealthMetricPoint,
} from '@/lib/services/healthkit/health-metrics';
import { analyzeWeightTrends, type WeightAnalysis } from '@/lib/services/healthkit/weight-trends';
import { syncHealthMetricsToSupabase } from '@/lib/services/healthkit/health-sync';
import { fetchSupabaseHealthSnapshot } from '@/lib/services/healthkit/health-supabase';
import { useAuth } from './AuthContext';
import { useWorkouts } from './WorkoutsContext';

interface HealthKitContextValue {
  isAvailable: boolean;
  status: HealthPermissionStatus | null;
  isLoading: boolean;
  error?: string;
  requestPermissions: () => Promise<void>;
  stepsToday: number | null;
  latestHeartRate: { bpm: number | null; timestamp: number | null } | null;
  bodyMassKg: { kg: number | null; timestamp: number | null } | null;
  stepHistory: HealthMetricPoint[];
  weightHistory: HealthMetricPoint[];
  weightHistory30Days: HealthMetricPoint[];
  weightHistory90Days: HealthMetricPoint[];
  weightHistory180Days: HealthMetricPoint[];
  weightAnalysis: WeightAnalysis | null;
  dataSource: 'healthkit' | 'supabase' | 'none';
  lastUpdatedAt: number | null;
  enableHighFrequency: () => void;
  disableHighFrequency: () => void;
  refreshWeightAnalysis: () => Promise<void>;
}

const HealthKitContext = createContext<HealthKitContextValue | undefined>(undefined);

const DEFAULT_PERMISSIONS: HealthKitPermissions = {
  read: ['heartRate', 'activeEnergyBurned', 'basalEnergyBurned', 'stepCount', 'bodyMass', 'height', 'workouts'],
  write: ['workouts', 'activeEnergyBurned', 'heartRate'],
};

export function HealthKitProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isWorkoutInProgress } = useWorkouts();
  const [isAvailable, setIsAvailable] = useState<boolean>(false);
  const [status, setStatus] = useState<HealthPermissionStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [stepsToday, setStepsToday] = useState<number | null>(null);
  const [latestHeartRate, setLatestHeartRate] = useState<{ bpm: number | null; timestamp: number | null } | null>(null);
  const [bodyMassKg, setBodyMassKg] = useState<{ kg: number | null; timestamp: number | null } | null>(null);
  const [stepHistory, setStepHistory] = useState<HealthMetricPoint[]>([]);
  const [weightHistory, setWeightHistory] = useState<HealthMetricPoint[]>([]);
  const [weightHistory30Days, setWeightHistory30Days] = useState<HealthMetricPoint[]>([]);
  const [weightHistory90Days, setWeightHistory90Days] = useState<HealthMetricPoint[]>([]);
  const [weightHistory180Days, setWeightHistory180Days] = useState<HealthMetricPoint[]>([]);
  const [weightAnalysis, setWeightAnalysis] = useState<WeightAnalysis | null>(null);
  const [dataSource, setDataSource] = useState<'healthkit' | 'supabase' | 'none'>('none');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const lastSyncedSignatureRef = useRef<string | null>(null);
  const highFrequencyRef = useRef<boolean>(false);

  // Weight analysis refresh function
  const refreshWeightAnalysis = useCallback(async () => {
    try {
      const allWeightData = [...weightHistory180Days];
      if (allWeightData.length > 0) {
        const analysis = analyzeWeightTrends(allWeightData);
        setWeightAnalysis(analysis);
        console.log('[HealthKitContext] Weight analysis updated:', analysis);
      }
    } catch (error) {
      console.warn('[HealthKitContext] Failed to analyze weight trends:', error);
    }
  }, [weightHistory180Days]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      console.log('[HealthKitContext] refresh: start');
      const available = await getAvailabilityAsync();
      console.log('[HealthKitContext] refresh: availability =', available);
      setIsAvailable(available);
      const st = await getPermissionStatusAsync(DEFAULT_PERMISSIONS);
      console.log('[HealthKitContext] refresh: auth status =', st);
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

  // Fetch summary metrics when authorized
  const rescheduleRef = useRef<() => void>(() => {});
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function loadMetrics() {
      try {
        console.log('[HealthKitContext] loadMetrics: start, hasReadPermission =', status?.hasReadPermission);
        const useHealthKit = Platform.OS === 'ios' && status?.hasReadPermission;

        if (useHealthKit) {
          const [steps, hr, weight, stepsSeries, weightSeries, weightSeries30, weightSeries90, weightSeries180] = await Promise.all([
            getStepCountForTodayAsync(),
            getLatestHeartRateAsync(),
            getLatestBodyMassKgAsync(),
            getStepHistoryAsync(7),
            getWeightHistoryAsync(7),
            getWeightHistoryAsync(30),
            getWeightHistoryAsync(90),
            getWeightHistoryAsync(180),
          ]);
          console.log('[HealthKitContext] loadMetrics: results', { steps, hr, weight });

          const normalizedSteps = steps == null ? null : Math.max(0, Math.round(steps));
          const normalizedHeartRate = hr?.bpm == null ? null : Math.round(hr.bpm);
          const normalizedHeartRatePayload = hr
            ? { bpm: normalizedHeartRate, timestamp: hr.timestamp ?? null }
            : { bpm: null, timestamp: null };
          const normalizedWeight = weight?.kg == null ? null : Number(Math.max(0, weight.kg).toFixed(1));
          const normalizedWeightPayload = weight
            ? { kg: normalizedWeight, timestamp: weight.timestamp ?? null }
            : { kg: null, timestamp: null };

          setStepsToday(normalizedSteps);
          setLatestHeartRate(normalizedHeartRatePayload);
          setBodyMassKg(normalizedWeightPayload);
          setStepHistory(
            Array.isArray(stepsSeries)
              ? stepsSeries
                  .filter((point): point is HealthMetricPoint => typeof point?.value === 'number' && !Number.isNaN(point.value))
                  .map((point) => ({ ...point, value: Math.max(0, Math.round(point.value)) }))
              : []
          );
          setWeightHistory(
            Array.isArray(weightSeries)
              ? weightSeries
                  .filter((point): point is HealthMetricPoint => typeof point?.value === 'number' && !Number.isNaN(point.value))
                  .map((point) => ({ ...point, value: Number(Math.max(0, point.value).toFixed(1)) }))
              : []
          );
          setWeightHistory30Days(
            Array.isArray(weightSeries30)
              ? weightSeries30
                  .filter((point): point is HealthMetricPoint => typeof point?.value === 'number' && !Number.isNaN(point.value))
                  .map((point) => ({ ...point, value: Number(Math.max(0, point.value).toFixed(1)) }))
              : []
          );
          setWeightHistory90Days(
            Array.isArray(weightSeries90)
              ? weightSeries90
                  .filter((point): point is HealthMetricPoint => typeof point?.value === 'number' && !Number.isNaN(point.value))
                  .map((point) => ({ ...point, value: Number(Math.max(0, point.value).toFixed(1)) }))
              : []
          );
          setWeightHistory180Days(
            Array.isArray(weightSeries180)
              ? weightSeries180
                  .filter((point): point is HealthMetricPoint => typeof point?.value === 'number' && !Number.isNaN(point.value))
                  .map((point) => ({ ...point, value: Number(Math.max(0, point.value).toFixed(1)) }))
              : []
          );
          setDataSource('healthkit');
          setLastUpdatedAt(Date.now());

          // Trigger weight analysis after data is loaded
          setTimeout(() => {
            refreshWeightAnalysis();
          }, 100);

          const metricsSignature = JSON.stringify({
            steps: normalizedSteps,
            heartRate: normalizedHeartRate,
            heartRateTs: normalizedHeartRatePayload.timestamp,
            weightKg: normalizedWeight,
            weightTs: normalizedWeightPayload.timestamp,
          });

          if (user?.id && metricsSignature !== lastSyncedSignatureRef.current) {
            try {
              const synced = await syncHealthMetricsToSupabase({
                userId: user.id,
                summaryDate: new Date(),
                steps: normalizedSteps,
                heartRateBpm: normalizedHeartRate,
                heartRateTimestamp: normalizedHeartRatePayload.timestamp,
                weightKg: normalizedWeight,
                weightTimestamp: normalizedWeightPayload.timestamp,
              });
              if (synced) {
                lastSyncedSignatureRef.current = metricsSignature;
              }
            } catch (syncError) {
              console.warn('[HealthKitContext] Failed to sync metrics to Supabase', syncError);
            }
          }
          return;
        }

        if (user?.id) {
          const supabaseSnapshot = await fetchSupabaseHealthSnapshot(user.id, 7);
          if (supabaseSnapshot) {
            setStepsToday(supabaseSnapshot.steps ?? null);
            setLatestHeartRate({
              bpm: supabaseSnapshot.heartRateBpm ?? null,
              timestamp: supabaseSnapshot.heartRateTimestamp ?? null,
            });
            setBodyMassKg({
              kg: supabaseSnapshot.weightKg ?? null,
              timestamp: supabaseSnapshot.weightTimestamp ?? null,
            });
            setStepHistory(supabaseSnapshot.stepHistory);
            setWeightHistory(supabaseSnapshot.weightHistory);
            setDataSource('supabase');
            setLastUpdatedAt(supabaseSnapshot.lastUpdatedAt ?? null);
            return;
          }
        }

        setStepsToday(null);
        setLatestHeartRate({ bpm: null, timestamp: null });
        setBodyMassKg({ kg: null, timestamp: null });
        setStepHistory([]);
        setWeightHistory([]);
        setDataSource('none');
        setLastUpdatedAt(null);
      } catch (e: any) {
        // Non-fatal; keep UI graceful
        setError((prev) => prev ?? e?.message ?? 'Failed to read HealthKit metrics');
      }
    }

    const tick = async () => {
      if (cancelled) return;
      await loadMetrics();
      if (cancelled) return;
      const intervalMs = (highFrequencyRef.current || isWorkoutInProgress) ? 3_000 : 60_000;
      timeout = setTimeout(tick, intervalMs);
    };

    // expose a rescheduler so HF toggles can take effect immediately
    rescheduleRef.current = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (!cancelled) {
        tick();
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [status?.hasReadPermission, user?.id, isWorkoutInProgress]);

  const requestPermissions = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      console.log('[HealthKitContext] requestPermissions: start');
      const st = await requestPermissionsAsync(DEFAULT_PERMISSIONS);
      console.log('[HealthKitContext] requestPermissions: status =', st);
      setStatus(st);
      setIsAvailable(st.isAvailable);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to request HealthKit permissions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const enableHighFrequency = useCallback(() => {
    highFrequencyRef.current = true;
    // take effect immediately
    try { rescheduleRef.current?.(); } catch {}
  }, []);

  const disableHighFrequency = useCallback(() => {
    highFrequencyRef.current = false;
    // take effect immediately
    try { rescheduleRef.current?.(); } catch {}
  }, []);

  const value = useMemo<HealthKitContextValue>(
    () => ({
      isAvailable,
      status,
      isLoading,
      error,
      requestPermissions,
      stepsToday,
      latestHeartRate,
      bodyMassKg,
      stepHistory,
      weightHistory,
      weightHistory30Days,
      weightHistory90Days,
      weightHistory180Days,
      weightAnalysis,
      dataSource,
      lastUpdatedAt,
      enableHighFrequency,
      disableHighFrequency,
      refreshWeightAnalysis,
    }),
    [
      isAvailable,
      status,
      isLoading,
      error,
      requestPermissions,
      stepsToday,
      latestHeartRate,
      bodyMassKg,
      stepHistory,
      weightHistory,
      weightHistory30Days,
      weightHistory90Days,
      weightHistory180Days,
      weightAnalysis,
      dataSource,
      lastUpdatedAt,
      enableHighFrequency,
      disableHighFrequency,
      refreshWeightAnalysis,
    ]
  );

  return <HealthKitContext.Provider value={value}>{children}</HealthKitContext.Provider>;
}

export function useHealthKit(): HealthKitContextValue {
  const ctx = useContext(HealthKitContext);
  if (!ctx) throw new Error('useHealthKit must be used within HealthKitProvider');
  return ctx;
}
