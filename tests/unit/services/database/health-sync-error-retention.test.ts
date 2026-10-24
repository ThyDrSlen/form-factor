import { syncService } from '@/lib/services/database/sync-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocalFood, LocalWorkout, LocalNutritionGoals } from '@/lib/services/database/local-db';

const mockMetric = {
  id: 'owner_2026-10-01', user_id: 'owner', summary_date: '2026-10-01',
  steps: 100, heart_rate_bpm: null, heart_rate_timestamp: null,
  weight_kg: null, weight_timestamp: null, synced: 0,
  updated_at: '2026-10-01T12:00:00.000Z',
};
const mockDatabase = {
  getSyncQueue: jest.fn(),
  getFoodById: jest.fn(),
  getWorkoutById: jest.fn(),
  getNutritionGoalsById: jest.fn(),
  getHealthMetricById: jest.fn(),
  deleteHealthMetric: jest.fn(),
  removeSyncQueueItem: jest.fn(),
  incrementSyncQueueRetry: jest.fn(),
  countSyncQueueItems: jest.fn(),
  getUnsyncedHealthMetrics: jest.fn(),
  getUnsyncedFoods: jest.fn(),
  getUnsyncedWorkouts: jest.fn(),
  getUnsyncedNutritionGoals: jest.fn(),
  addToSyncQueue: jest.fn(),
};
const mockFood: LocalFood = {
  id: 'food-1', name: 'Oats', calories: 100, date: '2026-10-01',
  synced: 0, deleted: 0, updated_at: '2026-10-01T12:00:00.000Z',
};
const mockWorkout: LocalWorkout = {
  id: 'workout-1', exercise: 'Squat', sets: 3, reps: 10, date: '2026-10-01',
  synced: 0, deleted: 0, updated_at: '2026-10-01T12:00:00.000Z',
};
const mockGoals: LocalNutritionGoals = {
  id: 'goals-1', user_id: 'owner', calories_goal: 2000, protein_goal: 100, carbs_goal: 250, fat_goal: 60,
  synced: 0, updated_at: '2026-10-01T12:00:00.000Z',
};
const persistedRows = { health_metrics: mockMetric, foods: mockFood, workouts: mockWorkout, nutrition_goals: mockGoals };
const mockFrom = jest.fn();
jest.mock('@/lib/services/database/local-db', () => ({ get localDB() { return mockDatabase; } }));
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  from: (...args: unknown[]) => mockFrom(...args),
} }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));
jest.mock('@/lib/services/database/generic-sync', () => ({ WORKOUT_SYNC_CONFIGS: [] }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  mockDatabase.getSyncQueue.mockResolvedValue([{
    id: 1, table_name: 'health_metrics', operation: 'upsert', record_id: mockMetric.id,
    data: JSON.stringify(mockMetric), created_at: mockMetric.updated_at, retry_count: 0,
  }]);
  mockDatabase.getHealthMetricById.mockResolvedValue(mockMetric);
  mockDatabase.getFoodById.mockImplementation(async (id: string) => id === mockFood.id ? { ...mockFood } : null);
  mockDatabase.getWorkoutById.mockImplementation(async (id: string) => id === mockWorkout.id ? { ...mockWorkout } : null);
  mockDatabase.getNutritionGoalsById.mockImplementation(async (id: string) => id === mockGoals.id ? { ...mockGoals } : null);
  mockDatabase.countSyncQueueItems.mockResolvedValue(1);
});

test.each(['22P02', '42501', 'PGRST204'])(
  'remote %s error retains the owned health row and queued retry', async code => {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { code, message: 'remote write unavailable' } }),
    };
    mockFrom.mockReturnValue(query);
    const service = syncService as unknown as { processSyncQueue(): Promise<boolean> };
    expect(await service.processSyncQueue()).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('health_metrics');
    expect(query.single).toHaveBeenCalled();
    expect(mockDatabase.deleteHealthMetric).not.toHaveBeenCalled();
    expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
    expect(mockDatabase.incrementSyncQueueRetry).toHaveBeenCalledWith(1, expect.any(String));
  },
);

const uploadPaths = [
  ['health_metrics', 'getUnsyncedHealthMetrics', 'syncHealthMetricsToSupabase'],
  ['foods', 'getUnsyncedFoods', 'syncFoodsToSupabase'],
  ['workouts', 'getUnsyncedWorkouts', 'syncWorkoutsToSupabase'],
  ['nutrition_goals', 'getUnsyncedNutritionGoals', 'syncNutritionGoalsToSupabase'],
] as const;

test.each(uploadPaths)('direct %s uploads respect an already queued retry delay', async (table, getter, method) => {
  const current = persistedRows[table];
  mockDatabase[getter].mockResolvedValue([current]);
  mockDatabase.getSyncQueue.mockResolvedValue([{
    id: 1, table_name: table, operation: 'upsert', record_id: current.id,
    data: JSON.stringify(current), created_at: current.updated_at, retry_count: 3,
    next_retry_at: new Date(Date.now() + 60_000).toISOString(),
  }]);
  const query = {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'access denied' } }),
  };
  mockFrom.mockReturnValue(query);
  const service = syncService as unknown as Record<string, () => Promise<void>>;
  await service[method]();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockDatabase.addToSyncQueue).not.toHaveBeenCalled();
});

test.each(uploadPaths)('%s resumes through the queue after the retry delay, without duplicate direct upload', async (table, getter, method) => {
  const current = persistedRows[table];
  mockDatabase[getter].mockResolvedValue([current]);
  mockDatabase.getSyncQueue.mockResolvedValue([{
    id: 1, table_name: table, operation: 'upsert', record_id: current.id,
    data: JSON.stringify(current), created_at: current.updated_at, retry_count: 3,
    next_retry_at: new Date(Date.now() - 1_000).toISOString(),
  }]);
  const query = {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'access denied' } }),
    upsert: jest.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'access denied' } }),
  };
  mockFrom.mockReturnValue(query);
  const service = syncService as unknown as Record<typeof method, () => Promise<void>> & {
    processSyncQueue(): Promise<boolean>;
  };
  await service[method]();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(await service.processSyncQueue()).toBe(true);
  expect(mockFrom).toHaveBeenCalledWith(table);
  expect(mockDatabase.incrementSyncQueueRetry).toHaveBeenCalledTimes(1);
  expect(mockDatabase.incrementSyncQueueRetry).toHaveBeenCalledWith(1, expect.any(String));
  expect(mockDatabase.addToSyncQueue).not.toHaveBeenCalled();
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
  expect(syncService.getSyncStatus().lastError).toBe('access denied');
  // Every upload path must stop on a failed conflict lookup; no blind upsert.
  expect(query.single).toHaveBeenCalledTimes(1);
  expect(query.upsert).not.toHaveBeenCalled();
  if (table === 'foods' || table === 'workouts') {
    const read = table === 'foods' ? mockDatabase.getFoodById : mockDatabase.getWorkoutById;
    expect(read).toHaveBeenCalledWith(current.id);
    expect(await read(current.id)).toEqual(current);
  }
});
