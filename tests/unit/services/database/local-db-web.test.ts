/** @jest-environment node */
import { localDB } from '@/lib/services/database/local-db.web';

jest.mock('@/lib/logger', () => ({ errorWithTs: jest.fn(), warnWithTs: jest.fn(), logWithTs: jest.fn() }));
const storage = new Map<string, string>();
const setItem = jest.fn((key: string, value: string) => { storage.set(key, value); });
beforeEach(() => {
  storage.clear();
  setItem.mockClear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem,
    removeItem: (key: string) => storage.delete(key),
  } });
});

test('rolls back queue acknowledgement when a transaction fails', async () => {
  await localDB.addToSyncQueue('foods', 'upsert', 'food-1', { id: 'food-1' });
  const [item] = await localDB.getSyncQueue();
  await expect(localDB.withTransaction(async () => {
    await localDB.removeSyncQueueItem(item.id);
    throw new Error('Failed to save sync status');
  })).rejects.toThrow('Failed to save sync status');
  expect(await localDB.getSyncQueue()).toEqual([item]);
});

test('surfaces storage failures instead of reporting a successful save', async () => {
  setItem.mockImplementationOnce(() => { throw new Error('Storage full'); });
  await expect(localDB.addToSyncQueue('foods', 'upsert', 'food-1', {})).rejects.toThrow('Storage full');
  expect(await localDB.getSyncQueue()).toEqual([]);
});
