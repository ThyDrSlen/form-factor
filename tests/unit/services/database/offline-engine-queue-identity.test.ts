/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB as nativeDB } from '@/lib/services/database/local-db';
import { localDB as webDB } from '@/lib/services/database/local-db.web';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

const capturedAt = '2026-10-01T10:00:00.000Z';
const storage = new Map<string, string>();
let sqlite: DatabaseSync;
let previousDB: typeof nativeDB.db;
let previousStorage: PropertyDescriptor | undefined;

beforeEach(async () => {
  jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(capturedAt);
  sqlite = new DatabaseSync(':memory:');
  previousDB = nativeDB.db;
  const execAsync = async (sql: string) => { sqlite.exec(sql); };
  Object.assign(nativeDB, { db: {
    execAsync,
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
    withTransactionAsync: async (task: () => Promise<void>) => {
      try {
        await execAsync('BEGIN');
        await task();
        await execAsync('COMMIT');
      } catch (error) {
        await execAsync('ROLLBACK');
        throw error;
      }
    },
  } });
  await (nativeDB as unknown as { createTables(): Promise<void> }).createTables();
  storage.clear();
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
});

afterEach(() => {
  nativeDB.db = previousDB;
  sqlite.close();
  jest.restoreAllMocks();
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('web adopts existing queue IDs without replacing legacy queued content', async () => {
  const legacy = {
    id: 42, table_name: 'foods', operation: 'upsert', record_id: 'legacy-food',
    data: '{"name":"legacy"}', created_at: capturedAt, retry_count: 3, next_retry_at: capturedAt,
  };
  storage.set('formfactor_sync_queue', JSON.stringify([legacy]));
  await webDB.addToSyncQueue('workouts', 'delete', 'new-workout');
  const queue = await webDB.getSyncQueue();
  expect(queue).toHaveLength(2);
  expect(queue[0]).toEqual(legacy);
  expect(queue[1].id).toBeGreaterThan(legacy.id);
});

describe.each([['native', nativeDB], ['web', webDB]] as const)('%s queue acknowledgement identity', (platform, db) => {
  test.each(['replace', 'remove', 'clear'] as const)('stale acknowledgement retains newer same-timestamp work after %s', async mode => {
    await db.addToSyncQueue('foods', 'upsert', 'food-1', { name: 'submitted' });
    const [submitted] = await db.getSyncQueue();
    if (mode === 'remove') await db.removeSyncQueueItem(submitted.id);
    if (mode === 'clear') await db.clearSyncQueue();

    // A new web service instance must use the durable sequence, not a counter
    // held only by the uploader whose request is still in flight.
    const WebDatabase = webDB.constructor as new () => typeof webDB;
    const writer = platform === 'web' ? new WebDatabase() : nativeDB;
    await writer.addToSyncQueue('foods', 'upsert', 'food-1', { name: 'edited' });
    const [edited] = await db.getSyncQueue();
    expect(edited.created_at).toBe(submitted.created_at);

    await db.incrementSyncQueueRetry(submitted.id, '2026-10-02T10:00:00.000Z');
    await db.removeSyncQueueItem(submitted.id);

    expect(await db.getSyncQueue()).toEqual([edited]);
    expect(edited.id).toBeGreaterThan(submitted.id);
    expect(edited.retry_count).toBe(0);
    expect(edited.data).toBe(JSON.stringify({ name: 'edited' }));
  });
});
