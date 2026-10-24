import { DatabaseSync } from 'node:sqlite';
import { localDB, type LocalFood, type LocalWorkout } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';
import { downloadAllWorkoutTablesFromSupabase, syncAllWorkoutTablesToSupabase } from '@/lib/services/database/generic-sync';

type Row = Record<string, unknown>;
test('full sync retains generic download failure and never advances to upload', async () => {
  jest.mocked(downloadAllWorkoutTablesFromSupabase).mockRejectedValueOnce(new Error('Workout page failed'));
  await syncService.fullSync();
  expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: 'Workout page failed' });
  expect(syncAllWorkoutTablesToSupabase).not.toHaveBeenCalled();
});

interface Query { table: string; filters: Record<string, unknown>; range?: [number, number]; single?: boolean }
const mockQueries: Query[] = [];
let mockRemote: Record<string, Row[]> = {};
let mockUser: string | null = 'owner-a';
let mockBeforeResponse: ((query: Query) => Promise<void>) | undefined;
let mockFailure: ((query: Query) => boolean) | undefined;
let mockBeforeWrite: ((table: string) => Promise<void>) | undefined;

jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: jest.fn(async () => ({ data: { user: mockUser ? { id: mockUser } : null }, error: null })) },
  removeChannel: jest.fn(),
  from: (table: string) => {
    const query: Query = { table, filters: {} };
    const builder = {
      select: () => builder,
      upsert: async () => { await mockBeforeWrite?.(table); return { error: null }; },
      eq: (key: string, value: unknown) => { query.filters[key] = value; return builder; },
      order: () => builder,
      range: (start: number, end: number) => { query.range = [start, end]; return builder; },
      single: () => { query.single = true; return builder; },
      then: async (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        try {
          mockQueries.push(query);
          await mockBeforeResponse?.(query);
          if (mockFailure?.(query)) return resolve({ data: null, error: new Error('Server temporarily unavailable') });
          const matches = (mockRemote[table] ?? []).filter(row => Object.entries(query.filters).every(([key, value]) => row[key] === value));
          return resolve({ data: query.single ? matches[0] ?? null : query.range
            ? matches.slice(query.range[0], query.range[1] + 1) : matches.slice(0, 500), error: null });
        } catch (error) { return reject(error); }
      },
    };
    return builder;
  },
} }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));
jest.mock('@/lib/services/database/generic-sync', () => ({
  syncAllWorkoutTablesToSupabase: jest.fn(), downloadAllWorkoutTablesFromSupabase: jest.fn(),
  cleanupWorkoutSyncedDeletes: jest.fn(), WORKOUT_SYNC_CONFIGS: [],
}));
let sqlite: DatabaseSync;
let previous: typeof localDB.db;
const timestamp = '2026-10-01T12:00:00.000Z';
const food = (id = 'local-food'): LocalFood => ({ id, name: 'Oats', calories: 100, protein: 5, carbs: 10, fat: 2, date: timestamp, synced: 1, deleted: 0, updated_at: timestamp });
const workout = (id = 'local-workout'): LocalWorkout => ({ id, exercise: 'Squat', sets: 3, reps: 10, weight: 50, duration: 0, date: timestamp, synced: 1, deleted: 0, updated_at: timestamp });

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  previous = localDB.db;
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      sqlite.exec('BEGIN');
      try { await fn(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  Object.assign(syncService, { syncPromise: null, syncStatus: { state: 'idle', queueSize: 0, lastError: null, lastErrorAt: null } });
  mockQueries.length = 0;
  mockRemote = {};
  mockUser = 'owner-a';
  mockBeforeResponse = undefined;
  mockFailure = undefined;
  mockBeforeWrite = undefined;
  jest.clearAllMocks();
});
afterEach(async () => {
  await syncService.cleanupRealtimeSync();
  localDB.db = previous;
  sqlite.close();
});

test('an empty server listing is not proof of deletion of cached foods or workouts', async () => {
  await localDB.insertFood(food());
  await localDB.insertWorkout(workout());
  sqlite.prepare('UPDATE foods SET synced = 1, updated_at = ?').run(timestamp);
  sqlite.prepare('UPDATE workouts SET synced = 1, updated_at = ?').run(timestamp);
  const beforeFood = await localDB.getFoodById('local-food');
  const beforeWorkout = await localDB.getWorkoutById('local-workout');
  await syncService.downloadFromSupabase();
  expect(await localDB.getFoodById('local-food')).toEqual(beforeFood);
  expect(await localDB.getWorkoutById('local-workout')).toEqual(beforeWorkout);
});

test.each(['foods', 'workouts'])('downloads every owner-scoped page of %s', async table => {
  mockRemote[table] = Array.from({ length: 501 }, (_, index) => ({
    ...(table === 'foods' ? food(`row-${index}`) : workout(`row-${index}`)),
    user_id: 'owner-a', created_at: timestamp,
  }));
  await syncService.downloadFromSupabase();
  const rows = table === 'foods' ? await localDB.getAllFoodsWithDeleted() : await localDB.getAllWorkoutsWithDeleted();
  expect(rows).toHaveLength(501);
  expect(mockQueries.filter(q => q.table === table)).toEqual([
    expect.objectContaining({ filters: { user_id: 'owner-a' }, range: [0, 499] }),
    expect.objectContaining({ filters: { user_id: 'owner-a' }, range: [500, 999] }),
  ]);
});

test('a food response delivered after sign-out cleanup cannot repopulate the local cache', async () => {
  mockRemote.foods = [{ ...food('stale-food'), user_id: 'owner-a', created_at: timestamp }];
  mockBeforeResponse = async query => {
    if (query.table === 'foods') {
      mockUser = null;
      await syncService.cleanupRealtimeSync();
    }
  };
  await syncService.downloadFromSupabase();
  expect(await localDB.getFoodById('stale-food')).toBeNull();
});

test('full sync retains a failed download status instead of masking it with an empty successful upload', async () => {
  mockFailure = query => query.table === 'foods';
  await syncService.fullSync();
  expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: 'Server temporarily unavailable' });
});

test('full sync never starts uploads for a replacement account after its download is cancelled', async () => {
  mockBeforeResponse = async query => {
    if (query.table === 'foods') {
      mockUser = 'owner-b';
      await syncService.cleanupRealtimeSync();
    }
  };
  await syncService.fullSync();
  expect(syncAllWorkoutTablesToSupabase).not.toHaveBeenCalled();
});

test.each(['foods', 'workouts'])('newly recovered %s retain the server revision and are not re-uploaded as local edits', async table => {
  mockRemote[table] = [{
    ...(table === 'foods' ? food('remote-row') : workout('remote-row')),
    user_id: 'owner-a', created_at: timestamp,
  }];
  await syncService.downloadFromSupabase();
  const row = table === 'foods' ? await localDB.getFoodById('remote-row') : await localDB.getWorkoutById('remote-row');
  expect(row).toMatchObject({ synced: 1, updated_at: timestamp });
  const dirtyRows = table === 'foods' ? await localDB.getUnsyncedFoods() : await localDB.getUnsyncedWorkouts();
  expect(dirtyRows).toEqual([]);
});

test.each(['foods', 'workouts'])('recovery never overwrites pending local %s edits with a newer server timestamp', async table => {
  if (table === 'foods') await localDB.insertFood(food('pending-row'));
  else await localDB.insertWorkout(workout('pending-row'));
  sqlite.prepare(`UPDATE ${table} SET synced = 0, updated_at = ?`).run(timestamp);
  mockRemote[table] = [{
    ...(table === 'foods' ? { ...food('pending-row'), name: 'Remote overwrite' } : { ...workout('pending-row'), reps: 99 }),
    user_id: 'owner-a', created_at: timestamp, updated_at: '2026-10-02T12:00:00.000Z',
  }];
  const before = table === 'foods' ? await localDB.getFoodById('pending-row') : await localDB.getWorkoutById('pending-row');
  await syncService.downloadFromSupabase();
  const after = table === 'foods' ? await localDB.getFoodById('pending-row') : await localDB.getWorkoutById('pending-row');
  expect(after).toEqual(before);
});

test.each(['foods', 'workouts'])('an upload response cannot acknowledge newer local %s content', async table => {
  if (table === 'foods') await localDB.insertFood(food('in-flight'));
  else await localDB.insertWorkout(workout('in-flight'));
  sqlite.prepare(`UPDATE ${table} SET updated_at = ?`).run(timestamp);
  mockBeforeWrite = async uploadedTable => {
    if (uploadedTable !== table) return;
    if (table === 'foods') await localDB.updateFood('in-flight', { calories: 200, synced: 0, updated_at: timestamp });
    else await localDB.updateWorkout('in-flight', { reps: 20, synced: 0, updated_at: timestamp });
  };
  await syncService.syncToSupabase();
  const row = table === 'foods' ? await localDB.getFoodById('in-flight') : await localDB.getWorkoutById('in-flight');
  expect(row).toMatchObject({ synced: 0, updated_at: timestamp, ...(table === 'foods' ? { calories: 200 } : { reps: 20 }) });
});
