import { localDB } from '../../../lib/services/database/local-db';

const mockOpenDatabaseAsync = jest.fn();
const mockExecAsync = jest.fn();
const mockRunAsync = jest.fn();
const mockGetAllAsync = jest.fn();
const mockCloseAsync = jest.fn();

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
      };
      mockOpenDatabaseAsync.mockResolvedValue(mockDb);

      // Call method without explicit initialize
      const foods = await localDB.getAllFoods();
      expect(mockOpenDatabaseAsync).toHaveBeenCalled();
    });
  });
});
