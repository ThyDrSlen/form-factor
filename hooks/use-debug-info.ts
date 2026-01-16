/**
 * Debug Information Hook
 * Provides useful debug data about the app state
 */

import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { localDB } from '@/lib/services/database/local-db';
import { errorWithTs } from '@/lib/logger';
import { useNetwork } from '@/contexts/NetworkContext';
import { useAuth } from '@/contexts/AuthContext';

export interface DebugInfo {
  // App Info
  appVersion: string;
  buildNumber: string;
  platform: string;
  expoVersion: string;
  
  // Sync Status
  unsyncedWorkouts: number;
  unsyncedFoods: number;
  syncQueueItems: number;
  
  // Auth Status
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  
  // Network Status
  isOnline: boolean;
  
  // Database Stats
  totalWorkouts: number;
  totalFoods: number;
}

export function useDebugInfo() {
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const { isOnline } = useNetwork();
  const { user } = useAuth();

  const refresh = async () => {
    try {
      setLoading(true);
      
      // Get sync status
      const unsyncedWorkouts = await localDB.getUnsyncedWorkouts();
      const unsyncedFoods = await localDB.getUnsyncedFoods();
      const syncQueue = await localDB.getSyncQueue();
      
      // Get total counts
      const allWorkouts = await localDB.getAllWorkouts();
      const allFoods = await localDB.getAllFoods();
      
      const info: DebugInfo = {
        // App Info
        appVersion: Constants.expoConfig?.version || '1.0.0',
        buildNumber: Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode?.toString() || '1',
        platform: Platform.OS,
        expoVersion: Constants.expoConfig?.sdkVersion || 'unknown',
        
        // Sync Status
        unsyncedWorkouts: unsyncedWorkouts.length,
        unsyncedFoods: unsyncedFoods.length,
        syncQueueItems: syncQueue.length,
        
        // Auth Status
        isAuthenticated: !!user,
        userId: user?.id || null,
        userEmail: user?.email || null,
        
        // Network Status
        isOnline,
        
        // Database Stats
        totalWorkouts: allWorkouts.length,
        totalFoods: allFoods.length,
      };
      
      setDebugInfo(info);
    } catch (error) {
      errorWithTs('[useDebugInfo] Error fetching debug info:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [isOnline, user]);

  return { debugInfo, loading, refresh };
}

