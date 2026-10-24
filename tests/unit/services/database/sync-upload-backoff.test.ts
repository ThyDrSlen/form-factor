import { syncService } from '@/lib/services/database/sync-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncTableToSupabase, WORKOUT_SYNC_CONFIGS } from '@/lib/services/database/generic-sync';

const mockDatabase = {
  getSyncQueue: jest.fn(), getUnsyncedFoods: jest.fn(), getUnsyncedWorkouts: jest.fn(),
  getUnsyncedHealthMetrics: jest.fn(), getUnsyncedNutritionGoals: jest.fn(),
  addToSyncQueue: jest.fn(), db: { getAllAsync: jest.fn(), runAsync: jest.fn() },
};
const mockFrom = jest.fn();
jest.mock('@/lib/services/database/local-db', () => ({ get localDB() { return mockDatabase; } }));
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  from: (...args: unknown[]) => mockFrom(...args),
} }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  const row = { id: 'record', user_id: 'owner', synced: 0, updated_at: '2026-01-01T00:00:00.000Z' };
  for (const method of ['getUnsyncedFoods', 'getUnsyncedWorkouts', 'getUnsyncedHealthMetrics', 'getUnsyncedNutritionGoals'] as const) {
    mockDatabase[method].mockResolvedValue([row]);
  }
  mockDatabase.db.getAllAsync.mockResolvedValue([row]);
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } }) };
  mockFrom.mockReturnValue(query);
});

test.each([
  ['foods', 'syncFoodsToSupabase'], ['workouts', 'syncWorkoutsToSupabase'],
  ['health_metrics', 'syncHealthMetricsToSupabase'], ['nutrition_goals', 'syncNutritionGoalsToSupabase'],
  ['exercises', 'generic'],
])('%s leaves existing retries to the queue worker without resetting their backoff', async (table, method) => {
  const queued = { id: 10, table_name: table, record_id: 'record', operation: 'upsert',
    retry_count: 8, created_at: '2026-01-01T00:00:00.000Z', next_retry_at: new Date(Date.now() + 60_000).toISOString(), data: '{}' };
  mockDatabase.getSyncQueue.mockResolvedValue([queued]);
  // Both deferred and eligible retries belong to the queue worker. A new scan
  // must not reset the retry count when an eligible attempt fails again.
  for (const nextRetryAt of [queued.next_retry_at, '2020-01-01T00:00:00.000Z']) {
    queued.next_retry_at = nextRetryAt;
    if (method === 'generic') {
      await syncTableToSupabase(WORKOUT_SYNC_CONFIGS.find(config => config.localTable === table)!, 'owner');
    } else {
      await (syncService as unknown as Record<string, () => Promise<void>>)[method]();
    }
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockDatabase.addToSyncQueue).not.toHaveBeenCalled();
  }
});
