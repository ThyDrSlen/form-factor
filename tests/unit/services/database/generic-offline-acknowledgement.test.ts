/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';
import { syncWorkoutRowToSupabase, WORKOUT_SYNC_CONFIGS } from '@/lib/services/database/generic-sync';

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

type Bind = string | number | null;
const at = '2026-10-01T10:00:00.000Z';
const config = WORKOUT_SYNC_CONFIGS.find(c => c.localTable === 'workout_sessions')!;
let sqlite: DatabaseSync;
let previousDB: typeof localDB.db;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function session() {
  return sqlite.prepare("SELECT * FROM workout_sessions WHERE id = 'session'").get()!;
}

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  previousDB = localDB.db;
  const runAsync = async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).run(...args);
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync,
    prepareAsync: async (sql: string) => ({
      executeAsync: async (args: Bind[]) => runAsync(sql, args),
      finalizeAsync: async () => {},
    }),
    getAllAsync: async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).all(...args),
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  sqlite.prepare(`INSERT INTO workout_sessions (id, user_id, name, started_at, updated_at)
    VALUES ('session', 'owner', 'Original', ?, ?)`).run(at, at);
  mockFrom.mockReset();
});
afterEach(() => {
  localDB.db = previousDB;
  sqlite.close();
});

test.each(['edit', 'tombstone', 'restore', 'unchanged'] as const)(
  'upload acknowledgement preserves the captured version: %s during the remote request', async change => {
    if (change === 'restore') sqlite.exec("UPDATE workout_sessions SET deleted = 1 WHERE id = 'session'");
    const captured = session();
    const entered = deferred<void>();
    const response = deferred<{ error: null }>();
    const write = jest.fn(() => { entered.resolve(); return response.promise; });
    const read = { select: () => read, eq: () => read, single: async () => ({ data: null, error: null }) };
    mockFrom.mockReturnValue({ ...read, upsert: write, delete: () => ({ eq: write }) });
    const upload = syncWorkoutRowToSupabase(config, captured, 'owner');
    await entered.promise;
    if (change === 'edit') sqlite.exec("UPDATE workout_sessions SET notes = 'New note', synced = 0 WHERE id = 'session'");
    if (change === 'tombstone') sqlite.exec("UPDATE workout_sessions SET deleted = 1, synced = 0 WHERE id = 'session'");
    if (change === 'restore') sqlite.exec("UPDATE workout_sessions SET deleted = 0, synced = 0 WHERE id = 'session'");
    const edited = session();
    // Intentionally keep updated_at unchanged: timestamps are not revision tokens.
    expect(edited.updated_at).toBe(at);
    response.resolve({ error: null });
    await upload;
    expect(write).toHaveBeenCalledTimes(1);
    expect(session()).toEqual({ ...edited, synced: change === 'unchanged' ? 1 : 0 });
  },
);

test.each(['removed', 'newer-edit', 'unchanged'] as const)(
  'server-wins reconciliation is conditional on the existing row: %s', async change => {
    const captured = session();
    const entered = deferred<void>();
    const response = deferred<{ data: Record<string, unknown>; error: null }>();
    const remote = { ...captured, name: 'Server newer', updated_at: '2026-10-01T11:00:00.000Z' };
    const write = jest.fn();
    const chain = {
      select: () => chain, eq: () => chain,
      single: () => { entered.resolve(); return response.promise; },
      upsert: write,
    };
    mockFrom.mockReturnValue(chain);
    const upload = syncWorkoutRowToSupabase(config, captured, 'owner');
    await entered.promise;
    if (change === 'removed') sqlite.exec("DELETE FROM workout_sessions WHERE id = 'session'");
    if (change === 'newer-edit') sqlite.exec("UPDATE workout_sessions SET name = 'Local edit', updated_at = '2026-10-01T10:30:00.000Z' WHERE id = 'session'");
    const edited = session();
    response.resolve({ data: remote, error: null });
    await upload;
    expect(write).not.toHaveBeenCalled();
    if (change === 'removed') expect(session()).toBeUndefined();
    else if (change === 'newer-edit') expect(session()).toEqual(edited);
    else expect(session()).toEqual({ ...remote, synced: 1 });
  },
);
