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
  getRespiratoryRateHistoryAsync,
  getWalkingHeartRateAverageHistoryAsync,
  getActiveEnergyHistoryAsync,
  getBasalEnergyHistoryAsync,
  getDistanceWalkingRunningHistoryAsync,
  getDistanceCyclingHistoryAsync,
  getDistanceSwimmingHistoryAsync,
  getBiologicalSexAsync,
  getDateOfBirthAsync,
  type HealthMetricPoint,
  type BiologicalSex,
} from '@/lib/services/healthkit/health-metrics';
import { analyzeWeightTrends, type WeightAnalysis } from '@/lib/services/healthkit/weight-trends';
import { 
  syncAllHealthKitDataToSupabase, 
  getExistingDataRange, 
  type BulkSyncProgress 
} from '@/lib/services/healthkit/health-bulk-sync';
import { localDB } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';
import { useAuth } from './AuthContext';
import { useWorkouts } from './WorkoutsContext';
import { useNetwork } from './NetworkContext';
import { updateWatchContext } from '@/lib/watch-connectivity';

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
  respiratoryRateHistory: HealthMetricPoint[];
  walkingHeartRateAvgHistory: HealthMetricPoint[];
  activeEnergyHistory: HealthMetricPoint[];
  basalEnergyHistory: HealthMetricPoint[];
  distanceWalkingRunningHistory: HealthMetricPoint[];
  distanceCyclingHistory: HealthMetricPoint[];
  distanceSwimmingHistory: HealthMetricPoint[];
  weightAnalysis: WeightAnalysis | null;
  dataSource: 'healthkit' | 'supabase' | 'none';
  lastUpdatedAt: number | null;
  biologicalSex: BiologicalSex | null;
  ageYears: number | null;
  birthDate: string | null;
  enableHighFrequency: () => void;
  disableHighFrequency: () => void;
  refreshWeightAnalysis: () => Promise<void>;
  // Bulk sync functions
  isSyncing: boolean;
  syncProgress: BulkSyncProgress | null;
  hasSyncedBefore: boolean;
  syncAllHistoricalData: (days?: number) => Promise<void>;
  checkDataRange: () => Promise<{ earliest: string | null; latest: string | null; count: number }>;
}

const HealthKitContext = createContext<HealthKitContextValue | undefined>(undefined);

const DEFAULT_PERMISSIONS: HealthKitPermissions = {
  read: [
    'heartRate',
    'restingHeartRate',
    'heartRateVariability',
    'vo2Max',
    'sleepAnalysis',
    'biologicalSex',
    'dateOfBirth',
    'respiratoryRate',
    'walkingHeartRateAverage',
    'distanceWalkingRunning',
    'distanceCycling',
    'distanceSwimming',
    'workoutRoute',
    'activeEnergyBurned',
    'basalEnergyBurned',
    'stepCount',
    'bodyMass',
    'height',
    'workouts',
  ],
  // Keep workouts as a placeholder until write APIs are implemented.
  write: ['workouts'],
};

export function HealthKitProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isWorkoutInProgress } = useWorkouts();
  const { isOnline } = useNetwork();
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
  const [respiratoryRateHistory, setRespiratoryRateHistory] = useState<HealthMetricPoint[]>([]);
  const [walkingHeartRateAvgHistory, setWalkingHeartRateAvgHistory] = useState<HealthMetricPoint[]>([]);
  const [activeEnergyHistory, setActiveEnergyHistory] = useState<HealthMetricPoint[]>([]);
  const [basalEnergyHistory, setBasalEnergyHistory] = useState<HealthMetricPoint[]>([]);
  const [distanceWalkingRunningHistory, setDistanceWalkingRunningHistory] = useState<HealthMetricPoint[]>([]);
  const [distanceCyclingHistory, setDistanceCyclingHistory] = useState<HealthMetricPoint[]>([]);
  const [distanceSwimmingHistory, setDistanceSwimmingHistory] = useState<HealthMetricPoint[]>([]);
  const [weightAnalysis, setWeightAnalysis] = useState<WeightAnalysis | null>(null);
  const [dataSource, setDataSource] = useState<'healthkit' | 'supabase' | 'none'>('none');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [biologicalSex, setBiologicalSex] = useState<BiologicalSex | null>(null);
  const [ageYears, setAgeYears] = useState<number | null>(null);
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const lastSyncedSignatureRef = useRef<string | null>(null);
  const highFrequencyRef = useRef<boolean>(false);
  const watchContextSignatureRef = useRef<string | null>(null);
  const lastPermissionLogRef = useRef<boolean | null>(null);
  const autoRequestedRef = useRef<boolean>(false);
  
  // Bulk sync state
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<BulkSyncProgress | null>(null);
  const [hasSyncedBefore, setHasSyncedBefore] = useState<boolean>(false);

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
        const hasReadPermission = Boolean(status?.hasReadPermission);
        if (lastPermissionLogRef.current !== hasReadPermission) {
          console.log('[HealthKitContext] loadMetrics: hasReadPermission =', hasReadPermission);
          lastPermissionLogRef.current = hasReadPermission;
        }
        const useHealthKit = Platform.OS === 'ios' && hasReadPermission;

        if (useHealthKit) {
          const [
            steps,
            hr,
            weight,
            stepsSeries,
            weightSeries,
            weightSeries30,
            weightSeries90,
            weightSeries180,
            respSeries,
            walkingHrSeries,
            activeEnergySeries,
            basalEnergySeries,
            distanceWalkRunSeries,
            distanceCyclingSeries,
            distanceSwimmingSeries,
          ] = await Promise.all([
            getStepCountForTodayAsync(),
            getLatestHeartRateAsync(),
            getLatestBodyMassKgAsync(),
            getStepHistoryAsync(7),
            getWeightHistoryAsync(7),
            getWeightHistoryAsync(30),
            getWeightHistoryAsync(90),
            getWeightHistoryAsync(180),
            getRespiratoryRateHistoryAsync(30),
            getWalkingHeartRateAverageHistoryAsync(30),
            getActiveEnergyHistoryAsync(30),
            getBasalEnergyHistoryAsync(30),
            getDistanceWalkingRunningHistoryAsync(30),
            getDistanceCyclingHistoryAsync(30),
            getDistanceSwimmingHistoryAsync(30),
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
          setRespiratoryRateHistory(Array.isArray(respSeries) ? respSeries : []);
          setWalkingHeartRateAvgHistory(Array.isArray(walkingHrSeries) ? walkingHrSeries : []);
          setActiveEnergyHistory(Array.isArray(activeEnergySeries) ? activeEnergySeries : []);
          setBasalEnergyHistory(Array.isArray(basalEnergySeries) ? basalEnergySeries : []);
          setDistanceWalkingRunningHistory(Array.isArray(distanceWalkRunSeries) ? distanceWalkRunSeries : []);
          setDistanceCyclingHistory(Array.isArray(distanceCyclingSeries) ? distanceCyclingSeries : []);
          setDistanceSwimmingHistory(Array.isArray(distanceSwimmingSeries) ? distanceSwimmingSeries : []);
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

          // Local-first: Write to local DB, then sync to Supabase
          if (user?.id && metricsSignature !== lastSyncedSignatureRef.current) {
            try {
              const today = new Date();
              const summaryDate = today.toISOString().slice(0, 10);
              const metricId = `${user.id}_${summaryDate}`;

              // Write to local DB first (instant, offline-capable)
              await localDB.insertHealthMetric({
                id: metricId,
                user_id: user.id,
                summary_date: summaryDate,
                steps: normalizedSteps,
                heart_rate_bpm: normalizedHeartRate,
                heart_rate_timestamp: normalizedHeartRatePayload.timestamp ? new Date(normalizedHeartRatePayload.timestamp).toISOString() : null,
                weight_kg: normalizedWeight,
                weight_timestamp: normalizedWeightPayload.timestamp ? new Date(normalizedWeightPayload.timestamp).toISOString() : null,
              });

              // Trigger background sync if online
              if (isOnline) {
                syncService.syncToSupabase().catch(err => {
                  console.warn('[HealthKitContext] Background sync failed', err);
                });
              }

              lastSyncedSignatureRef.current = metricsSignature;
            } catch (syncError) {
              console.warn('[HealthKitContext] Failed to write metrics to local DB', syncError);
            }
          }
          return;
        }

        // Fallback: Try local DB first, then Supabase if needed
        if (user?.id) {
          try {
            // Check local DB
            const today = new Date().toISOString().slice(0, 10);
            const localMetric = await localDB.getHealthMetricByDate(user.id, today);
            
            if (localMetric) {
              setStepsToday(localMetric.steps ?? null);
              setLatestHeartRate({
                bpm: localMetric.heart_rate_bpm ?? null,
                timestamp: localMetric.heart_rate_timestamp ? new Date(localMetric.heart_rate_timestamp).getTime() : null,
              });
              setBodyMassKg({
                kg: localMetric.weight_kg ?? null,
                timestamp: localMetric.weight_timestamp ? new Date(localMetric.weight_timestamp).getTime() : null,
              });
              setDataSource('supabase'); // Still label as supabase since it's synced
              setLastUpdatedAt(new Date(localMetric.updated_at).getTime());
              return;
            }
          } catch (localError) {
            console.warn('[HealthKitContext] Failed to read from local DB, trying Supabase', localError);
          }
        }

        setStepsToday(null);
        setLatestHeartRate({ bpm: null, timestamp: null });
        setBodyMassKg({ kg: null, timestamp: null });
        setStepHistory([]);
        setWeightHistory([]);
        setRespiratoryRateHistory([]);
        setWalkingHeartRateAvgHistory([]);
        setActiveEnergyHistory([]);
        setBasalEnergyHistory([]);
        setDistanceWalkingRunningHistory([]);
        setDistanceCyclingHistory([]);
        setDistanceSwimmingHistory([]);
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
      const intervalMs = status?.hasReadPermission
        ? (highFrequencyRef.current || isWorkoutInProgress ? 3_000 : 60_000)
        : 15_000;
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

  // Auto-request Health permissions on iOS once, so users aren't stuck until they tap a button.
  useEffect(() => {
    if (
      Platform.OS !== 'ios' ||
      autoRequestedRef.current ||
      !status?.isAvailable ||
      status?.hasReadPermission ||
      status?.hasSharePermission
    ) {
      return;
    }
    autoRequestedRef.current = true;
    requestPermissions().catch((err) => {
      console.warn('[HealthKitContext] Auto permission request failed', err);
    });
  }, [status?.isAvailable, status?.hasReadPermission, status?.hasSharePermission, requestPermissions]);

  // Check if user has synced data before
  const checkDataRange = useCallback(async () => {
    if (!user?.id) {
      return { earliest: null, latest: null, count: 0 };
    }
    return await getExistingDataRange(user.id);
  }, [user?.id]);

  // Sync all historical data
  const syncAllHistoricalData = useCallback(async (days: number = 365) => {
    if (!user?.id || isSyncing) {
      console.log('[HealthKitContext] Cannot sync: no user or already syncing');
      return;
    }

    setIsSyncing(true);
    setSyncProgress({
      phase: 'fetching',
      current: 0,
      total: days,
      message: 'Starting sync...',
    });

    try {
      console.log('[HealthKitContext] Starting bulk sync for', days, 'days');
      
      const result = await syncAllHealthKitDataToSupabase(
        user.id,
        days,
        (progress) => {
          setSyncProgress(progress);
        }
      );

      if (result.success) {
        console.log('[HealthKitContext] Bulk sync completed successfully', result);
        setHasSyncedBefore(true);
        
        // Refresh the metrics after sync
        setTimeout(() => {
          try { rescheduleRef.current?.(); } catch {}
        }, 1000);
      } else {
        console.warn('[HealthKitContext] Bulk sync completed with errors', result);
      }
    } catch (error) {
      console.error('[HealthKitContext] Bulk sync failed', error);
      setSyncProgress({
        phase: 'error',
        current: 0,
        total: 0,
        message: error instanceof Error ? error.message : 'Sync failed',
      });
    } finally {
      setIsSyncing(false);
      
      // Clear progress after a few seconds
      setTimeout(() => {
        setSyncProgress(null);
      }, 5000);
    }
  }, [user?.id, isSyncing]);

  // Check if user has synced before on mount
  useEffect(() => {
    if (user?.id) {
      checkDataRange().then((range) => {
        if (range.count > 0) {
          setHasSyncedBefore(true);
          console.log('[HealthKitContext] User has', range.count, 'days of synced data');
        } else {
          // Auto-trigger a 6-month historical sync for first-time users to populate trends
          syncAllHistoricalData(180).catch((err) => {
            console.warn('[HealthKitContext] Auto historical sync failed', err);
          });
        }
      });
    }
  }, [user?.id, checkDataRange, syncAllHistoricalData]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const payload = {
      steps: stepsToday ?? 0,
      heartRate: latestHeartRate?.bpm ?? null,
    };
    const signature = JSON.stringify(payload);
    if (signature === watchContextSignatureRef.current) {
      return;
    }
    watchContextSignatureRef.current = signature;

    try {
      updateWatchContext(payload);
    } catch (err) {
      console.warn('[HealthKitContext] Failed to push watch context', err);
    }
  }, [stepsToday, latestHeartRate?.bpm]);

  // Fetch static characteristics (biological sex, birth date/age) once permissions are granted
  useEffect(() => {
    let cancelled = false;

    async function loadCharacteristics() {
      if (!(Platform.OS === 'ios' && status?.hasReadPermission)) {
        setBiologicalSex(null);
        setAgeYears(null);
        setBirthDate(null);
        return;
      }

      try {
        const [sex, dob] = await Promise.all([getBiologicalSexAsync(), getDateOfBirthAsync()]);
        if (cancelled) return;
        setBiologicalSex(sex);
        setAgeYears(dob.age);
        setBirthDate(dob.birthDate);
      } catch (err) {
        if (cancelled) return;
        console.warn('[HealthKitContext] Failed to load characteristics', err);
      }
    }

    loadCharacteristics();
    return () => {
      cancelled = true;
    };
  }, [status?.hasReadPermission]);

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
      respiratoryRateHistory,
      walkingHeartRateAvgHistory,
      activeEnergyHistory,
      basalEnergyHistory,
      distanceWalkingRunningHistory,
      distanceCyclingHistory,
      distanceSwimmingHistory,
      weightAnalysis,
      dataSource,
      lastUpdatedAt,
      biologicalSex,
      ageYears,
      birthDate,
      enableHighFrequency,
      disableHighFrequency,
      refreshWeightAnalysis,
      isSyncing,
      syncProgress,
      hasSyncedBefore,
      syncAllHistoricalData,
      checkDataRange,
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
      respiratoryRateHistory,
      walkingHeartRateAvgHistory,
      activeEnergyHistory,
      basalEnergyHistory,
      distanceWalkingRunningHistory,
      distanceCyclingHistory,
      distanceSwimmingHistory,
      weightAnalysis,
      dataSource,
      lastUpdatedAt,
      biologicalSex,
      ageYears,
      birthDate,
      enableHighFrequency,
      disableHighFrequency,
      refreshWeightAnalysis,
      isSyncing,
      syncProgress,
      hasSyncedBefore,
      syncAllHistoricalData,
      checkDataRange,
    ]
  );

  return <HealthKitContext.Provider value={value}>{children}</HealthKitContext.Provider>;
}

export function useHealthKit(): HealthKitContextValue {
  const ctx = useContext(HealthKitContext);
  if (!ctx) throw new Error('useHealthKit must be used within HealthKitProvider');
  return ctx;
}
