/** @jest-environment node */
import { localDB } from '@/lib/services/database/local-db.web';
import { logWithTs } from '@/lib/logger';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

const storage = new Map<string, string>();
const collections = ['foods', 'workouts', 'health_metrics', 'nutrition_goals', 'sync_queue'] as const;
let previousStorage: PropertyDescriptor | undefined;
const removeItem = jest.fn((key: string) => { storage.delete(key); });
const getItem = jest.fn((key: string) => storage.get(key) ?? null);
const food = (id: string) => ({ id, name: 'Meal', calories: 100, date: '2026-10-04' });

beforeEach(() => {
  storage.clear();
  jest.clearAllMocks();
  removeItem.mockReset().mockImplementation(key => { storage.delete(key); });
  getItem.mockReset().mockImplementation(key => storage.get(key) ?? null);
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem,
  } });
});
afterEach(() => {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

async function seed() {
  await localDB.insertFood(food('a-food'));
  await localDB.insertWorkout({ id: 'a-workout', exercise: 'Squat', sets: 3, date: '2026-10-04' });
  await localDB.insertHealthMetric({
    id: 'a-health', user_id: 'a', summary_date: '2026-10-04', steps: 100,
    heart_rate_bpm: null, heart_rate_timestamp: null, weight_kg: null, weight_timestamp: null,
  });
  await localDB.upsertNutritionGoals({
    id: 'a-goals', user_id: 'a', calories_goal: 2200, protein_goal: 150, carbs_goal: 250, fat_goal: 65,
  });
  await localDB.addToSyncQueue('foods', 'upsert', 'a-food', food('a-food'));
}

function expectCleared() {
  for (const name of collections) expect(storage.has(`formfactor_${name}`)).toBe(false);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('account cleanup removes every data collection including nutrition goals, not unrelated settings or queue identity', async () => {
  await seed();
  const sequence = storage.get('formfactor_sync_queue_sequence');
  storage.set('unrelated-setting', 'keep');
  await localDB.clearAllData();
  expect(await localDB.getNutritionGoals('a')).toBeNull();
  expect(await localDB.getUnsyncedNutritionGoals()).toEqual([]);
  expectCleared();
  expect(storage.get('formfactor_sync_queue_sequence')).toBe(sequence);
  expect(storage.get('unrelated-setting')).toBe('keep');
});

test('a failed transaction already in flight cannot restore account data after cleanup', async () => {
  await seed();
  const entered = deferred();
  const release = deferred();
  const failure = new Error('in-flight transaction failed');
  const transaction = localDB.withTransaction(async () => {
    await localDB.insertFood(food('a-late'));
    entered.resolve();
    await release.promise;
    throw failure;
  });
  await entered.promise;
  const clearing = localDB.clearAllData();
  const outcomes = Promise.allSettled([transaction, clearing]);
  // Let cleanup reach its boundary without waiting for it to complete; a
  // correctly queued cleanup cannot finish before the first transaction.
  await Promise.resolve();
  release.resolve();
  expect(await outcomes).toEqual([
    { status: 'rejected', reason: failure },
    { status: 'fulfilled', value: undefined },
  ]);
  expectCleared();
});

test('a failed collection removal restores the complete snapshot and does not log success', async () => {
  await seed();
  const before = new Map(storage);
  const failure = new Error('storage removal denied');
  removeItem.mockImplementation(key => {
    if (key === 'formfactor_health_metrics') throw failure;
    storage.delete(key);
  });
  await expect(localDB.clearAllData()).rejects.toBe(failure);
  expect(storage).toEqual(before);
  expect(logWithTs).not.toHaveBeenCalledWith('[LocalDB-Web] All data cleared');

  removeItem.mockImplementation(key => { storage.delete(key); });
  await localDB.clearAllData();
  expectCleared();
});

test.each(['remove', 'clear-queue', 'clear-all'] as const)('%s preserves legacy queue identities before removing the last row', async mode => {
  await seed();
  const [old] = await localDB.getSyncQueue();
  storage.set('formfactor_sync_queue', JSON.stringify([{ ...old, id: 42 }]));
  storage.delete('formfactor_sync_queue_sequence');
  if (mode === 'remove') await localDB.removeSyncQueueItem(42);
  else if (mode === 'clear-queue') await localDB.clearSyncQueue();
  else await localDB.clearAllData();
  const Database = localDB.constructor as new () => typeof localDB;
  const restarted = new Database();
  await restarted.addToSyncQueue('foods', 'upsert', 'new-food', food('new-food'));
  const [next] = await restarted.getSyncQueue();
  expect(next.id).toBeGreaterThan(42);
  await restarted.removeSyncQueueItem(42);
  await restarted.incrementSyncQueueRetry(42, '2030-01-01');
  expect(await restarted.getSyncQueue()).toEqual([next]);
});

test('cleanup waits for prior successful writes and does not erase the following transaction', async () => {
  await seed();
  const [old] = await localDB.getSyncQueue();
  const entered = deferred();
  const release = deferred();
  const first = localDB.withTransaction(async () => {
    entered.resolve();
    await release.promise;
    await localDB.insertFood(food('a-late'));
    await localDB.addToSyncQueue('foods', 'upsert', 'a-late');
  });
  await entered.promise;
  const clearing = localDB.clearAllData();
  const following = localDB.withTransaction(async () => {
    await localDB.insertFood(food('b-food'));
    await localDB.addToSyncQueue('foods', 'upsert', 'b-food');
  });
  const all = Promise.all([first, clearing, following]);
  release.resolve();
  await all;
  expect((await localDB.getAllFoods()).map(row => row.id)).toEqual(['b-food']);
  expect(await localDB.getNutritionGoals('a')).toBeNull();
  const [next] = await localDB.getSyncQueue();
  expect(next.record_id).toBe('b-food');
  expect(next.id).toBeGreaterThan(old.id);
  await localDB.removeSyncQueueItem(old.id);
  expect(await localDB.getSyncQueue()).toEqual([next]);
});

test('failed snapshot read leaves all stored bytes untouched and rejects cleanup', async () => {
  await seed();
  const before = new Map(storage);
  const failure = new Error('snapshot read denied');
  getItem.mockImplementation(key => {
    if (key === 'formfactor_nutrition_goals') throw failure;
    return storage.get(key) ?? null;
  });
  await expect(localDB.clearAllData()).rejects.toBe(failure);
  expect(storage).toEqual(before);
  expect(removeItem).not.toHaveBeenCalled();
  expect(logWithTs).not.toHaveBeenCalledWith('[LocalDB-Web] All data cleared');
});

test.each(['remove', 'clear-queue', 'clear-all'] as const)('%s rejects a damaged queue counter without removing data', async mode => {
  await seed();
  storage.set('formfactor_sync_queue_sequence', 'corrupt');
  const before = new Map(storage);
  const operation = mode === 'remove' ? localDB.removeSyncQueueItem(1)
    : mode === 'clear-queue' ? localDB.clearSyncQueue() : localDB.clearAllData();
  await expect(operation).rejects.toThrow('Invalid stored sync queue sequence');
  expect(storage).toEqual(before);
  expect(logWithTs).not.toHaveBeenCalledWith('[LocalDB-Web] All data cleared');
});

test('cleanup checkpoints a legacy queue before deletion and aborts if the counter cannot persist', async () => {
  await seed();
  storage.delete('formfactor_sync_queue_sequence');
  const before = new Map(storage);
  const failure = new Error('counter write denied');
  const spy = jest.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === 'formfactor_sync_queue_sequence') throw failure;
    storage.set(key, value);
  });
  try {
    await expect(localDB.clearAllData()).rejects.toBe(failure);
    expect(storage).toEqual(before);
    expect(removeItem).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test('failed cleanup restores raw collection bytes rather than parsing or replacing corruption', async () => {
  await seed();
  storage.set('formfactor_foods', '[malformed');
  const before = new Map(storage);
  const failure = new Error('remove failed');
  removeItem.mockImplementation(key => {
    if (key === 'formfactor_sync_queue') throw failure;
    storage.delete(key);
  });
  await expect(localDB.clearAllData()).rejects.toBe(failure);
  expect(storage).toEqual(before);
});
