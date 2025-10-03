import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { localDB } from '../lib/services/database/local-db';
import { syncService } from '../lib/services/database/sync-service';
import { supabase } from '../lib/supabase';
import { useNetwork } from './NetworkContext';

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
  isSyncing: false,
  isWorkoutInProgress: false,
  startWorkout: () => {},
  endWorkout: () => {},
});

export const WorkoutsProvider = ({ children }: { children: ReactNode }) => {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isWorkoutInProgress, setIsWorkoutInProgress] = useState(false);
  const { isOnline } = useNetwork();

  // Initialize local DB and set up sync
  useEffect(() => {
    initializeData();

    // Set up realtime sync when authenticated
    const setupRealtime = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && isOnline) {
        await syncService.initializeRealtimeSync(user.id);
      }
    };
    setupRealtime();

    // Register sync callback
    const unsubscribe = syncService.onSyncComplete(() => {
      loadLocalWorkouts();
    });

    // Cleanup
    return () => {
      unsubscribe();
      syncService.cleanupRealtimeSync();
    };
  }, [isOnline]);

  // Sync when coming online
  useEffect(() => {
    if (isOnline) {
      performSync();
    }
  }, [isOnline]);

  const initializeData = async () => {
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
  };

  const loadLocalWorkouts = async () => {
    try {
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
    }
  };

  const performSync = async () => {
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
  };

  const fetchWorkouts = async () => {
    await loadLocalWorkouts();
    if (isOnline) {
      await performSync();
    }
  };

  const startWorkout = () => setIsWorkoutInProgress(true);
  const endWorkout = () => setIsWorkoutInProgress(false);

  const deleteWorkout = async (id: string) => {
    try {
      console.log('[WorkoutsProvider] Deleting workout:', id);
      
      // Soft delete in local DB (marks as deleted, not synced)
      await localDB.softDeleteWorkout(id);

      // Update UI immediately
      setWorkouts(prev => prev.filter(w => w.id !== id));

      // Sync to Supabase if online
      if (isOnline) {
        await syncService.syncToSupabase();
      }
    } catch (err) {
      console.error('[WorkoutsProvider] Error deleting workout:', err);
    }
  };

  const addWorkout = async (workout: Workout) => {
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

      // Sync to Supabase if online
      if (isOnline) {
        await syncService.syncToSupabase();
      }
    } catch (error) {
      console.error('[WorkoutsProvider] Error adding workout:', error);
      throw error;
    }
  };

  return (
    <WorkoutsContext.Provider value={{ workouts, addWorkout, refreshWorkouts: fetchWorkouts, deleteWorkout, loading, isSyncing, isWorkoutInProgress, startWorkout, endWorkout }}>
      {children}
    </WorkoutsContext.Provider>
  );
};

export const useWorkouts = () => useContext(WorkoutsContext);
