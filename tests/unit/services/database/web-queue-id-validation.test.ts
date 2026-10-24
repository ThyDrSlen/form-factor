/** @jest-environment node */
import { localDB } from '@/lib/services/database/local-db.web';
import { syncService } from '@/lib/services/database/sync-service';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));
jest.mock('@/lib/services/database/local-db', () => jest.requireActual('@/lib/services/database/local-db.web'));
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
  from: jest.fn(() => { throw new Error('Unexpected remote request'); }),
} }));

const queueKey = 'formfactor_sync_queue';
test.each([null, '0', '20', '60'])('preserves legacy rows with valid prior sequence %p', async sequence => {
  await localDB.addToSyncQueue('foods', 'upsert', 'food', { name: 'pending' });
  const [pending] = await localDB.getSyncQueue();
  const legacy = { ...pending, id: 42, retry_count: 3 };
  storage.set(queueKey, JSON.stringify([legacy]));
  if (sequence === null) storage.delete(sequenceKey);
  else storage.set(sequenceKey, sequence);
  await localDB.addToSyncQueue('workouts', 'upsert', 'workout');
  const queue = await localDB.getSyncQueue();
  expect(queue).toContainEqual(legacy);
  const added = queue.find(item => item.record_id === 'workout')!;
  expect(added.id).toBe(Math.max(legacy.id, Number(sequence)) + 1);
  expect(Number.isSafeInteger(added.id)).toBe(true);
});

test('failed queue save consumes its reserved ID without replacing pending work', async () => {
  await localDB.addToSyncQueue('foods', 'upsert', 'food', { name: 'pending' });
  const queueBefore = storage.get(queueKey);
  const failure = new Error('Storage full');
  setItem.mockImplementation((key, value) => {
    if (key === queueKey) throw failure;
    storage.set(key, value);
  });
  await expect(localDB.addToSyncQueue('foods', 'delete', 'food')).rejects.toBe(failure);
  expect(storage.get(queueKey)).toBe(queueBefore);
  const reserved = Number(storage.get(sequenceKey));
  setItem.mockImplementation((key, value) => { storage.set(key, value); });
  await localDB.addToSyncQueue('foods', 'delete', 'food');
  const [replacement] = await localDB.getSyncQueue();
  expect(replacement.id).toBeGreaterThan(reserved);
  await localDB.removeSyncQueueItem(reserved);
  expect(await localDB.getSyncQueue()).toEqual([replacement]);
});

test.each(['read', 'write'])('sequence %s failure leaves queue and counter intact', async operation => {
  await localDB.addToSyncQueue('foods', 'upsert', 'food');
  const before = new Map(storage);
  const failure = new Error('Storage denied');
  if (operation === 'read') getItem.mockImplementation(key => {
    if (key === sequenceKey) throw failure;
    return storage.get(key) ?? null;
  });
  else setItem.mockImplementation((key, value) => {
    if (key === sequenceKey) throw failure;
    storage.set(key, value);
  });
  await expect(localDB.addToSyncQueue('foods', 'delete', 'food')).rejects.toBe(failure);
  expect(storage).toEqual(before);
});

test('sync reports ambiguous queue identities without upload or acknowledgement', async () => {
  await localDB.insertFood({ id: 'food', name: 'pending', calories: 100, date: '2026-10-04' });
  await localDB.addToSyncQueue('foods', 'upsert', 'food', { user_id: 'owner' });
  const [pending] = await localDB.getSyncQueue();
  storage.set(queueKey, JSON.stringify([pending, { ...pending, record_id: 'other-food' }]));
  const before = new Map(storage);
  const completed = jest.fn();
  const unsubscribe = syncService.onSyncComplete(completed);
  try {
    await syncService.syncToSupabase();
    expect(syncService.getSyncStatus()).toMatchObject({
      state: 'error', lastError: expect.stringContaining('sync queue identity'),
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    expect(storage).toEqual(before);
  } finally {
    unsubscribe();
  }
});

const sequenceKey = `${queueKey}_sequence`;
const storage = new Map<string, string>();
const setItem = jest.fn((key: string, value: string) => { storage.set(key, value); });
const getItem = jest.fn((key: string) => storage.get(key) ?? null);
let previousStorage: PropertyDescriptor | undefined;

beforeEach(() => {
  storage.clear();
  jest.mocked(supabase.from).mockClear();
  setItem.mockReset().mockImplementation((key, value) => { storage.set(key, value); });
  getItem.mockReset().mockImplementation(key => storage.get(key) ?? null);
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem, setItem, removeItem: (key: string) => { storage.delete(key); },
  } });
});

afterEach(() => {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('corrupted sequence rejects replacement without destroying the previous retry', async () => {
  await localDB.addToSyncQueue('foods', 'upsert', 'food', { name: 'pending' });
  storage.set(sequenceKey, 'NaN');
  const before = new Map(storage);
  setItem.mockClear();
  await expect(localDB.addToSyncQueue('foods', 'delete', 'food')).rejects.toThrow();
  expect(storage).toEqual(before);
  expect(setItem).not.toHaveBeenCalled();
});

test.each(['', ' ', 'Infinity', '-1', '1.5', 'garbage', '0x10', '1e3', '01', '9007199254740992'])(
  'rejects invalid persisted sequence %p before any write', async sequence => {
    await localDB.addToSyncQueue('foods', 'upsert', 'food');
    storage.set(sequenceKey, sequence);
    const before = new Map(storage);
    setItem.mockClear();
    await expect(localDB.addToSyncQueue('workouts', 'upsert', 'workout')).rejects.toThrow();
    expect(storage).toEqual(before);
    expect(setItem).not.toHaveBeenCalled();
  },
);

test.each(['sequence', 'legacy-row'] as const)('rejects exhausted IDs from %s without reusing an identity', async source => {
  await localDB.addToSyncQueue('foods', 'upsert', 'food');
  const [pending] = await localDB.getSyncQueue();
  if (source === 'sequence') storage.set(sequenceKey, String(Number.MAX_SAFE_INTEGER));
  else {
    storage.delete(sequenceKey);
    storage.set(queueKey, JSON.stringify([{ ...pending, id: Number.MAX_SAFE_INTEGER }]));
  }
  const before = new Map(storage);
  setItem.mockClear();
  await expect(localDB.addToSyncQueue('foods', 'delete', 'food')).rejects.toThrow();
  expect(storage).toEqual(before);
  expect(setItem).not.toHaveBeenCalled();
});

describe.each([
  { name: 'enumerate', run: () => localDB.getSyncQueue() },
  { name: 'count', run: () => localDB.countSyncQueueItems() },
  { name: 'enqueue', run: () => localDB.addToSyncQueue('foods', 'delete', 'food') },
  { name: 'acknowledge', run: () => localDB.removeSyncQueueItem(1) },
  { name: 'retry', run: () => localDB.incrementSyncQueueRetry(1, '2026-10-05T00:00:00Z') },
])('$name rejects untrustworthy stored queue identities', ({ run }) => {
  test.each([null, undefined, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, 'duplicate'])(
    'preserves exact queue bytes for invalid ID %p', async badId => {
      await localDB.addToSyncQueue('foods', 'upsert', 'food', { name: 'pending' });
      const [pending] = await localDB.getSyncQueue();
      storage.set(queueKey, JSON.stringify([
        pending,
        { ...pending, id: badId === 'duplicate' ? pending.id : badId, record_id: 'other-food' },
      ]));
      const before = new Map(storage);
      setItem.mockClear();
      await expect(run()).rejects.toThrow();
      expect(storage).toEqual(before);
      expect(setItem).not.toHaveBeenCalled();
    },
  );
});
