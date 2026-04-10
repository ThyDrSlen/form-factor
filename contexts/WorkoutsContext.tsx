import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { localDB } from '../lib/services/database/local-db';
import { syncService } from '../lib/services/database/sync-service';
import { useNetwork } from './NetworkContext';
import { useAuth } from './AuthContext';

export interface Workout {
  id: string;
  exercise: string;
  sets: number;
  reps?: number;
  weight?: number;
  duration?: number;
  date: string;
}

interface WorkoutsContextValue {
  workouts: Workout[];
  addWorkout: (workout: Workout) => Promise<void>;
  refreshWorkouts: () => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  isSyncing: boolean;
  isWorkoutInProgress: boolean;
  startWorkout: () => void;
  endWorkout: () => void;
}

const WorkoutsContext = createContext<WorkoutsContextValue>({
  workouts: [],
  addWorkout: async () => {},
  refreshWorkouts: async () => {},
  deleteWorkout: async () => {},
  loading: false,
  error: null,
  isSyncing: false,
  isWorkoutInProgress: false,
  startWorkout: () => {},
  endWorkout: () => {},
});

export const WorkoutsProvider = ({ children }: { children: ReactNode }) => {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isWorkoutInProgress, setIsWorkoutInProgress] = useState(false);
  const { isOnline } = useNetwork();
  const { user } = useAuth();

  const loadLocalWorkouts = useCallback(async () => {
    try {
      setError(null);
      const localWorkouts = await localDB.getAllWorkouts();
      const transformedWorkouts: Workout[] = localWorkouts.map(item => ({
        id: item.id,
        exercise: item.exercise,
        sets: item.sets,
        reps: item.reps,
        weight: item.weight,
        duration: item.duration,
        date: item.date,
      }));
      console.log('[WorkoutsProvider] Loaded workouts from local DB:', transformedWorkouts.length);
      setWorkouts(transformedWorkouts);
    } catch (error) {
      console.error('[WorkoutsProvider] Error loading local workouts:', error);
      setError('Failed to load workouts. Pull to refresh.');
    }
  }, []);

  const performSync = useCallback(async () => {
    try {
      setIsSyncing(true);
      console.log('[WorkoutsProvider] Performing sync...');
      await syncService.fullSync();
      await loadLocalWorkouts();
    } catch (error) {
      console.error('[WorkoutsProvider] Error during sync:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [loadLocalWorkouts]);

  const initializeData = useCallback(async () => {
    try {
      setLoading(true);
      console.log('[WorkoutsProvider] Initializing local database...');

      // Initialize local DB
      await localDB.initialize();

      // Load from local DB first (instant UI)
      await loadLocalWorkouts();

      // If online, perform initial sync
      if (isOnline) {
        await performSync();
      }
    } catch (error) {
      console.error('[WorkoutsProvider] Error initializing:', error);
    } finally {
      setLoading(false);
    }
  }, [isOnline, loadLocalWorkouts, performSync]);

  useEffect(() => {
    void initializeData();
  }, [initializeData]);

  useEffect(() => {
    if (!user?.id) return;

    const setupRealtime = async () => {
      if (isOnline) {
        await syncService.initializeRealtimeSync(user.id);
      }
    };

    void setupRealtime();

    const unsubscribe = syncService.onSyncComplete(() => {
      void loadLocalWorkouts();
    });

    return () => {
      unsubscribe();
      syncService.cleanupRealtimeSync();
    };
  }, [isOnline, loadLocalWorkouts, user?.id]);

  // Sync when coming online
  useEffect(() => {
    if (isOnline) {
      void performSync();
    }
  }, [isOnline, performSync]);

  const fetchWorkouts = useCallback(async () => {
    await loadLocalWorkouts();
    if (isOnline) {
      await performSync();
    }
  }, [isOnline, loadLocalWorkouts, performSync]);

  const startWorkout = useCallback(() => setIsWorkoutInProgress(true), []);
  const endWorkout = useCallback(() => setIsWorkoutInProgress(false), []);

  const deleteWorkout = useCallback(async (id: string) => {
    try {
      console.log('[WorkoutsProvider] Deleting workout:', id);
      
      // Soft delete in local DB (marks as deleted, not synced)
      await localDB.softDeleteWorkout(id);

      // Update UI immediately
      setWorkouts(prev => prev.filter(w => w.id !== id));

      if (isOnline) {
        void syncService.syncToSupabase().catch((syncError) => {
          console.error('[WorkoutsProvider] Background sync failed after add:', syncError);
        });
      }
    } catch (err) {
      console.error('[WorkoutsProvider] Error deleting workout:', err);
    }
  }, [isOnline]);

  const addWorkout = useCallback(async (workout: Workout) => {
    try {
      console.log('[WorkoutsProvider] Adding workout:', workout);

      // Generate UUID if not provided
      const workoutId = workout.id || Crypto.randomUUID();
      const newWorkout = { ...workout, id: workoutId };

      // Save to local DB first (offline-first)
      await localDB.insertWorkout({
        id: newWorkout.id,
        exercise: newWorkout.exercise,
        sets: newWorkout.sets,
        reps: newWorkout.reps,
        weight: newWorkout.weight,
        duration: newWorkout.duration,
        date: newWorkout.date,
      });

      // Update UI immediately
      setWorkouts(prev => [newWorkout, ...prev]);

      if (isOnline) {
        void syncService.syncToSupabase().catch((syncError) => {
          console.error('[WorkoutsProvider] Background sync failed after add:', syncError);
        });
      }
    } catch (error) {
      console.error('[WorkoutsProvider] Error adding workout:', error);
      throw error;
    }
  }, [isOnline]);

  const value = useMemo(
    () => ({
      workouts,
      addWorkout,
      refreshWorkouts: fetchWorkouts,
      deleteWorkout,
      loading,
      error,
      isSyncing,
      isWorkoutInProgress,
      startWorkout,
      endWorkout,
    }),
    [workouts, addWorkout, fetchWorkouts, deleteWorkout, loading, error, isSyncing, isWorkoutInProgress, startWorkout, endWorkout],
  );

  return (
    <WorkoutsContext.Provider value={value}>
      {children}
    </WorkoutsContext.Provider>
  );
};

export const useWorkouts = () => useContext(WorkoutsContext);
