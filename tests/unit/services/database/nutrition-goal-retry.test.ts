/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB, type LocalNutritionGoals } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';

const { localDB: webDB } = jest.requireActual<typeof import('@/lib/services/database/local-db.web')>(
  '@/lib/services/database/local-db.web',
);
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));
const mockWrites: Record<string, unknown>[][] = [];
const mockLookups: { columns: string; filters: [string, unknown][] }[] = [];
let mockBeforeWrite: (() => Promise<void>) | undefined;
let mockBeforeSelect: (() => Promise<void>) | undefined;
let mockBeforePrepare: (() => Promise<void>) | undefined;
let mockRemote: Partial<LocalNutritionGoals> | null = null;
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
  from: () => {
    let payload: Record<string, unknown>[] | undefined;
    let columns = '*';
    const filters: [string, unknown][] = [];
    const builder = {
      select: (value: string) => { columns = value; return builder; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      single: () => builder,
      upsert: (value: Record<string, unknown>[]) => { payload = value; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
        if (payload) { mockWrites.push(payload); await mockBeforeWrite?.(); }
        else { mockLookups.push({ columns, filters }); await mockBeforeSelect?.(); }
        return { data: payload ? null : mockRemote, error: null };
      })().then(resolve, reject),
    };
    return builder;
  },
} }));

const revision = '2026-01-01T12:00:00.000Z';
const later = '2026-01-01T13:00:00.000Z';
let sqlite: DatabaseSync;
let previousDB: typeof localDB.db;
let previousStorage: PropertyDescriptor | undefined;
const originalMethods = new Map<string, PropertyDescriptor | undefined>();
beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(revision));
  sqlite = new DatabaseSync(':memory:');
  previousDB = localDB.db;
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    prepareAsync: async (sql: string) => {
      const statement = sqlite.prepare(sql);
      await mockBeforePrepare?.();
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
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  const storage = new Map<string, string>();
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
  mockWrites.length = 0;
  mockLookups.length = 0;
  mockBeforePrepare = undefined;
  mockBeforeWrite = undefined;
  mockBeforeSelect = undefined;
  mockRemote = null;
});
afterEach(async () => {
  await syncService.cleanupRealtimeSync();
  for (const [key, descriptor] of originalMethods) {
    if (descriptor) Object.defineProperty(localDB, key, descriptor);
    else Reflect.deleteProperty(localDB, key);
  }
  originalMethods.clear();
  localDB.db = previousDB;
  sqlite.close();
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  jest.useRealTimers();
});
function useBackend(backend: string): void {
  if (backend === 'native') return;
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(webDB))) {
    if (key === 'constructor') continue;
    const method = Reflect.get(webDB, key);
    if (typeof method !== 'function') continue;
    originalMethods.set(key, Object.getOwnPropertyDescriptor(localDB, key));
    Object.defineProperty(localDB, key, { configurable: true, value: method.bind(webDB) });
  }
  originalMethods.set('supportsWorkoutSync', Object.getOwnPropertyDescriptor(localDB, 'supportsWorkoutSync'));
  Object.defineProperty(localDB, 'supportsWorkoutSync', { configurable: true, value: false });
}
async function seed(owner = 'owner'): Promise<LocalNutritionGoals> {
  await localDB.upsertNutritionGoals({
    id: 'goals', user_id: owner, calories_goal: 2000, protein_goal: 100, carbs_goal: 250, fat_goal: 60,
  });
  return (await localDB.getNutritionGoalsById('goals'))!;
}
const read = () => localDB.getNutritionGoalsById('goals');

describe.each(['native', 'web'])('%s nutrition-goal sync', backend => {
  describe.each(['direct', 'queued'])('%s auth lifetime', path => {
    test.each(['lookup', 'upload'])('rejects late %s completion after invalidation even when the same user returns', async phase => {
      useBackend(backend);
      const original = await seed();
      if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
      const queue = await localDB.getSyncQueue();
      const changeLifetime = async () => {
        await syncService.cleanupRealtimeSync();
        await syncService.cleanupRealtimeSync();
      };
      if (phase === 'lookup') {
        mockRemote = { ...original, calories_goal: 2500, updated_at: later };
        mockBeforeSelect = changeLifetime;
      } else mockBeforeWrite = changeLifetime;
      await syncService.syncToSupabase();
      expect(mockWrites).toHaveLength(phase === 'upload' ? 1 : 0);
      expect(await read()).toEqual(original);
      expect(await localDB.getSyncQueue()).toEqual(queue);
    });
  });

  describe.each(['direct', 'queued'])('%s server ownership', path => {
    test.each([revision, later])('rejects a foreign server row at revision %s without losing pending work', async remoteRevision => {
      useBackend(backend);
      const original = await seed();
      if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
      mockRemote = { ...original, user_id: 'other-owner', updated_at: remoteRevision };
      await syncService.syncToSupabase();
      expect(mockWrites).toEqual([]);
      expect(await read()).toEqual(original);
      expect(await localDB.getSyncQueue()).toEqual([
        expect.objectContaining({ record_id: 'goals' }),
      ]);
      expect(syncService.getSyncStatus()).toMatchObject({
        state: 'error', lastError: 'Nutrition goals server ownership mismatch',
      });
    });
  });

  test.each(['direct', 'queued'])('%s applies newer server content while preserving local identity', async path => {
    useBackend(backend);
    const original = await seed();
    if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
    mockRemote = {
      ...original, id: 'server-goals', updated_at: later,
      calories_goal: 2400, protein_goal: 0, carbs_goal: 300, fat_goal: 70,
    };
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read()).toEqual({ ...mockRemote, id: original.id, synced: 1 });
    expect(await localDB.getNutritionGoalsById('server-goals')).toBeNull();
    expect(mockLookups).toEqual([{ columns: '*', filters: [['user_id', 'owner']] }]);
    expect(await localDB.getSyncQueue()).toEqual([]);
  });

  test('an already-acknowledged row retires its retry without another upload', async () => {
    useBackend(backend);
    const original = await seed();
    await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
    await localDB.updateNutritionGoalsSyncStatus('goals', true);
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read()).toEqual({ ...original, synced: 1 });
    expect(await localDB.getSyncQueue()).toEqual([]);
  });

  test('a missing persisted row is retained as a failed retry, not recreated', async () => {
    useBackend(backend);
    await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', { user_id: 'owner', calories_goal: 10 });
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read()).toBeNull();
    expect(await localDB.getSyncQueue()).toEqual([
      expect.objectContaining({ record_id: 'goals', retry_count: 1 }),
    ]);
    expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: 'Nutrition goals retry has no persisted row' });
  });

  test('deletion without a persisted tombstone cannot become a remote delete', async () => {
    useBackend(backend);
    const original = await seed();
    await localDB.addToSyncQueue('nutrition_goals', 'delete', 'goals', original);
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read()).toEqual(original);
    expect(await localDB.getSyncQueue()).toHaveLength(1);
    expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: 'Nutrition goals delete requires a durable tombstone' });
  });

  test.each(['direct', 'queued'])('%s cannot recreate a row removed while upload was pending', async path => {
    useBackend(backend);
    const original = await seed();
    if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
    const queue = await localDB.getSyncQueue();
    mockBeforeWrite = async () => { await localDB.deleteNutritionGoals('goals'); };
    await syncService.syncToSupabase();
    expect(mockWrites).toHaveLength(1);
    expect(await read()).toBeNull();
    expect(await localDB.getSyncQueue()).toEqual(queue);
  });

  test.each(['direct', 'queued'])('%s newer remote revision cannot acknowledge an edit made during lookup', async path => {
    useBackend(backend);
    const original = await seed();
    if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
    const queue = await localDB.getSyncQueue();
    mockRemote = { ...original, updated_at: later };
    mockBeforeSelect = async () => { await localDB.updateNutritionGoals('goals', { calories_goal: 0, synced: 0 }); };
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read()).toEqual({ ...original, calories_goal: 0 });
    expect(await localDB.getSyncQueue()).toEqual(queue);
  });

  test('queued ownership is read from persistence, not stale JSON', async () => {
    useBackend(backend);
    const original = await seed();
    await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', { ...original, user_id: 'other-owner', calories_goal: 1 });
    await syncService.syncToSupabase();
    expect(mockWrites).toHaveLength(1);
    expect(mockWrites[0][0]).toMatchObject({ user_id: 'owner', calories_goal: 2000 });
    expect(await read()).toEqual({ ...original, synced: 1 });
    expect(await localDB.getSyncQueue()).toEqual([]);
  });

  test.each(['direct', 'queued'])('%s refuses foreign persisted ownership without deleting data', async path => {
    useBackend(backend);
    const original = await seed('other-owner');
    if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', { ...original, user_id: 'owner' });
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([]);
    expect(await read()).toEqual(original);
    if (path === 'queued') expect(await localDB.getSyncQueue()).toHaveLength(1);
  });

  test.each(['direct', 'queued'])('%s acknowledgement preserves the content revision', async path => {
    useBackend(backend);
    const original = await seed();
    if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
    mockBeforeWrite = async () => { jest.setSystemTime(new Date(later)); };
    await syncService.syncToSupabase();
    expect(mockWrites).toEqual([[{
      id: original.id, user_id: original.user_id, calories_goal: original.calories_goal,
      protein_goal: original.protein_goal, carbs_goal: original.carbs_goal, fat_goal: original.fat_goal,
      updated_at: original.updated_at,
    }]]);
    expect(await read()).toEqual({ ...original, synced: 1 });
    expect(await localDB.getSyncQueue()).toEqual([]);
  });

  describe.each(['direct', 'queued'])('%s upload', path => {
    test.each(['calories_goal', 'protein_goal', 'carbs_goal', 'fat_goal'] as const)(
      'does not acknowledge a same-timestamp %s edit; next pass sends it', async field => {
        useBackend(backend);
        const original = await seed();
        if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
        const queue = await localDB.getSyncQueue();
        mockBeforeWrite = async () => { await localDB.updateNutritionGoals('goals', { [field]: 0, synced: 0 }); };
        await syncService.syncToSupabase();
        expect(mockWrites).toHaveLength(1);
        expect(await read()).toEqual({ ...original, [field]: 0 });
        expect(await localDB.getSyncQueue()).toEqual(queue);
        mockBeforeWrite = undefined;
        await syncService.syncToSupabase();
        expect(mockWrites).toHaveLength(2);
        expect(mockWrites[1][0]).toMatchObject({ [field]: 0, updated_at: revision });
        expect(await read()).toEqual({ ...original, [field]: 0, synced: 1 });
        expect(await localDB.getSyncQueue()).toEqual([]);
      },
    );
  });
});

describe.each(['direct', 'queued'])('native %s reconciliation preparation', path => {
  test.each(['server', 'local'])('invalidates the %s winner before prepared SQL execution', async winner => {
    const original = await seed();
    if (path === 'queued') await localDB.addToSyncQueue('nutrition_goals', 'upsert', 'goals', original);
    const queue = await localDB.getSyncQueue();
    if (winner === 'server') mockRemote = { ...original, calories_goal: 2500, updated_at: later };
    mockBeforePrepare = async () => { await syncService.cleanupRealtimeSync(); };
    await syncService.syncToSupabase();
    expect(mockWrites).toHaveLength(winner === 'local' ? 1 : 0);
    expect(await read()).toEqual(original);
    expect(await localDB.getSyncQueue()).toEqual(queue);
  });
});
