import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type * as NutritionGoalsContextModule from '@/contexts/NutritionGoalsContext';

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'generated-uuid-nutrition'),
}));

// Mock NetworkContext — mutate isOnline per-test
const mockNetworkValue = { isOnline: true, isConnected: true, networkType: 'WIFI' };
jest.mock('@/contexts/NetworkContext', () => ({
  useNetwork: () => mockNetworkValue,
}));

// Mock AuthContext — mutate user per-test
const mockAuthValue: { user: { id: string } | null; loading: boolean } = {
  user: { id: 'test-user-123' },
  loading: false,
};
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

// Mock localDB
const mockLocalDB = {
  initialize: jest.fn().mockResolvedValue(undefined),
  getNutritionGoals: jest.fn().mockResolvedValue(null),
  upsertNutritionGoals: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: mockLocalDB,
}));

// Mock syncService
const mockSyncCallbacks: (() => void)[] = [];
const mockSyncService = {
  fullSync: jest.fn().mockResolvedValue(undefined),
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  onSyncComplete: jest.fn((cb: () => void) => {
    mockSyncCallbacks.push(cb);
    return () => {
      const idx = mockSyncCallbacks.indexOf(cb);
      if (idx >= 0) mockSyncCallbacks.splice(idx, 1);
    };
  }),
};

jest.mock('@/lib/services/database/sync-service', () => ({
  syncService: mockSyncService,
}));

type NutritionGoalsModule = typeof NutritionGoalsContextModule;
let NutritionGoalsProvider: NutritionGoalsModule['NutritionGoalsProvider'];
let useNutritionGoals: NutritionGoalsModule['useNutritionGoals'];

beforeAll(() => {
  const mod = require('@/contexts/NutritionGoalsContext') as NutritionGoalsModule;
  NutritionGoalsProvider = mod.NutritionGoalsProvider;
  useNutritionGoals = mod.useNutritionGoals;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NutritionGoalsProvider>{children}</NutritionGoalsProvider>
);

const makeLocalGoals = (overrides = {}) => ({
  id: 'goal-1',
  user_id: 'test-user-123',
  calories_goal: 2000,
  protein_goal: 150,
  carbs_goal: 200,
  fat_goal: 70,
  synced: 1,
  updated_at: '2026-03-15T12:00:00.000Z',
  ...overrides,
});

describe('NutritionGoalsContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalDB.initialize.mockResolvedValue(undefined);
    mockLocalDB.getNutritionGoals.mockResolvedValue(null);
    mockLocalDB.upsertNutritionGoals.mockResolvedValue(undefined);
    mockSyncService.fullSync.mockResolvedValue(undefined);
    mockSyncService.syncToSupabase.mockResolvedValue(undefined);
    mockNetworkValue.isOnline = true;
    mockAuthValue.user = { id: 'test-user-123' };
  });

  describe('initialization', () => {
    it('renders children without crashing', async () => {
      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('starts with loading true before DB resolves', () => {
      // Block initialization so loading stays true
      mockLocalDB.initialize.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      expect(result.current.loading).toBe(true);
      expect(result.current.goals).toBeNull();
    });

    it('loads goals from local DB on mount', async () => {
      mockLocalDB.getNutritionGoals.mockResolvedValue(makeLocalGoals());

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockLocalDB.initialize).toHaveBeenCalled();
      expect(mockLocalDB.getNutritionGoals).toHaveBeenCalledWith('test-user-123');
      expect(result.current.goals).toMatchObject({
        id: 'goal-1',
        calories: 2000,
        protein: 150,
        carbs: 200,
        fat: 70,
        user_id: 'test-user-123',
      });
    });

    it('sets goals to null when no goals exist in DB', async () => {
      mockLocalDB.getNutritionGoals.mockResolvedValue(null);

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.goals).toBeNull();
    });

    it('sets goals to null and stops loading when user is null', async () => {
      mockAuthValue.user = null;

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.goals).toBeNull();
      expect(mockLocalDB.initialize).not.toHaveBeenCalled();
    });

    it('sets loading to false after fetch completes', async () => {
      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      // loading starts true
      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('saveGoals', () => {
    it('calls upsertNutritionGoals with correct data when online', async () => {
      mockLocalDB.getNutritionGoals.mockResolvedValue(null);

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        const { error } = await result.current.saveGoals({
          calories: 2500,
          protein: 180,
          carbs: 250,
          fat: 80,
        });
        expect(error).toBeUndefined();
      });

      expect(mockLocalDB.upsertNutritionGoals).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'test-user-123',
          calories_goal: 2500,
          protein_goal: 180,
          carbs_goal: 250,
          fat_goal: 80,
        }),
        0
      );
    });

    it('syncs to Supabase when online', async () => {
      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockSyncService.syncToSupabase.mockClear();

      await act(async () => {
        await result.current.saveGoals({ calories: 2000 });
      });

      expect(mockSyncService.syncToSupabase).toHaveBeenCalled();
    });

    it('does not call syncToSupabase when offline, but still upserts locally', async () => {
      mockNetworkValue.isOnline = false;

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockSyncService.syncToSupabase.mockClear();

      await act(async () => {
        const { error } = await result.current.saveGoals({ calories: 1800 });
        expect(error).toBeUndefined();
      });

      expect(mockSyncService.syncToSupabase).not.toHaveBeenCalled();
      expect(mockLocalDB.upsertNutritionGoals).toHaveBeenCalled();
    });

    it('updates goals state after upsert and subsequent reload', async () => {
      // Initial load — no goals yet
      mockLocalDB.getNutritionGoals.mockResolvedValue(null);

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // After upsert the DB now has the goals (simulates what loadGoals sees post-sync)
      mockLocalDB.getNutritionGoals.mockResolvedValue(
        makeLocalGoals({ calories_goal: 3000, protein_goal: 200, carbs_goal: 300, fat_goal: 100 })
      );

      await act(async () => {
        await result.current.saveGoals({
          calories: 3000,
          protein: 200,
          carbs: 300,
          fat: 100,
        });
      });

      // After save + reload, goals should reflect the saved values
      expect(result.current.goals).toMatchObject({
        calories: 3000,
        protein: 200,
        carbs: 300,
        fat: 100,
        user_id: 'test-user-123',
      });
    });

    it('reuses existing goal id when one already exists', async () => {
      mockLocalDB.getNutritionGoals.mockResolvedValue(makeLocalGoals({ id: 'existing-goal-id' }));

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveGoals({ calories: 2200 });
      });

      expect(mockLocalDB.upsertNutritionGoals).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'existing-goal-id' }),
        0
      );
    });

    it('generates a new UUID when no existing goal exists', async () => {
      mockLocalDB.getNutritionGoals.mockResolvedValue(null);

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveGoals({ calories: 2200 });
      });

      expect(mockLocalDB.upsertNutritionGoals).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'generated-uuid-nutrition' }),
        0
      );
    });

    it('returns an error when user is not authenticated', async () => {
      mockAuthValue.user = null;

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const { error } = await act(async () => {
        return result.current.saveGoals({ calories: 2000 });
      });

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe('User not authenticated');
      expect(mockLocalDB.upsertNutritionGoals).not.toHaveBeenCalled();
    });

    it('returns an error when DB upsert throws', async () => {
      mockLocalDB.upsertNutritionGoals.mockRejectedValue(new Error('DB write failed'));

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const { error } = await act(async () => {
        return result.current.saveGoals({ calories: 2000 });
      });

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe('DB write failed');
    });

    it('sets isSyncing to true during save and false after', async () => {
      let resolveUpsert!: () => void;
      mockLocalDB.upsertNutritionGoals.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveUpsert = resolve;
        })
      );

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Start saveGoals but don't await yet
      let savePromise: Promise<{ error?: Error }>;
      act(() => {
        savePromise = result.current.saveGoals({ calories: 2000 });
      });

      await waitFor(() => {
        expect(result.current.isSyncing).toBe(true);
      });

      // Resolve the upsert and finish
      await act(async () => {
        resolveUpsert();
        await savePromise;
      });

      expect(result.current.isSyncing).toBe(false);
    });
  });

  describe('refreshGoals', () => {
    it('fetches goals from local DB and updates state', async () => {
      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set up new data for the refresh
      mockLocalDB.getNutritionGoals.mockResolvedValue(
        makeLocalGoals({ calories_goal: 2800, protein_goal: 210 })
      );

      await act(async () => {
        await result.current.refreshGoals();
      });

      await waitFor(() => {
        expect(result.current.goals?.calories).toBe(2800);
        expect(result.current.goals?.protein).toBe(210);
      });
    });

    it('calls fullSync when online', async () => {
      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockSyncService.fullSync.mockClear();

      await act(async () => {
        await result.current.refreshGoals();
      });

      expect(mockSyncService.fullSync).toHaveBeenCalled();
    });

    it('does not call fullSync when offline', async () => {
      mockNetworkValue.isOnline = false;

      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockSyncService.fullSync.mockClear();

      await act(async () => {
        await result.current.refreshGoals();
      });

      expect(mockSyncService.fullSync).not.toHaveBeenCalled();
    });

    it('sets loading to false after refreshGoals completes', async () => {
      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.refreshGoals();
      });

      expect(result.current.loading).toBe(false);
    });
  });

  describe('sync callback integration', () => {
    it('reloads goals when syncService fires onSyncComplete', async () => {
      const { result } = renderHook(() => useNutritionGoals(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Simulate updated data arriving from sync
      mockLocalDB.getNutritionGoals.mockResolvedValue(
        makeLocalGoals({ calories_goal: 3200 })
      );

      // Fire all registered sync-complete callbacks
      await act(async () => {
        for (const cb of mockSyncCallbacks) cb();
      });

      await waitFor(() => {
        expect(result.current.goals?.calories).toBe(3200);
      });
    });
  });
});
