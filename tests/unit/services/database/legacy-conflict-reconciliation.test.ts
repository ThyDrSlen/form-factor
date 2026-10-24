/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB as nativeDB } from '@/lib/services/database/local-db';
import { localDB as webDB } from '@/lib/services/database/local-db.web';
import { syncService } from '@/lib/services/database/sync-service';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));
const mockWrites: { table: string; operation: string; data: Record<string, unknown>[] | undefined }[] = [];
let mockBeforeSelect: (() => Promise<void>) | undefined;
let mockBeforePrepare: (() => Promise<void>) | undefined;
let mockRemote: Record<string, unknown> | null = null;
let mockBeforeWrite: (() => Promise<void>) | undefined;
let mockError: { message: string } | null = null;
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
  from: (table: string) => {
    let operation = 'select';
    let columns = '*';
    let data: Record<string, unknown>[] | undefined;
    const builder = {
      select: (value: string) => { columns = value; return builder; }, eq: () => builder, single: () => builder,
      upsert: (value: Record<string, unknown>[]) => { operation = 'upsert'; data = value; return builder; },
      delete: () => { operation = 'delete'; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
        if (operation !== 'select') {
          mockWrites.push({ table, operation, data });
          await mockBeforeWrite?.();
        }
        if (operation === 'select') await mockBeforeSelect?.();
        const remote = columns === '*' ? mockRemote : mockRemote && { updated_at: mockRemote.updated_at };
        return { data: operation === 'select' ? remote : null, error: operation === 'select' ? null : mockError };
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
      await mockBeforePrepare?.();
      return { executeAsync: async (args: (string | number | null)[]) => statement.run(...args), finalizeAsync: async () => undefined };
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
  mockRemote = null;
  mockBeforeSelect = undefined;
  mockBeforePrepare = undefined;
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

const later = '2026-01-01T13:00:00.000Z';
describe.each(['native', 'web'])('%s legacy conflict reconciliation', backend => {
  describe.each(['direct', 'queued'])('%s path', path => {
    describe.each(['edit', 'delete', 'remove'])('%s during server lookup', mutation => {
      test.each(['foods', 'workouts'] as const)('%s retains concurrent local intent', async table => {
        useBackend(backend);
        const original = await seed(table);
        if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
        const queue = await nativeDB.getSyncQueue();
        mockRemote = { ...original, user_id: 'owner', updated_at: later };
        let changed: Awaited<ReturnType<typeof read>> = null;
        mockBeforeSelect = async () => {
          if (mutation === 'edit') await edit(table);
          else if (mutation === 'delete') {
            if (table === 'foods') await nativeDB.updateFood('record', { deleted: 1, updated_at: revision, synced: 0 });
            else await nativeDB.updateWorkout('record', { deleted: 1, updated_at: revision, synced: 0 });
          } else if (table === 'foods') await nativeDB.hardDeleteFood('record');
          else await nativeDB.hardDeleteWorkout('record');
          changed = await read(table);
        };
        await syncService.syncToSupabase();
        expect(mockWrites).toEqual([]);
        expect(await read(table)).toEqual(changed);
        expect(await nativeDB.getSyncQueue()).toEqual(queue);
      });
    });

    describe.each(['absent', 'older', 'equal'])('%s server revision', server => {
      test.each(['foods', 'workouts'] as const)('%s uploads and acknowledges the current local snapshot', async table => {
        useBackend(backend);
        const original = await seed(table);
        if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', { ...original, date: 'stale queued content' });
        mockRemote = server === 'absent' ? null : {
          ...original, user_id: 'owner', updated_at: server === 'older' ? '2025-01-01T00:00:00.000Z' : revision,
        };
        await syncService.syncToSupabase();
        const { synced, deleted, ...content } = original;
        expect(mockWrites).toEqual([{ table, operation: 'upsert', data: [{ ...content, user_id: 'owner' }] }]);
        expect(await read(table)).toEqual({ ...original, synced: 1 });
        expect(await nativeDB.getSyncQueue()).toEqual([]);
      });
    });

    test.each(['foods', 'workouts'] as const)('%s does not acknowledge uploads after invalidation', async table => {
      useBackend(backend);
      const original = await seed(table);
      if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
      const queue = await nativeDB.getSyncQueue();
      mockBeforeWrite = async () => { await syncService.cleanupRealtimeSync(); };
      await syncService.syncToSupabase();
      expect(mockWrites).toHaveLength(1);
      expect(await read(table)).toEqual(original);
      expect(await nativeDB.getSyncQueue()).toEqual(queue);
    });

    test.each(['foods', 'workouts'] as const)('%s clears nullable server fields and derives a missing date from created_at', async table => {
      useBackend(backend);
      const original = await seed(table);
      if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
      mockRemote = {
        ...original, user_id: 'owner', updated_at: later, date: null, created_at: '2025-12-30T00:00:00.000Z',
        ...(table === 'foods' ? { protein: null, carbs: null, fat: null } : { reps: null, weight: null, duration: null }),
      };
      await syncService.syncToSupabase();
      expect(mockWrites).toEqual([]);
      const result = await read(table);
      expect(result).toMatchObject({ id: original.id, date: mockRemote.created_at, updated_at: later, synced: 1 });
      for (const field of table === 'foods' ? ['protein', 'carbs', 'fat'] : ['reps', 'weight', 'duration']) {
        expect(Reflect.get(result!, field) ?? null).toBeNull();
      }
      expect(await nativeDB.getSyncQueue()).toEqual([]);
    });

    test.each(['foods', 'workouts'] as const)('%s rejects a foreign server winner without losing local work', async table => {
      useBackend(backend);
      const original = await seed(table);
      if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
      mockRemote = { ...original, user_id: 'another-owner', updated_at: later };
      await syncService.syncToSupabase();
      expect(mockWrites).toEqual([]);
      expect(await read(table)).toEqual(original);
      expect(await nativeDB.getSyncQueue()).toHaveLength(1);
      expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: `${table} server ownership/key mismatch` });
    });

    test.each(['foods', 'workouts'] as const)('%s discards a server winner after auth lifetime invalidation', async table => {
      useBackend(backend);
      const original = await seed(table);
      if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
      const queue = await nativeDB.getSyncQueue();
      mockRemote = { ...original, user_id: 'owner', updated_at: later };
      mockBeforeSelect = async () => { await syncService.cleanupRealtimeSync(); await syncService.cleanupRealtimeSync(); };
      await syncService.syncToSupabase();
      expect(mockWrites).toEqual([]);
      expect(await read(table)).toEqual(original);
      expect(await nativeDB.getSyncQueue()).toEqual(queue);
    });

    test.each(['foods', 'workouts'] as const)('%s rejects a server winner with a different record ID', async table => {
      useBackend(backend);
      const original = await seed(table);
      if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
      mockRemote = { ...original, id: 'another-record', user_id: 'owner', updated_at: later };
      await syncService.syncToSupabase();
      expect(mockWrites).toEqual([]);
      expect(await read(table)).toEqual(original);
      expect(await nativeDB.getSyncQueue()).toHaveLength(1);
      expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: `${table} server ownership/key mismatch` });
    });

    test.each(['foods', 'workouts'] as const)('%s copies winning server content and revision', async table => {
      useBackend(backend);
      const original = await seed(table);
      if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
      const winner = {
        ...original,
        ...(table === 'foods' ? { name: 'New meal', calories: 0, protein: 0, carbs: 30, fat: 5 }
          : { exercise: 'Deadlift', sets: 5, reps: 0, weight: 125, duration: 30 }),
        date: '2026-01-02', updated_at: later,
      };
      mockRemote = { ...winner, user_id: 'owner', created_at: revision };
      await syncService.syncToSupabase();
      expect(mockWrites).toEqual([]);
      expect(await read(table)).toEqual({ ...winner, synced: 1 });
      expect(await nativeDB.getSyncQueue()).toEqual([]);
    });
  });
});

describe.each(['direct', 'queued'])('native %s prepared reconciliation lifetime', path => {
  test.each(['foods', 'workouts'] as const)('%s checks the captured service generation after preparing SQL', async table => {
    const original = await seed(table);
    if (path === 'queued') await nativeDB.addToSyncQueue(table, 'upsert', 'record', original);
    const queue = await nativeDB.getSyncQueue();
    mockRemote = { ...original, user_id: 'owner', updated_at: later };
    const prepare = jest.fn(async () => { await syncService.cleanupRealtimeSync(); });
    mockBeforePrepare = prepare;
    await syncService.syncToSupabase();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(mockWrites).toEqual([]);
    expect(await read(table)).toEqual(original);
    expect(await nativeDB.getSyncQueue()).toEqual(queue);
  });
});
