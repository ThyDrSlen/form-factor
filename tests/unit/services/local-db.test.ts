import { localDB } from '../../../lib/services/database/local-db';

const mockOpenDatabaseAsync = jest.fn();
const mockExecAsync = jest.fn();
const mockRunAsync = jest.fn();
const mockGetAllAsync = jest.fn();
const mockCloseAsync = jest.fn();
const mockWithTransactionAsync = jest.fn();

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: any[]) => mockOpenDatabaseAsync(...args),
}));

describe('LocalDatabase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton state
    (localDB as any).db = null;
    (localDB as any).initPromise = null;
  });

  describe('ensureInitialized', () => {
    it('should return db instance when already initialized', async () => {
      const mockDb = {
        execAsync: mockExecAsync.mockResolvedValue(undefined),
        runAsync: mockRunAsync,
        getAllAsync: mockGetAllAsync,
        closeAsync: mockCloseAsync,
        withTransactionAsync: mockWithTransactionAsync,
      };
      mockOpenDatabaseAsync.mockResolvedValue(mockDb);
      mockExecAsync.mockResolvedValue(undefined);

      // Initialize first
      await localDB.initialize();

      // Should return immediately without re-initializing
      const result = await (localDB as any).ensureInitialized();
      expect(result.ok).toBe(true);
      expect(result.data).toBe(mockDb);
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
    });

    it('should auto-initialize when db is null', async () => {
      const mockDb = {
        execAsync: mockExecAsync.mockResolvedValue(undefined),
        runAsync: mockRunAsync,
        getAllAsync: mockGetAllAsync,
        closeAsync: mockCloseAsync,
        withTransactionAsync: mockWithTransactionAsync,
      };
      mockOpenDatabaseAsync.mockResolvedValue(mockDb);

      const result = await (localDB as any).ensureInitialized();
      expect(result.ok).toBe(true);
      expect(result.data).toBe(mockDb);
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient failures with exponential backoff', async () => {
      const mockDb = {
        execAsync: mockExecAsync.mockResolvedValue(undefined),
        runAsync: mockRunAsync,
        getAllAsync: mockGetAllAsync,
        closeAsync: mockCloseAsync,
        withTransactionAsync: mockWithTransactionAsync,
      };

      // ensureInitialized retries internally: fail twice, then recover.
      mockOpenDatabaseAsync
        .mockRejectedValueOnce(new Error('Database locked'))
        .mockRejectedValueOnce(new Error('Database busy'))
        .mockResolvedValueOnce(mockDb);

      const result = await (localDB as any).ensureInitialized();
      expect(result.ok).toBe(true);
      expect(result.data).toBe(mockDb);
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(3);
    });

    it('should return typed error after max retries exceeded', async () => {
      // Reset state
      (localDB as any).db = null;
      (localDB as any).initPromise = null;

      mockOpenDatabaseAsync.mockRejectedValue(new Error('Persistent failure'));

      const result = await (localDB as any).ensureInitialized();
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        domain: 'storage',
        code: 'DB_INIT_FAILED',
        retryable: false,
      });
      // ensureInitialized retries 3 times with exponential backoff
      expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(3);
    });
  });

  describe('high-traffic methods with resilience', () => {
    beforeEach(async () => {
      const mockDb = {
        execAsync: mockExecAsync.mockResolvedValue(undefined),
        runAsync: mockRunAsync.mockResolvedValue(undefined),
        getAllAsync: mockGetAllAsync.mockResolvedValue([]),
        closeAsync: mockCloseAsync,
        withTransactionAsync: mockWithTransactionAsync.mockImplementation(
          async (fn: () => Promise<void>) => fn(),
        ),
      };
      mockOpenDatabaseAsync.mockResolvedValue(mockDb);
      await localDB.initialize();
    });

    it('insertFood should work with initialized db', async () => {
      const food = {
        id: 'test-food-1',
        name: 'Test Food',
        calories: 100,
        date: '2024-01-01',
      };

      await expect(localDB.insertFood(food)).resolves.not.toThrow();
      expect(mockRunAsync).toHaveBeenCalled();
    });

    it('getAllFoods should work with initialized db', async () => {
      mockGetAllAsync.mockResolvedValue([
        { id: '1', name: 'Food 1', calories: 100, date: '2024-01-01', synced: 0, deleted: 0, updated_at: '2024-01-01' },
      ]);

      const foods = await localDB.getAllFoods();
      expect(foods).toHaveLength(1);
      expect(mockGetAllAsync).toHaveBeenCalled();
    });

    it('insertWorkout should work with initialized db', async () => {
      const workout = {
        id: 'test-workout-1',
        exercise: 'Push-ups',
        sets: 3,
        date: '2024-01-01',
      };

      await expect(localDB.insertWorkout(workout)).resolves.not.toThrow();
      expect(mockRunAsync).toHaveBeenCalled();
    });

    it('getAllWorkouts should work with initialized db', async () => {
      mockGetAllAsync.mockResolvedValue([
        { id: '1', exercise: 'Squats', sets: 3, date: '2024-01-01', synced: 0, deleted: 0, updated_at: '2024-01-01' },
      ]);

      const workouts = await localDB.getAllWorkouts();
      expect(workouts).toHaveLength(1);
      expect(mockGetAllAsync).toHaveBeenCalled();
    });

    it('getNutritionGoals should work with initialized db', async () => {
      mockGetAllAsync.mockResolvedValue([
        { id: '1', user_id: 'user-1', calories_goal: 2000, protein_goal: 150, carbs_goal: 200, fat_goal: 70, synced: 0, updated_at: '2024-01-01' },
      ]);

      const goals = await localDB.getNutritionGoals('user-1');
      expect(goals).not.toBeNull();
      expect(mockGetAllAsync).toHaveBeenCalled();
    });

    it('upsertNutritionGoals should work with initialized db', async () => {
      const goals = {
        id: '1',
        user_id: 'user-1',
        calories_goal: 2000,
        protein_goal: 150,
        carbs_goal: 200,
        fat_goal: 70,
      };

      await expect(localDB.upsertNutritionGoals(goals)).resolves.not.toThrow();
      expect(mockRunAsync).toHaveBeenCalled();
    });
  });

  describe('atomic write+queue transaction methods', () => {
    beforeEach(async () => {
      const mockDb = {
        execAsync: mockExecAsync.mockResolvedValue(undefined),
        runAsync: mockRunAsync.mockResolvedValue(undefined),
        getAllAsync: mockGetAllAsync.mockResolvedValue([]),
        closeAsync: mockCloseAsync,
        withTransactionAsync: mockWithTransactionAsync.mockImplementation(
          async (fn: () => Promise<void>) => fn(),
        ),
      };
      mockOpenDatabaseAsync.mockResolvedValue(mockDb);
      await localDB.initialize();
      // Clear mock call counts from initialization (seed + migration calls)
      mockRunAsync.mockClear();
      mockWithTransactionAsync.mockClear();
      // Re-apply the implementation after clear
      mockWithTransactionAsync.mockImplementation(
        async (fn: () => Promise<void>) => fn(),
      );
    });

    it('insertFoodAndQueue should call runAsync twice inside a transaction', async () => {
      const food = { id: 'f1', name: 'Apple', calories: 95, date: '2024-01-01' };

      await localDB.insertFoodAndQueue(food, { name: 'Apple' });

      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
      // INSERT food + INSERT sync_queue
      expect(mockRunAsync).toHaveBeenCalledTimes(2);
      const secondCall = mockRunAsync.mock.calls[1];
      expect(secondCall[0]).toContain('INSERT INTO sync_queue');
      expect(secondCall[1]).toEqual(
        expect.arrayContaining(['foods', 'upsert', 'f1']),
      );
    });

    it('softDeleteFoodAndQueue should call runAsync twice inside a transaction', async () => {
      await localDB.softDeleteFoodAndQueue('f1');

      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
      expect(mockRunAsync).toHaveBeenCalledTimes(2);
      const firstCall = mockRunAsync.mock.calls[0];
      expect(firstCall[0]).toContain('UPDATE foods SET deleted = 1');
      const secondCall = mockRunAsync.mock.calls[1];
      expect(secondCall[0]).toContain('INSERT INTO sync_queue');
      expect(secondCall[1]).toEqual(
        expect.arrayContaining(['foods', 'delete', 'f1']),
      );
    });

    it('insertWorkoutAndQueue should call runAsync twice inside a transaction', async () => {
      const workout = { id: 'w1', exercise: 'Squat', sets: 3, date: '2024-01-01' };

      await localDB.insertWorkoutAndQueue(workout, { exercise: 'Squat' });

      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
      expect(mockRunAsync).toHaveBeenCalledTimes(2);
      const secondCall = mockRunAsync.mock.calls[1];
      expect(secondCall[1]).toEqual(
        expect.arrayContaining(['workouts', 'upsert', 'w1']),
      );
    });

    it('softDeleteWorkoutAndQueue should call runAsync twice inside a transaction', async () => {
      await localDB.softDeleteWorkoutAndQueue('w1');

      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
      expect(mockRunAsync).toHaveBeenCalledTimes(2);
      const secondCall = mockRunAsync.mock.calls[1];
      expect(secondCall[1]).toEqual(
        expect.arrayContaining(['workouts', 'delete', 'w1']),
      );
    });

    it('insertHealthMetricAndQueue should call runAsync twice inside a transaction', async () => {
      const metric = {
        id: 'hm1', user_id: 'u1', summary_date: '2024-01-01',
        steps: 10000, heart_rate_bpm: 72, heart_rate_timestamp: null,
        weight_kg: 80, weight_timestamp: null,
      };

      await localDB.insertHealthMetricAndQueue(metric);

      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
      expect(mockRunAsync).toHaveBeenCalledTimes(2);
      const secondCall = mockRunAsync.mock.calls[1];
      expect(secondCall[1]).toEqual(
        expect.arrayContaining(['health_metrics', 'upsert', 'hm1']),
      );
    });

    it('upsertNutritionGoalsAndQueue should call runAsync twice inside a transaction', async () => {
      const goals = {
        id: 'ng1', user_id: 'u1',
        calories_goal: 2000, protein_goal: 150, carbs_goal: 200, fat_goal: 70,
      };

      await localDB.upsertNutritionGoalsAndQueue(goals);

      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
      expect(mockRunAsync).toHaveBeenCalledTimes(2);
      const secondCall = mockRunAsync.mock.calls[1];
      expect(secondCall[1]).toEqual(
        expect.arrayContaining(['nutrition_goals', 'upsert', 'ng1']),
      );
    });

    it('transaction should roll back both writes when sync queue insert fails', async () => {
      // Make the second runAsync call (sync_queue insert) fail
      mockRunAsync
        .mockResolvedValueOnce(undefined) // food insert succeeds
        .mockRejectedValueOnce(new Error('sync queue write failed'));

      // Make withTransactionAsync propagate the error (simulating rollback)
      mockWithTransactionAsync.mockImplementation(async (fn: () => Promise<void>) => {
        await fn(); // This will throw because mockRunAsync rejects on 2nd call
      });

      const food = { id: 'f1', name: 'Apple', calories: 95, date: '2024-01-01' };

      await expect(localDB.insertFoodAndQueue(food)).rejects.toThrow('sync queue write failed');
    });

    it('withTransaction should propagate errors', async () => {
      await expect(
        localDB.withTransaction(async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');
      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
    });

    it('cleanupSyncedDeletes should run inside a transaction', async () => {
      await localDB.cleanupSyncedDeletes();
      expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
      // 8 DELETE statements
      expect(mockRunAsync).toHaveBeenCalledTimes(8);
    });
  });

  describe('recovery from uninitialized state', () => {
    it('should recover when called without explicit initialize', async () => {
      // Reset state
      (localDB as any).db = null;
      (localDB as any).initPromise = null;

      const mockDb = {
        execAsync: mockExecAsync.mockResolvedValue(undefined),
        runAsync: mockRunAsync.mockResolvedValue(undefined),
        getAllAsync: mockGetAllAsync.mockResolvedValue([]),
        closeAsync: mockCloseAsync,
        withTransactionAsync: mockWithTransactionAsync,
      };
      mockOpenDatabaseAsync.mockResolvedValue(mockDb);

      // Call method without explicit initialize
      const foods = await localDB.getAllFoods();
      expect(mockOpenDatabaseAsync).toHaveBeenCalled();
    });
  });
});
