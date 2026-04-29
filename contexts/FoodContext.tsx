import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { localDB } from '../lib/services/database/local-db';
import { syncService } from '../lib/services/database/sync-service';
import { errorWithTs, logWithTs, warnWithTs } from '../lib/logger';
import { useNetwork } from './NetworkContext';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

export interface FoodEntry {
  id: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  date: string;
}

interface FoodContextValue {
  foods: FoodEntry[];
  addFood: (food: FoodEntry) => Promise<void>;
  refreshFoods: () => Promise<void>;
  deleteFood: (id: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  isSyncing: boolean;
}

const FoodContext = createContext<FoodContextValue>({
  foods: [],
  addFood: async () => { },
  refreshFoods: async () => { },
  deleteFood: async () => { },
  loading: false,
  error: null,
  isSyncing: false,
});

export const FoodProvider = ({ children }: { children: ReactNode }) => {
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const { isOnline } = useNetwork();
  const { user } = useAuth();
  const { show: showToast } = useToast();

  const loadLocalFoods = useCallback(async () => {
    try {
      setError(null);
      const localFoods = await localDB.getAllFoods();
      const transformedFoods: FoodEntry[] = localFoods.map(item => ({
        id: item.id,
        name: item.name,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        date: item.date,
      }));
      logWithTs('[FoodContext] Loaded foods from local DB:', transformedFoods.length);
      setFoods(transformedFoods);
    } catch (error) {
      errorWithTs('[FoodContext] Error loading local foods:', error);
      setError('Failed to load food entries. Pull to refresh.');
    }
  }, []);

  const performSync = useCallback(async () => {
    try {
      setIsSyncing(true);
      logWithTs('[FoodContext] Performing sync...');
      await syncService.fullSync();
      await loadLocalFoods();
    } catch (error) {
      errorWithTs('[FoodContext] Error during sync:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [loadLocalFoods]);

  const initializeData = useCallback(async () => {
    try {
      setLoading(true);
      logWithTs('[FoodContext] Initializing local database...');

      // Initialize local DB
      await localDB.initialize();

      // Load from local DB first (instant UI)
      await loadLocalFoods();

      // If online, perform initial sync
      if (isOnline) {
        await performSync();
      }
    } catch (error) {
      errorWithTs('[FoodContext] Error initializing:', error);
    } finally {
      setLoading(false);
    }
  }, [isOnline, loadLocalFoods, performSync]);

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
      void loadLocalFoods();
    });

    return () => {
      unsubscribe();
      syncService.cleanupRealtimeSync();
    };
  }, [isOnline, loadLocalFoods, user?.id]);

  // Sync when coming online
  useEffect(() => {
    if (isOnline) {
      void performSync();
    }
  }, [isOnline, performSync]);

  const fetchFoods = useCallback(async () => {
    await loadLocalFoods();
    if (isOnline) {
      await performSync();
    }
  }, [isOnline, loadLocalFoods, performSync]);

  const deleteFood = useCallback(async (id: string) => {
    try {
      logWithTs('[FoodContext] Deleting food:', id);

      // Soft delete in local DB (marks as deleted, not synced)
      await localDB.softDeleteFood(id);

      // Update UI immediately
      setFoods(prev => prev.filter(f => f.id !== id));

      // Sync to Supabase if online (fire-and-forget — local write already done)
      if (isOnline) {
        void syncService.syncToSupabase().catch(err => {
          warnWithTs('[FoodContext] Sync failed:', err);
          showToast('Sync failed. Changes saved locally.', { type: 'error' });
        });
      }
    } catch (err) {
      errorWithTs('[FoodContext] Error deleting food:', err);
    }
  }, [isOnline]);

  const addFood = useCallback(async (food: FoodEntry) => {
    try {
      logWithTs('[FoodContext] Adding food:', food);

      // Generate UUID if not provided
      const foodId = food.id || Crypto.randomUUID();
      const newFood = { ...food, id: foodId };

      // Save to local DB first (offline-first)
      await localDB.insertFood({
        id: newFood.id,
        name: newFood.name,
        calories: newFood.calories,
        protein: newFood.protein,
        carbs: newFood.carbs,
        fat: newFood.fat,
        date: newFood.date,
      });

      // Update UI immediately
      setFoods(prev => [newFood, ...prev]);

      // Sync to Supabase if online (fire-and-forget — local write already done)
      if (isOnline) {
        void syncService.syncToSupabase().catch(err => {
          warnWithTs('[FoodContext] Sync failed:', err);
          showToast('Sync failed. Changes saved locally.', { type: 'error' });
        });
      }
    } catch (error) {
      errorWithTs('[FoodContext] Error adding food:', error);
      throw error;
    }
  }, [isOnline]);

  const value = useMemo(
    () => ({ foods, addFood, refreshFoods: fetchFoods, deleteFood, loading, error, isSyncing }),
    [foods, addFood, fetchFoods, deleteFood, loading, error, isSyncing],
  );

  return (
    <FoodContext.Provider value={value}>
      {children}
    </FoodContext.Provider>
  );
};

export const useFood = () => useContext(FoodContext);
