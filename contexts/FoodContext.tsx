import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { localDB } from '../lib/services/database/local-db';
import { syncService } from '../lib/services/database/sync-service';
import { useNetwork } from './NetworkContext';
import { useAuth } from './AuthContext';

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
  isSyncing: boolean;
}

const FoodContext = createContext<FoodContextValue>({
  foods: [],
  addFood: async () => { },
  refreshFoods: async () => { },
  deleteFood: async () => { },
  loading: false,
  isSyncing: false,
});

export const FoodProvider = ({ children }: { children: ReactNode }) => {
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const { isOnline } = useNetwork();
  const { user } = useAuth();

  const loadLocalFoods = useCallback(async () => {
    try {
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
      console.log('[FoodProvider] Loaded foods from local DB:', transformedFoods.length);
      setFoods(transformedFoods);
    } catch (error) {
      console.error('[FoodProvider] Error loading local foods:', error);
    }
  }, []);

  const performSync = useCallback(async () => {
    try {
      setIsSyncing(true);
      console.log('[FoodProvider] Performing sync...');
      await syncService.fullSync();
      await loadLocalFoods();
    } catch (error) {
      console.error('[FoodProvider] Error during sync:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [loadLocalFoods]);

  const initializeData = useCallback(async () => {
    try {
      setLoading(true);
      console.log('[FoodProvider] Initializing local database...');

      // Initialize local DB
      await localDB.initialize();

      // Load from local DB first (instant UI)
      await loadLocalFoods();

      // If online, perform initial sync
      if (isOnline) {
        await performSync();
      }
    } catch (error) {
      console.error('[FoodProvider] Error initializing:', error);
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
      console.log('[FoodProvider] Deleting food:', id);
      
      // Soft delete in local DB (marks as deleted, not synced)
      await localDB.softDeleteFood(id);

      // Update UI immediately
      setFoods(prev => prev.filter(f => f.id !== id));

      // Sync to Supabase if online (fire-and-forget — local write already done)
      if (isOnline) {
        void syncService.syncToSupabase().catch(err => console.warn('[FoodContext] Sync failed:', err));
      }
    } catch (err) {
      console.error('[FoodProvider] Error deleting food:', err);
    }
  }, [isOnline]);

  const addFood = useCallback(async (food: FoodEntry) => {
    try {
      console.log('[FoodProvider] Adding food:', food);

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
        void syncService.syncToSupabase().catch(err => console.warn('[FoodContext] Sync failed:', err));
      }
    } catch (error) {
      console.error('[FoodProvider] Error adding food:', error);
      throw error;
    }
  }, [isOnline]);

  const value = useMemo(
    () => ({ foods, addFood, refreshFoods: fetchFoods, deleteFood, loading, isSyncing }),
    [foods, addFood, fetchFoods, deleteFood, loading, isSyncing],
  );

  return (
    <FoodContext.Provider value={value}>
      {children}
    </FoodContext.Provider>
  );
};

export const useFood = () => useContext(FoodContext);
