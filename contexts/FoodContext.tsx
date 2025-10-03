import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { localDB } from '../lib/services/database/local-db';
import { syncService } from '../lib/services/database/sync-service';
import { supabase } from '../lib/supabase';
import { useNetwork } from './NetworkContext';

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
      loadLocalFoods();
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
  };

  const loadLocalFoods = async () => {
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
  };

  const performSync = async () => {
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
  };

  const fetchFoods = async () => {
    await loadLocalFoods();
    if (isOnline) {
      await performSync();
    }
  };

  const deleteFood = async (id: string) => {
    try {
      console.log('[FoodProvider] Deleting food:', id);
      
      // Soft delete in local DB (marks as deleted, not synced)
      await localDB.softDeleteFood(id);

      // Update UI immediately
      setFoods(prev => prev.filter(f => f.id !== id));

      // Sync to Supabase if online
      if (isOnline) {
        await syncService.syncToSupabase();
      }
    } catch (err) {
      console.error('[FoodProvider] Error deleting food:', err);
    }
  };

  const addFood = async (food: FoodEntry) => {
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

      // Sync to Supabase if online
      if (isOnline) {
        await syncService.syncToSupabase();
      }
    } catch (error) {
      console.error('[FoodProvider] Error adding food:', error);
      throw error;
    }
  };

  return (
    <FoodContext.Provider value={{ foods, addFood, refreshFoods: fetchFoods, deleteFood, loading, isSyncing }}>
      {children}
    </FoodContext.Provider>
  );
};

export const useFood = () => useContext(FoodContext);
