/** @jest-environment node */
import { localDB } from '@/lib/services/database/local-db.web';
import { syncService } from '@/lib/services/database/sync-service';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/logger', () => ({ errorWithTs: jest.fn(), warnWithTs: jest.fn(), logWithTs: jest.fn() }));
jest.mock('@/lib/services/database/local-db', () => jest.requireActual('@/lib/services/database/local-db.web'));
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
  from: jest.fn(() => { throw new Error('Unexpected remote request'); }),
} }));

const storage = new Map<string, string>();
const getItem = jest.fn((key: string) => storage.get(key) ?? null);
const setItem = jest.fn((key: string, value: string) => { storage.set(key, value); });
const removeItem = jest.fn((key: string) => { storage.delete(key); });
const food = { id: 'new-food', name: 'Meal', calories: 400, date: '2026-01-01' };

beforeEach(() => {
  storage.clear();
  getItem.mockReset().mockImplementation(key => storage.get(key) ?? null);
  setItem.mockClear();
  removeItem.mockClear();
  jest.mocked(supabase.from).mockClear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: { getItem, setItem, removeItem },
  });
});

test('a write rejects malformed stored food JSON instead of replacing pending data', async () => {
  const damaged = '[{"id":"pending-food","synced":0';
  storage.set('formfactor_foods', damaged);
  await expect(localDB.insertFood(food)).rejects.toThrow();
  expect(storage.get('formfactor_foods')).toBe(damaged);
  expect(setItem).not.toHaveBeenCalled();
  expect(removeItem).not.toHaveBeenCalled();
});

const collections = [
  { name: 'foods', read: () => localDB.getAllFoodsWithDeleted(), write: () => localDB.insertFood(food) },
  { name: 'workouts', read: () => localDB.getAllWorkoutsWithDeleted(), write: () => localDB.insertWorkout({
    id: 'new-workout', exercise: 'Squat', sets: 3, date: '2026-01-01',
  }) },
  { name: 'health_metrics', read: () => localDB.getUnsyncedHealthMetrics(), write: () => localDB.insertHealthMetric({
    id: 'new-metric', user_id: 'owner', summary_date: '2026-01-01', steps: 0,
    heart_rate_bpm: null, heart_rate_timestamp: null, weight_kg: null, weight_timestamp: null,
  }) },
  { name: 'nutrition_goals', read: () => localDB.getUnsyncedNutritionGoals(), write: () => localDB.upsertNutritionGoals({
    id: 'new-goals', user_id: 'owner', calories_goal: 2000, protein_goal: 150, carbs_goal: 200, fat_goal: 60,
  }) },
  { name: 'sync_queue', read: () => localDB.getSyncQueue(), write: () => localDB.addToSyncQueue('foods', 'upsert', food.id, food) },
];

describe.each(collections)('$name collection read safety', ({ name, read, write }) => {
  const key = `formfactor_${name}`;

  test.each(['', '[broken', 'null', '{}', '42', '"text"'])('rejects malformed or non-array contents %p without changing storage', async raw => {
    storage.set(key, raw);
    await expect(read()).rejects.toThrow();
    await expect(write()).rejects.toThrow();
    expect(storage.get(key)).toBe(raw);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  test('propagates a storage access error without replacing valid pending work', async () => {
    await write();
    const before = new Map(storage);
    const error = new Error('Storage access denied');
    getItem.mockImplementation(() => { throw error; });
    setItem.mockClear();
    await expect(read()).rejects.toBe(error);
    await expect(write()).rejects.toBe(error);
    expect(storage).toEqual(before);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  test('an absent key and an explicit empty array remain valid empty collections', async () => {
    await expect(read()).resolves.toEqual([]);
    storage.set(key, '[]');
    await expect(read()).resolves.toEqual([]);
    await write();
    await expect(read()).resolves.toHaveLength(1);
  });

  test('public sync reports corruption without claiming completion and can recover after repair', async () => {
    storage.set(key, '[broken');
    const before = new Map(storage);
    const completed = jest.fn();
    const unsubscribe = syncService.onSyncComplete(completed);
    try {
      await syncService.syncToSupabase();
      expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: expect.any(String) });
      expect(completed).not.toHaveBeenCalled();
      expect(storage).toEqual(before);
      expect(setItem).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();

      // Explicit test-fixture repair, not automatic deletion by the service.
      storage.set(key, '[]');
      await syncService.syncToSupabase();
      expect(syncService.getSyncStatus()).toMatchObject({ state: 'idle', lastError: null });
      expect(completed).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});

test('transaction rollback preserves pending rows and unreadable queue bytes', async () => {
  await localDB.insertFood({ ...food, id: 'pending-food' });
  storage.set('formfactor_sync_queue', '[broken');
  const before = new Map(storage);
  await expect(localDB.withTransaction(async () => {
    await localDB.insertFood(food);
    await localDB.addToSyncQueue('foods', 'upsert', food.id, food);
  })).rejects.toThrow();
  expect(storage).toEqual(before);

  storage.set('formfactor_sync_queue', '[]');
  await localDB.withTransaction(async () => {
    await localDB.insertFood(food);
    await localDB.addToSyncQueue('foods', 'upsert', food.id, food);
  });
  expect(await localDB.getAllFoods()).toHaveLength(2);
  expect(await localDB.getSyncQueue()).toHaveLength(1);
});
