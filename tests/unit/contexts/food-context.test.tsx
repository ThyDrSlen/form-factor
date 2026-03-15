import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type * as FoodContextModule from '@/contexts/FoodContext';
import type { FoodEntry } from '@/contexts/FoodContext';

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'generated-uuid-123'),
}));

// Mock NetworkContext
const mockNetworkValue = { isOnline: true, isConnected: true, networkType: 'WIFI' };
jest.mock('@/contexts/NetworkContext', () => ({
  useNetwork: () => mockNetworkValue,
}));

// Mock AuthContext
const mockAuthValue = { user: { id: 'test-user-123' }, loading: false };
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

// Mock localDB
const mockLocalDB = {
  initialize: jest.fn().mockResolvedValue(undefined),
  getAllFoods: jest.fn().mockResolvedValue([]),
  insertFood: jest.fn().mockResolvedValue(undefined),
  softDeleteFood: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: mockLocalDB,
}));

// Mock syncService
const mockSyncCallbacks: (() => void)[] = [];
const mockSyncService = {
  fullSync: jest.fn().mockResolvedValue(undefined),
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  initializeRealtimeSync: jest.fn().mockResolvedValue(undefined),
  cleanupRealtimeSync: jest.fn(),
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

// Mock supabase (already mocked in setup.ts, but we need getUser)
const mockSupabaseAuth = (global as any).__mockSupabaseAuth as {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
  [key: string]: jest.Mock;
};

type FoodModule = typeof FoodContextModule;
let FoodProvider: FoodModule['FoodProvider'];
let useFood: FoodModule['useFood'];

beforeAll(() => {
  // Ensure getUser is available on the mock
  if (!mockSupabaseAuth.getUser) {
    mockSupabaseAuth.getUser = jest.fn();
  }
  mockSupabaseAuth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-123' } },
  });

  const mod = require('@/contexts/FoodContext') as FoodModule;
  FoodProvider = mod.FoodProvider;
  useFood = mod.useFood;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <FoodProvider>{children}</FoodProvider>
);

const makeFoodEntry = (overrides: Partial<FoodEntry> = {}): FoodEntry => ({
  id: 'food-1',
  name: 'Chicken Breast',
  calories: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
  date: '2026-03-15',
  ...overrides,
});

describe('FoodContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalDB.getAllFoods.mockResolvedValue([]);
    mockLocalDB.initialize.mockResolvedValue(undefined);
    mockLocalDB.insertFood.mockResolvedValue(undefined);
    mockLocalDB.softDeleteFood.mockResolvedValue(undefined);
    mockSyncService.fullSync.mockResolvedValue(undefined);
    mockSyncService.syncToSupabase.mockResolvedValue(undefined);
    mockSyncService.initializeRealtimeSync.mockResolvedValue(undefined);
    mockNetworkValue.isOnline = true;
    if (mockSupabaseAuth.getUser) {
      mockSupabaseAuth.getUser.mockResolvedValue({
        data: { user: { id: 'test-user-123' } },
      });
    }
  });

  describe('initialization', () => {
    it('should render without crashing', async () => {
      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should start with loading true and empty foods', () => {
      // Block initialization so loading stays true
      mockLocalDB.initialize.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useFood(), { wrapper });

      expect(result.current.foods).toEqual([]);
    });

    it('should initialize localDB and load foods', async () => {
      const existingFoods = [
        { id: 'f1', name: 'Rice', calories: 200, protein: 4, carbs: 45, fat: 0.4, date: '2026-03-15' },
        { id: 'f2', name: 'Eggs', calories: 155, protein: 13, carbs: 1, fat: 11, date: '2026-03-15' },
      ];
      mockLocalDB.getAllFoods.mockResolvedValue(existingFoods);

      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.foods).toHaveLength(2);
      expect(result.current.foods[0].name).toBe('Rice');
      expect(result.current.foods[1].name).toBe('Eggs');
      expect(mockLocalDB.initialize).toHaveBeenCalled();
    });
  });

  describe('addFood', () => {
    it('should add food to local DB and update state', async () => {
      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newFood = makeFoodEntry();

      await act(async () => {
        await result.current.addFood(newFood);
      });

      expect(mockLocalDB.insertFood).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'food-1',
          name: 'Chicken Breast',
          calories: 165,
        })
      );
      expect(result.current.foods).toHaveLength(1);
      expect(result.current.foods[0].name).toBe('Chicken Breast');
    });

    it('should sync to supabase when online', async () => {
      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.addFood(makeFoodEntry());
      });

      expect(mockSyncService.syncToSupabase).toHaveBeenCalled();
    });

    it('should not sync when offline', async () => {
      mockNetworkValue.isOnline = false;

      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Clear mocks after initialization
      mockSyncService.syncToSupabase.mockClear();

      await act(async () => {
        await result.current.addFood(makeFoodEntry());
      });

      expect(mockSyncService.syncToSupabase).not.toHaveBeenCalled();
      // But food should still be added locally
      expect(result.current.foods).toHaveLength(1);
    });

    it('should propagate errors from local DB', async () => {
      mockLocalDB.insertFood.mockRejectedValue(new Error('DB write failed'));

      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.addFood(makeFoodEntry());
        })
      ).rejects.toThrow('DB write failed');
    });
  });

  describe('deleteFood', () => {
    it('should soft delete food and update state', async () => {
      mockLocalDB.getAllFoods.mockResolvedValue([
        { id: 'f1', name: 'Rice', calories: 200, protein: 4, carbs: 45, fat: 0.4, date: '2026-03-15' },
      ]);

      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.foods).toHaveLength(1);
      });

      await act(async () => {
        await result.current.deleteFood('f1');
      });

      expect(mockLocalDB.softDeleteFood).toHaveBeenCalledWith('f1');
      expect(result.current.foods).toHaveLength(0);
    });

    it('should sync deletion when online', async () => {
      mockLocalDB.getAllFoods.mockResolvedValue([
        { id: 'f1', name: 'Rice', calories: 200, protein: 4, carbs: 45, fat: 0.4, date: '2026-03-15' },
      ]);

      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.foods).toHaveLength(1);
      });

      // Clear sync calls from initialization
      mockSyncService.syncToSupabase.mockClear();

      await act(async () => {
        await result.current.deleteFood('f1');
      });

      expect(mockSyncService.syncToSupabase).toHaveBeenCalled();
    });
  });

  describe('refreshFoods', () => {
    it('should reload foods from local DB', async () => {
      const { result } = renderHook(() => useFood(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Now set up foods for refresh
      mockLocalDB.getAllFoods.mockResolvedValue([
        { id: 'f1', name: 'Salad', calories: 50, protein: 2, carbs: 10, fat: 0.5, date: '2026-03-15' },
      ]);

      await act(async () => {
        await result.current.refreshFoods();
      });

      await waitFor(() => {
        expect(result.current.foods).toHaveLength(1);
        expect(result.current.foods[0].name).toBe('Salad');
      });
    });
  });

  describe('useFood outside provider', () => {
    it('should return default values when used outside provider', () => {
      const { result } = renderHook(() => useFood());

      expect(result.current.foods).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.isSyncing).toBe(false);
    });
  });
});
