/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localDB } from '@/lib/services/database/local-db';
import { accountCleanup, ACCOUNT_CLEANUP_KEY } from '@/lib/services/database/account-cleanup';
import {
  cleanupWorkoutSyncedDeletes, downloadAllWorkoutTablesFromSupabase,
  downloadTableFromSupabase, handleGenericRealtimeChange, reconcileSystemExerciseIds,
  syncAllWorkoutTablesToSupabase, syncTableToSupabase, syncWorkoutRowToSupabase,
  WORKOUT_SYNC_CONFIGS,
} from '@/lib/services/database/generic-sync';

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

type Bind = string | number | null;
const at = '2026-10-01T10:00:00.000Z';
const config = WORKOUT_SYNC_CONFIGS.find(c => c.localTable === 'workout_sessions')!;
let sqlite: DatabaseSync;
let previousDB: typeof localDB.db;
const read = jest.fn();
const run = jest.fn();
const notify = jest.fn();
const reconcile = jest.fn();
const onError = jest.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function session() {
  return sqlite.prepare("SELECT * FROM workout_sessions WHERE id = 'session'").get()!;
}
function realtime() {
  return handleGenericRealtimeChange(config, {
    eventType: 'UPDATE', new: { ...session(), name: 'Remote' }, old: {},
    schema: 'public', table: 'workout_sessions', commit_timestamp: at, errors: [],
  }, notify, reconcile, onError);
}

beforeEach(async () => {
  await accountCleanup.run(async () => {});
  sqlite = new DatabaseSync(':memory:');
  previousDB = localDB.db;
  read.mockReset().mockImplementation(async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).all(...args));
  run.mockReset().mockImplementation(async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).run(...args));
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: run,
    prepareAsync: async (sql: string) => ({
      executeAsync: async (args: Bind[]) => run(sql, args),
      finalizeAsync: async () => {},
    }),
    getAllAsync: read,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      sqlite.exec('BEGIN');
      try { await fn(); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  sqlite.prepare(`INSERT INTO workout_sessions (id, user_id, name, started_at, updated_at)
    VALUES ('session', 'owner', 'Original', ?, ?)`).run(at, at);
  read.mockClear();
  run.mockClear();
  notify.mockReset(); reconcile.mockReset(); onError.mockReset();
  const query = {
    select: () => query, eq: () => query, order: () => query,
    range: async () => ({ data: [], error: null }),
    single: async () => ({ data: null, error: null }),
    upsert: async () => ({ error: null }),
  };
  mockFrom.mockReset().mockReturnValue(query);
});
afterEach(async () => {
  localDB.db = previousDB;
  sqlite.close();
  await accountCleanup.run(async () => {});
});

const entries: [string, () => Promise<void>][] = [
  ['upload row', () => syncWorkoutRowToSupabase(config, session(), 'owner')],
  ['upload table', () => syncTableToSupabase(config, 'owner')],
  ['upload all', () => syncAllWorkoutTablesToSupabase('owner')],
  ['download table', () => downloadTableFromSupabase(config, 'owner')],
  ['download all', () => downloadAllWorkoutTablesFromSupabase('owner')],
  ['catalog reconciliation', reconcileSystemExerciseIds],
  ['synced-delete cleanup', cleanupWorkoutSyncedDeletes],
];

test.each(entries)('%s fails closed on a durable cleanup obligation before any work', async (_name, entry) => {
  await AsyncStorage.setItem(ACCOUNT_CLEANUP_KEY, '1');
  await expect(entry()).rejects.toThrow(/cleanup/i);
  expect(read).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
});

test('realtime fails closed and reports the cleanup obligation without writes or notifications', async () => {
  await AsyncStorage.setItem(ACCOUNT_CLEANUP_KEY, '1');
  await realtime();
  expect(read).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith('workout_sessions', expect.objectContaining({ message: expect.stringMatching(/cleanup/i) }));
});

test.each(['lookup', 'upload', 'failed-upload'] as const)(
  'cleanup completed during %s retires the upload and never acknowledges or queues it', async boundary => {
    const entered = deferred<void>();
    const response = deferred<{ data: null; error: Error | null }>();
    const pause = () => { entered.resolve(); return response.promise; };
    const write = jest.fn(boundary === 'lookup' ? async () => ({ data: null, error: null }) : pause);
    const query = {
      select: () => query, eq: () => query,
      single: boundary === 'lookup' ? pause : async () => ({ data: null, error: null }),
      upsert: write,
    };
    mockFrom.mockReturnValue(query);
    const before = session();
    const upload = syncTableToSupabase(config, 'owner');
    await entered.promise;
    await accountCleanup.run(async () => {});
    expect(accountCleanup.isBlocked).toBe(false);
    response.resolve({ data: null, error: boundary === 'failed-upload' ? new Error('network') : null });
    await expect(upload).rejects.toThrow(/cleanup/i);
    expect(session()).toEqual(before);
    expect(sqlite.prepare('SELECT * FROM sync_queue').all()).toEqual([]);
    if (boundary === 'lookup') expect(write).not.toHaveBeenCalled();
  },
);

test('cleanup completed during a download page stops both ingestion and the all-table continuation', async () => {
  const entered = deferred<void>();
  const response = deferred<{ data: Record<string, unknown>[]; error: null }>();
  const query = {
    select: () => query, eq: () => query, order: () => query,
    range: jest.fn().mockImplementationOnce(() => { entered.resolve(); return response.promise; })
      .mockResolvedValue({ data: [], error: null }),
  };
  mockFrom.mockReturnValue(query);
  const download = downloadAllWorkoutTablesFromSupabase('owner');
  await entered.promise;
  await accountCleanup.run(async () => {});
  response.resolve({ data: [{ id: 'remote-exercise', name: 'Remote', category: 'strength' }], error: null });
  await expect(download).rejects.toThrow(/cleanup/i);
  expect(mockFrom).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test.each(['UPDATE', 'DELETE'] as const)('cleanup completed during realtime %s read stops mutations and publication', async eventType => {
  sqlite.exec("UPDATE workout_sessions SET synced = 1 WHERE id = 'session'");
  const before = session();
  const entered = deferred<void>();
  const release = deferred<void>();
  read.mockImplementationOnce(async (sql: string, args: Bind[]) => {
    const result = sqlite.prepare(sql).all(...args);
    entered.resolve(); await release.promise; return result;
  });
  const pending = handleGenericRealtimeChange(config, {
    eventType, new: { ...before, name: 'Remote' }, old: { id: 'session' },
    schema: 'public', table: 'workout_sessions', commit_timestamp: at, errors: [],
  } as Parameters<typeof handleGenericRealtimeChange>[1], notify, reconcile, onError);
  await entered.promise;
  await accountCleanup.run(async () => {});
  release.resolve();
  await pending;
  expect(session()).toEqual(before);
  expect(run).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
});

test('cleanup completed during catalog fetch prevents ID replacement', async () => {
  sqlite.exec("INSERT INTO exercises (id, name, category, is_system) VALUES ('seed-squat', 'Squat', 'strength', 1)");
  const before = sqlite.prepare('SELECT * FROM exercises').all();
  const entered = deferred<void>();
  const response = deferred<{ data: Record<string, unknown>[]; error: null }>();
  const query = { select: () => query, eq: () => query, in: () => { entered.resolve(); return response.promise; } };
  mockFrom.mockReturnValue(query);
  const pending = reconcileSystemExerciseIds();
  await entered.promise;
  await accountCleanup.run(async () => {});
  response.resolve({ data: [{ ...before[0], id: 'server-squat' }], error: null });
  await expect(pending).rejects.toThrow(/cleanup/i);
  expect(sqlite.prepare('SELECT * FROM exercises').all()).toEqual(before);
  expect(run).not.toHaveBeenCalled();
});

test('generation is captured before the asynchronous durable-marker check', async () => {
  const entered = deferred<void>();
  const release = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => { entered.resolve(); return release.promise; });
  const pending = downloadTableFromSupabase(config, 'owner');
  await entered.promise;
  await accountCleanup.run(async () => {});
  release.resolve(null);
  await expect(pending).rejects.toThrow(/cleanup/i);
  expect(mockFrom).not.toHaveBeenCalled();
});

test.each(['upsert', 'delete', 'append-only', 'server-wins'] as const)(
  'cleanup during the final %s local response cannot report a successful upload', async mode => {
    const selected = mode === 'append-only'
      ? WORKOUT_SYNC_CONFIGS.find(c => c.localTable === 'workout_session_events')! : config;
    if (mode === 'append-only') {
      sqlite.prepare("INSERT INTO workout_session_events (id, session_id, type, payload, created_at) VALUES ('event', 'session', 'started', '{}', ?)").run(at);
    }
    if (mode === 'delete') sqlite.exec("UPDATE workout_sessions SET deleted = 1 WHERE id = 'session'");
    const captured = mode === 'append-only'
      ? sqlite.prepare("SELECT * FROM workout_session_events WHERE id = 'event'").get()! : session();
    const query = {
      select: () => query, eq: () => query,
      single: async () => ({ data: mode === 'server-wins'
        ? { ...captured, updated_at: '2026-10-01T11:00:00.000Z' } : null, error: null }),
      upsert: async () => ({ error: null }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    };
    mockFrom.mockReturnValue(query);
    const entered = deferred<void>();
    const release = deferred<void>();
    run.mockImplementationOnce(async (sql: string, args: Bind[]) => {
      // Execution predates cleanup; only delivery of the real result is paused.
      // This does NOT model or claim protection during Expo's prepareAsync.
      const result = sqlite.prepare(sql).run(...args);
      entered.resolve(); await release.promise; return result;
    });
    const pending = syncWorkoutRowToSupabase(selected, captured, 'owner');
    await entered.promise;
    await accountCleanup.run(async () => {});
    release.resolve();
    await expect(pending).rejects.toThrow(/cleanup/i);
  },
);

test('a failed cleanup blocks fresh uploads until a successful cleanup retry', async () => {
  await expect(accountCleanup.run(async () => { throw new Error('disk failure'); })).rejects.toThrow('disk failure');
  await expect(syncWorkoutRowToSupabase(config, session(), 'owner')).rejects.toThrow(/cleanup/i);
  expect(mockFrom).not.toHaveBeenCalled();
  expect(session().synced).toBe(0);
  await accountCleanup.run(async () => {});
  await syncWorkoutRowToSupabase(config, session(), 'owner');
  expect(mockFrom).toHaveBeenCalled();
  expect(session().synced).toBe(1);
});
