/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';
import { accountCleanup } from '@/lib/services/database/account-cleanup';
import {
  cleanupWorkoutSyncedDeletes, downloadTableFromSupabase, handleGenericRealtimeChange,
  reconcileSystemExerciseIds, syncTableToSupabase, syncWorkoutRowToSupabase, WORKOUT_SYNC_CONFIGS,
} from '@/lib/services/database/generic-sync';

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));
type Bind = string | number | null;
const at = '2026-10-01T10:00:00.000Z';
const sessions = WORKOUT_SYNC_CONFIGS.find(c => c.localTable === 'workout_sessions')!;
const exercises = WORKOUT_SYNC_CONFIGS.find(c => c.localTable === 'exercises')!;
let sqlite: DatabaseSync;
let previousDB: typeof localDB.db;
let pause: ((sql: string) => Promise<void>) | undefined;
let held: { executeAsync: jest.Mock; finalizeAsync: jest.Mock };
const notify = jest.fn();
const onError = jest.fn();
let remote: Record<string, unknown>[];
let server: Record<string, unknown> | null;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function row() { return sqlite.prepare("SELECT * FROM workout_sessions WHERE id = 'session'").get()!; }
function snapshot() {
  return ['workout_sessions', 'workout_session_events', 'exercises', 'sync_queue', 'workout_session_exercises', 'workout_template_exercises']
    .map(table => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
}
beforeEach(async () => {
  await accountCleanup.run(async () => {});
  sqlite = new DatabaseSync(':memory:');
  previousDB = localDB.db;
  pause = undefined;
  notify.mockReset(); onError.mockReset();
  const prepareAsync = async (sql: string) => {
    const statement = sqlite.prepare(sql);
    const wrapped = {
      executeAsync: jest.fn(async (args: Bind[] = []) => statement.run(...args)),
      finalizeAsync: jest.fn(async () => {}),
    };
    held = wrapped;
    await pause?.(sql);
    return wrapped;
  };
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    getAllAsync: async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).all(...args),
    prepareAsync,
    // Faithful Expo runAsync: preparation yields before execution.
    runAsync: async (sql: string, args: Bind[] = []) => {
      const statement = await prepareAsync(sql);
      try { return await statement.executeAsync(args); }
      finally { await statement.finalizeAsync(); }
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      sqlite.exec('BEGIN');
      try { await fn(); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  sqlite.prepare("INSERT INTO workout_sessions (id, user_id, name, started_at, updated_at) VALUES ('session', 'owner', 'Original', ?, ?)").run(at, at);
  sqlite.exec("INSERT INTO exercises (id, name, category, is_system) VALUES ('seed-squat', 'Squat', 'strength', 1)");
  remote = []; server = null;
  const query = {
    select: () => query, eq: () => query, order: () => query,
    single: async () => ({ data: server, error: null }),
    range: async () => ({ data: remote, error: null }),
    in: async () => ({ data: remote, error: null }),
    upsert: async () => ({ error: null }),
    delete: () => query,
    then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
  };
  mockFrom.mockReset().mockReturnValue(query);
});
afterEach(async () => {
  pause = undefined;
  localDB.db = previousDB;
  sqlite.close();
  await accountCleanup.run(async () => {});
});

function realtime(eventType: 'UPDATE' | 'DELETE') {
  return handleGenericRealtimeChange(sessions, {
    eventType, new: { ...row(), name: 'Remote' }, old: { id: 'session' },
    schema: 'public', table: 'workout_sessions', commit_timestamp: at, errors: [],
  } as Parameters<typeof handleGenericRealtimeChange>[1], notify, jest.fn(), onError);
}
const cases: [string, RegExp, () => Promise<void>][] = [
  ['table upload acknowledgement', /SET synced =/, () => syncTableToSupabase(sessions, 'owner')],
  ['upload acknowledgement', /SET synced =/, () => syncWorkoutRowToSupabase(sessions, row(), 'owner')],
  ['server-wins reconciliation', /UPDATE workout_sessions SET id/, () => {
    server = { ...row(), name: 'Remote', updated_at: '2026-10-02T10:00:00.000Z' };
    return syncWorkoutRowToSupabase(sessions, row(), 'owner');
  }],
  ['download insertion', /INSERT INTO exercises/, () => {
    remote = [{ id: 'remote', name: 'Remote', category: 'strength' }];
    return downloadTableFromSupabase(exercises, 'owner');
  }],
  ['download ownership hydration', /SET user_id =/, () => {
    remote = [{ ...row(), user_id: 'owner' }];
    return downloadTableFromSupabase(sessions, 'owner');
  }],
  ['realtime ownership hydration', /SET user_id =/, () => realtime('UPDATE')],
  ['realtime reconciliation', /UPDATE workout_sessions SET id/, () => realtime('UPDATE')],
  ['realtime deletion', /DELETE FROM workout_sessions/, () => realtime('DELETE')],
  ['catalog insertion', /INSERT INTO exercises/, () => {
    remote = [{ ...sqlite.prepare("SELECT * FROM exercises WHERE id = 'seed-squat'").get()!, id: 'server-squat' }];
    return reconcileSystemExerciseIds();
  }],
  ['catalog reference update', /UPDATE workout_template_exercises/, () => {
    remote = [{ ...sqlite.prepare("SELECT * FROM exercises WHERE id = 'seed-squat'").get()!, id: 'server-squat' }];
    return reconcileSystemExerciseIds();
  }],
  ['catalog queue deletion', /DELETE FROM sync_queue/, () => {
    remote = [{ ...sqlite.prepare("SELECT * FROM exercises WHERE id = 'seed-squat'").get()!, id: 'server-squat' }];
    return reconcileSystemExerciseIds();
  }],
  ['maintenance deletion', /DELETE FROM workout_sessions/, cleanupWorkoutSyncedDeletes],
];

test.each(cases)('%s cannot execute after cleanup during real SQL preparation', async (_name, target, start) => {
  sqlite.exec("UPDATE workout_sessions SET synced = 1; UPDATE exercises SET synced = 1");
  if (_name === 'table upload acknowledgement') sqlite.exec('UPDATE workout_sessions SET synced = 0');
  if (_name === 'maintenance deletion') sqlite.exec('UPDATE workout_sessions SET deleted = 1');
  const before = snapshot();
  const entered = deferred(); const release = deferred();
  pause = async sql => { if (target.test(sql)) { entered.resolve(); await release.promise; } };
  const outcome = start().then(() => undefined, error => error as Error);
  await entered.promise;
  const statement = held;
  await accountCleanup.run(async () => {});
  expect(accountCleanup.isBlocked).toBe(false);
  release.resolve();
  await outcome;
  expect(statement.executeAsync).not.toHaveBeenCalled();
  expect(statement.finalizeAsync).toHaveBeenCalledTimes(1);
  expect(snapshot()).toEqual(before);
  expect(notify).not.toHaveBeenCalled();
});

test('connection replacement during preparation cancels acknowledgement and finalizes', async () => {
  const before = snapshot();
  const entered = deferred(); const release = deferred();
  pause = async sql => { if (/SET synced =/.test(sql)) { entered.resolve(); await release.promise; } };
  const outcome = syncWorkoutRowToSupabase(sessions, row(), 'owner').catch(error => error as Error);
  await entered.promise;
  const statement = held;
  localDB.db = Object.create(localDB.db);
  release.resolve();
  expect(await outcome).toBeInstanceOf(Error);
  expect(statement.executeAsync).not.toHaveBeenCalled();
  expect(statement.finalizeAsync).toHaveBeenCalledTimes(1);
  expect(snapshot()).toEqual(before);
});

test('successful acknowledgement executes and finalizes the prepared statement', async () => {
  await syncWorkoutRowToSupabase(sessions, row(), 'owner');
  expect(row().synced).toBe(1);
  expect(held.executeAsync).toHaveBeenCalledTimes(1);
  expect(held.finalizeAsync).toHaveBeenCalledTimes(1);
});

test('execution failure finalizes the prepared statement and preserves local content', async () => {
  const before = snapshot();
  sqlite.exec("CREATE TRIGGER fail_ack BEFORE UPDATE OF synced ON workout_sessions BEGIN SELECT RAISE(ABORT, 'blocked acknowledgement'); END");
  await expect(syncWorkoutRowToSupabase(sessions, row(), 'owner')).rejects.toThrow(/blocked acknowledgement/);
  expect(held.executeAsync).toHaveBeenCalledTimes(1);
  expect(held.finalizeAsync).toHaveBeenCalledTimes(1);
  expect(snapshot()).toEqual(before);
});
