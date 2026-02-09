import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { localDB, LocalNutritionGoals } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';
import { useNetwork } from './NetworkContext';
import { useAuth } from './AuthContext';

export interface NutritionGoals {
  id?: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  user_id: string;
  updated_at?: string;
}

interface NutritionGoalsContextValue {
  goals: NutritionGoals | null;
  loading: boolean;
  isSyncing: boolean;
  saveGoals: (goals: Omit<NutritionGoals, 'id' | 'user_id' | 'updated_at'>) => Promise<{ error?: Error }>;
  refreshGoals: () => Promise<void>;
}

const NutritionGoalsContext = createContext<NutritionGoalsContextValue>({
  goals: null,
  loading: true,
  isSyncing: false,
  saveGoals: async () => ({ error: new Error('Not initialized') }),
  refreshGoals: async () => {},
});

const mapLocalToContext = (local: LocalNutritionGoals | null): NutritionGoals | null => {
  if (!local) return null;
  return {
    id: local.id,
    calories: local.calories_goal,
    protein: local.protein_goal || undefined,
    carbs: local.carbs_goal || undefined,
    fat: local.fat_goal || undefined,
    user_id: local.user_id,
    updated_at: local.updated_at,
  };
};

export const NutritionGoalsProvider = ({ children }: { children: ReactNode }) => {
  const [goals, setGoals] = useState<NutritionGoals | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const { isOnline } = useNetwork();
  const { user } = useAuth();

  const loadGoals = useCallback(async () => {
    if (!user) {
      setGoals(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      await localDB.initialize();
      const localGoals = await localDB.getNutritionGoals(user.id);
      setGoals(mapLocalToContext(localGoals));
    } catch (error) {
      console.error('[NutritionGoals] Error loading goals:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadGoals();
    const unsubscribe = syncService.onSyncComplete(() => {
      loadGoals();
    });
    return () => {
      unsubscribe();
    };
  }, [loadGoals]);

  const saveGoals = useCallback(async (goalData: Omit<NutritionGoals, 'id' | 'user_id' | 'updated_at'>) => {
    if (!user) {
      return { error: new Error('User not authenticated') };
    }

    try {
      setIsSyncing(true);

      const existing = await localDB.getNutritionGoals(user.id);
      const id = existing?.id ?? Crypto.randomUUID();
      const dataToSave: Omit<LocalNutritionGoals, 'synced' | 'updated_at'> = {
        id,
        user_id: user.id,
        calories_goal: goalData.calories,
        protein_goal: goalData.protein ?? 0,
        carbs_goal: goalData.carbs ?? 0,
        fat_goal: goalData.fat ?? 0,
      };

      await localDB.upsertNutritionGoals(dataToSave, 0);
      setGoals(mapLocalToContext({
        ...dataToSave,
        synced: 0,
        updated_at: new Date().toISOString(),
      }));

      if (isOnline) {
        await syncService.syncToSupabase();
        await loadGoals();
      }

      return { error: undefined };
    } catch (error) {
      console.error('[NutritionGoals] Error saving goals:', error);
      return { error: error instanceof Error ? error : new Error('Failed to save nutrition goals') };
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, loadGoals, user]);

  const refreshGoals = useCallback(async () => {
    await loadGoals();
    if (isOnline) {
      setIsSyncing(true);
      try {
        await syncService.fullSync();
        await loadGoals();
      } finally {
        setIsSyncing(false);
      }
    }
  }, [isOnline, loadGoals]);

  const value = useMemo(() => ({
    goals,
    loading,
    isSyncing,
    saveGoals,
    refreshGoals,
  }), [goals, loading, isSyncing, saveGoals, refreshGoals]);

  return (
    <NutritionGoalsContext.Provider value={value}>
      {children}
    </NutritionGoalsContext.Provider>
  );
};

export const useNutritionGoals = (): NutritionGoalsContextValue => {
  const context = useContext(NutritionGoalsContext);
  if (context === undefined) {
    throw new Error('useNutritionGoals must be used within a NutritionGoalsProvider');
  }
  return context;
};
