import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type * as WorkoutsContextModule from '@/contexts/WorkoutsContext';
import type { Workout } from '@/contexts/WorkoutsContext';

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'generated-uuid-456'),
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
  getAllWorkouts: jest.fn().mockResolvedValue([]),
  insertWorkout: jest.fn().mockResolvedValue(undefined),
  softDeleteWorkout: jest.fn().mockResolvedValue(undefined),
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

type WorkoutsModule = typeof WorkoutsContextModule;
let WorkoutsProvider: WorkoutsModule['WorkoutsProvider'];
let useWorkouts: WorkoutsModule['useWorkouts'];

beforeAll(() => {
  if (!mockSupabaseAuth.getUser) {
    mockSupabaseAuth.getUser = jest.fn();
  }
  mockSupabaseAuth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-123' } },
  });

  const mod = require('@/contexts/WorkoutsContext') as WorkoutsModule;
  WorkoutsProvider = mod.WorkoutsProvider;
  useWorkouts = mod.useWorkouts;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WorkoutsProvider>{children}</WorkoutsProvider>
);

const makeWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: 'w-1',
  exercise: 'Bench Press',
  sets: 3,
  reps: 10,
  weight: 135,
  duration: undefined,
  date: '2026-03-15',
  ...overrides,
});

describe('WorkoutsContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalDB.getAllWorkouts.mockResolvedValue([]);
    mockLocalDB.initialize.mockResolvedValue(undefined);
    mockLocalDB.insertWorkout.mockResolvedValue(undefined);
    mockLocalDB.softDeleteWorkout.mockResolvedValue(undefined);
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
      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should load workouts from local DB on init', async () => {
      const existingWorkouts = [
        { id: 'w1', exercise: 'Squat', sets: 5, reps: 5, weight: 225, duration: undefined, date: '2026-03-15' },
        { id: 'w2', exercise: 'Deadlift', sets: 3, reps: 5, weight: 315, duration: undefined, date: '2026-03-15' },
      ];
      mockLocalDB.getAllWorkouts.mockResolvedValue(existingWorkouts);

      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.workouts).toHaveLength(2);
      expect(result.current.workouts[0].exercise).toBe('Squat');
      expect(result.current.workouts[1].exercise).toBe('Deadlift');
      expect(mockLocalDB.initialize).toHaveBeenCalled();
    });

    it('should start with isWorkoutInProgress as false', async () => {
      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isWorkoutInProgress).toBe(false);
    });
  });

  describe('addWorkout', () => {
    it('should add workout to local DB and update state', async () => {
      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newWorkout = makeWorkout();

      await act(async () => {
        await result.current.addWorkout(newWorkout);
      });

      expect(mockLocalDB.insertWorkout).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'w-1',
          exercise: 'Bench Press',
          sets: 3,
          reps: 10,
          weight: 135,
        })
      );
      expect(result.current.workouts).toHaveLength(1);
      expect(result.current.workouts[0].exercise).toBe('Bench Press');
    });

    it('should sync to supabase when online', async () => {
      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Clear sync calls from initialization
      mockSyncService.syncToSupabase.mockClear();

      await act(async () => {
        await result.current.addWorkout(makeWorkout());
      });

      expect(mockSyncService.syncToSupabase).toHaveBeenCalled();
    });

    it('should not sync when offline', async () => {
      mockNetworkValue.isOnline = false;

      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockSyncService.syncToSupabase.mockClear();

      await act(async () => {
        await result.current.addWorkout(makeWorkout());
      });

      expect(mockSyncService.syncToSupabase).not.toHaveBeenCalled();
      expect(result.current.workouts).toHaveLength(1);
    });

    it('should propagate errors from local DB', async () => {
      mockLocalDB.insertWorkout.mockRejectedValue(new Error('DB write failed'));

      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.addWorkout(makeWorkout());
        })
      ).rejects.toThrow('DB write failed');
    });
  });

  describe('deleteWorkout', () => {
    it('should soft delete workout and update state', async () => {
      mockLocalDB.getAllWorkouts.mockResolvedValue([
        { id: 'w1', exercise: 'Squat', sets: 5, reps: 5, weight: 225, duration: undefined, date: '2026-03-15' },
      ]);

      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.workouts).toHaveLength(1);
      });

      await act(async () => {
        await result.current.deleteWorkout('w1');
      });

      expect(mockLocalDB.softDeleteWorkout).toHaveBeenCalledWith('w1');
      expect(result.current.workouts).toHaveLength(0);
    });
  });

  describe('startWorkout / endWorkout', () => {
    it('should toggle isWorkoutInProgress', async () => {
      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isWorkoutInProgress).toBe(false);

      act(() => {
        result.current.startWorkout();
      });

      expect(result.current.isWorkoutInProgress).toBe(true);

      act(() => {
        result.current.endWorkout();
      });

      expect(result.current.isWorkoutInProgress).toBe(false);
    });
  });

  describe('refreshWorkouts', () => {
    it('should reload workouts from local DB', async () => {
      const { result } = renderHook(() => useWorkouts(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockLocalDB.getAllWorkouts.mockResolvedValue([
        { id: 'w1', exercise: 'Pull-up', sets: 4, reps: 8, weight: undefined, duration: undefined, date: '2026-03-15' },
      ]);

      await act(async () => {
        await result.current.refreshWorkouts();
      });

      await waitFor(() => {
        expect(result.current.workouts).toHaveLength(1);
        expect(result.current.workouts[0].exercise).toBe('Pull-up');
      });
    });
  });

  describe('useWorkouts outside provider', () => {
    it('should return default values when used outside provider', () => {
      const { result } = renderHook(() => useWorkouts());

      expect(result.current.workouts).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.isWorkoutInProgress).toBe(false);
    });
  });
});
