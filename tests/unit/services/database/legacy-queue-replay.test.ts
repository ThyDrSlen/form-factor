/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB as nativeDB } from '@/lib/services/database/local-db';
import { localDB as webDB } from '@/lib/services/database/local-db.web';
import { syncService } from '@/lib/services/database/sync-service';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));
const mockWrites: { table: string; operation: string; data: Record<string, unknown>[] | undefined }[] = [];
let mockBeforeWrite: (() => Promise<void>) | undefined;
let mockError: { message: string } | null = null;
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
  from: (table: string) => {
    let operation = 'select';
    let data: Record<string, unknown>[] | undefined;
    const builder = {
      select: () => builder, eq: () => builder, single: () => builder,
      upsert: (value: Record<string, unknown>[]) => { operation = 'upsert'; data = value; return builder; },
      delete: () => { operation = 'delete'; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
        if (operation !== 'select') {
          mockWrites.push({ table, operation, data });
          await mockBeforeWrite?.();
        }
        return { data: null, error: operation === 'select' ? null : mockError };
      })().then(resolve, reject),
    };
    return builder;
  },
} }));

const revision = '2026-01-01T12:00:00.000Z';
let sqlite: DatabaseSync;
let previousDB: typeof nativeDB.db;
let previousStorage: PropertyDescriptor | undefined;
const originalMethods = new Map<string, PropertyDescriptor | undefined>();
beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  previousDB = nativeDB.db;
  Object.assign(nativeDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    prepareAsync: async (sql: string) => {
      const statement = sqlite.prepare(sql);
      return {
        executeAsync: async (args: (string | number | null)[] = []) => statement.run(...args),
        finalizeAsync: async () => undefined,
      };
    },
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
    withTransactionAsync: async (task: () => Promise<void>) => {
      sqlite.exec('BEGIN');
      try { await task(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } });
  await (nativeDB as unknown as { createTables(): Promise<void> }).createTables();
  const storage = new Map<string, string>();
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
  mockWrites.length = 0;
  mockBeforeWrite = undefined;
  mockError = null;
});
afterEach(async () => {
  await syncService.cleanupRealtimeSync();
  for (const [key, descriptor] of originalMethods) {
    if (descriptor) Object.defineProperty(nativeDB, key, descriptor);
    else Reflect.deleteProperty(nativeDB, key);
  }
  originalMethods.clear();
  nativeDB.db = previousDB;
  sqlite.close();
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

// Exercise the public coordinator against each real adapter, not fabricated SQL results.
function useBackend(backend: string): void {
  if (backend === 'native') return;
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(webDB))) {
    if (key === 'constructor') continue;
    const method = Reflect.get(webDB, key);
    if (typeof method !== 'function') continue;
    originalMethods.set(key, Object.getOwnPropertyDescriptor(nativeDB, key));
    Object.defineProperty(nativeDB, key, { configurable: true, value: method.bind(webDB) });
  }
  originalMethods.set('supportsWorkoutSync', Object.getOwnPropertyDescriptor(nativeDB, 'supportsWorkoutSync'));
  Object.defineProperty(nativeDB, 'supportsWorkoutSync', { configurable: true, value: false });
}
async function seed(table: 'foods' | 'workouts') {
  if (table === 'foods') {
    await nativeDB.insertFood({ id: 'record', name: 'Oats', calories: 100, date: revision });
    await nativeDB.updateFood('record', { updated_at: revision });
    return (await nativeDB.getFoodById('record'))!;
  }
  await nativeDB.insertWorkout({ id: 'record', exercise: 'Squat', sets: 3, reps: 10, date: revision });
  await nativeDB.updateWorkout('record', { updated_at: revision });
  return (await nativeDB.getWorkoutById('record'))!;
}
async function edit(table: 'foods' | 'workouts') {
  if (table === 'foods') await nativeDB.updateFood('record', { calories: 200, updated_at: revision, synced: 0 });
  else await nativeDB.updateWorkout('record', { reps: 20, updated_at: revision, synced: 0 });
}
const read = (table: 'foods' | 'workouts') => table === 'foods'
  ? nativeDB.getFoodById('record') : nativeDB.getWorkoutById('record');

describe.each(['native', 'web'])('%s legacy queued replay', backend => {
  test.each(['foods', 'workouts'] as const)('%s retains orphaned retry evidence instead of recreating a missing row', async table => {
    useBackend(backend);
    await nativeDB.addToSyncQueue(table, 'upsert', 'record', { id: 'record', updated_at: revision });
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read(table)).toBeNull();
    expect(await nativeDB.getSyncQueue()).toEqual([
      expect.objectContaining({ table_name: table, record_id: 'record', retry_count: 1 }),
    ]);
    expect(syncService.getSyncStatus().state).toBe('error');
  });

  test.each(['foods', 'workouts'] as const)('%s preserves content and retry metadata after a remote error', async table => {
    useBackend(backend);
    const original = await seed(table);
    await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
    const [queued] = await nativeDB.getSyncQueue();
    mockError = { message: 'Service unavailable' };
    await syncService.syncToSupabase();
    expect(mockWrites).toHaveLength(1);
    expect(await read(table)).toEqual(original);
    expect(await nativeDB.getSyncQueue()).toEqual([
      expect.objectContaining({ ...queued, retry_count: 1, next_retry_at: expect.any(String) }),
    ]);
    expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: 'Service unavailable' });
  });

  test.each(['foods', 'workouts'] as const)('%s cannot remove a replacement retry created during upload', async table => {
    useBackend(backend);
    const original = await seed(table);
    await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
    const [oldRetry] = await nativeDB.getSyncQueue();
    let replacement: Awaited<ReturnType<typeof nativeDB.getSyncQueue>>;
    mockBeforeWrite = async () => {
      await edit(table);
      await nativeDB.addToSyncQueue(table, 'upsert', 'record', await read(table));
      replacement = await nativeDB.getSyncQueue();
    };
    await syncService.syncToSupabase();
    expect(mockWrites).toHaveLength(1);
    expect((await read(table))?.synced).toBe(0);
    expect(replacement![0].id).not.toBe(oldRetry.id);
    expect(await nativeDB.getSyncQueue()).toEqual(replacement!);
  });

  test.each(['foods', 'workouts'] as const)('%s retains data and retry when queued ownership conflicts', async table => {
    useBackend(backend);
    const original = await seed(table);
    await nativeDB.addToSyncQueue(table, 'upsert', 'record', { ...original, user_id: 'other-owner' });
    const [queued] = await nativeDB.getSyncQueue();
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read(table)).toEqual(original);
    const [retained] = await nativeDB.getSyncQueue();
    expect(retained).toMatchObject({ ...queued, retry_count: 1, next_retry_at: expect.any(String) });
    expect(syncService.getSyncStatus().state).toBe('error');
  });

  test.each(['foods', 'workouts'] as const)('%s retires an already-acknowledged retry without replaying it', async table => {
    useBackend(backend);
    const original = await seed(table);
    await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
    if (table === 'foods') await nativeDB.updateFoodSyncStatus('record', true);
    else await nativeDB.updateWorkoutSyncStatus('record', true);
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read(table)).toEqual({ ...original, synced: 1 });
    expect(await nativeDB.getSyncQueue()).toEqual([]);
  });

  describe.each(['edit', 'delete', 'restore'])('%s during the request', change => {
    test.each(['foods', 'workouts'] as const)('%s retains the newer row and its retry', async table => {
      useBackend(backend);
      await seed(table);
      if (change === 'restore') {
        if (table === 'foods') await nativeDB.updateFood('record', { deleted: 1, updated_at: revision });
        else await nativeDB.updateWorkout('record', { deleted: 1, updated_at: revision });
      }
      await nativeDB.addToSyncQueue(table, change === 'restore' ? 'delete' : 'upsert', 'record', await read(table));
      const queue = await nativeDB.getSyncQueue();
      let edited: Awaited<ReturnType<typeof read>>;
      mockBeforeWrite = async () => {
        if (change === 'edit') await edit(table);
        else {
          const patch = { deleted: change === 'delete' ? 1 : 0, updated_at: revision, synced: 0 };
          if (table === 'foods') await nativeDB.updateFood('record', patch);
          else await nativeDB.updateWorkout('record', patch);
        }
        edited = await read(table);
      };
      await syncService.syncToSupabase();
      expect(mockWrites).toHaveLength(1);
      expect(await read(table)).toEqual(edited!);
      expect(await nativeDB.getSyncQueue()).toEqual(queue);
      mockBeforeWrite = undefined;
      await syncService.syncToSupabase();
      expect(mockWrites).toHaveLength(2);
      expect(mockWrites[1].operation).toBe(change === 'delete' ? 'delete' : 'upsert');
      expect(await read(table)).toEqual(change === 'delete' ? null : { ...edited!, synced: 1 });
      expect(await nativeDB.getSyncQueue()).toEqual([]);
    });
  });

  test.each(['foods', 'workouts'] as const)('%s retries persisted content, not its stale queued snapshot', async table => {
    useBackend(backend);
    const original = await seed(table);
    await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
    await edit(table);
    const current = (await read(table))!;
    await syncService.syncToSupabase();
    const { deleted, synced, ...content } = current;
    expect(mockWrites).toEqual([{ table, operation: 'upsert', data: [{ ...content, user_id: 'owner' }] }]);
    expect(await read(table)).toEqual({ ...current, synced: 1 });
    expect(await nativeDB.getSyncQueue()).toEqual([]);
  });
});
