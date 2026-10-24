import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';
import { downloadTableFromSupabase, handleGenericRealtimeChange, syncWorkoutRowToSupabase, WORKOUT_SYNC_CONFIGS } from '@/lib/services/database/generic-sync';

const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));
const config = WORKOUT_SYNC_CONFIGS.find(c => c.localTable === 'workout_sessions')!;
let sqlite: DatabaseSync;
beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    prepareAsync: async (sql: string) => {
      const statement = sqlite.prepare(sql);
      return {
        executeAsync: async (args: (string | number | null)[]) => statement.run(...args),
        finalizeAsync: async () => {},
      };
    },
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  sqlite.exec("INSERT INTO workout_sessions (id, name, started_at, updated_at) VALUES ('legacy', 'Local newer', '2026-01-01', '2026-01-01')");
  mockFrom.mockReset().mockImplementation(() => { throw new Error('offline'); });
});
afterEach(() => sqlite.close());

test.each(['workout_sessions', 'workout_session_exercises', 'workout_session_sets', 'workout_session_events'])('upload of %s refuses unknown/foreign ownership including queued retries', async table => {
  sqlite.exec(`INSERT INTO workout_session_exercises (id, session_id, exercise_id) VALUES ('ex', 'legacy', 'bench');
    INSERT INTO workout_session_sets (id, session_exercise_id) VALUES ('set', 'ex');
    INSERT INTO workout_session_events (id, session_id, type, created_at) VALUES ('event', 'legacy', 'session_started', '2026-01-01');`);
  const cfg = WORKOUT_SYNC_CONFIGS.find(c => c.localTable === table)!;
  const row = sqlite.prepare(`SELECT * FROM ${table}`).get()!;
  await expect(syncWorkoutRowToSupabase(cfg, row, 'b')).rejects.toThrow('ownership');
  sqlite.exec("UPDATE workout_sessions SET user_id = 'a'");
  await expect(syncWorkoutRowToSupabase(cfg, row, 'b')).rejects.toThrow('ownership');
  expect(mockFrom).not.toHaveBeenCalled();
});


test.each(['b', null])('upload conflict cannot replace local owner with server owner %s', async remoteOwner => {
  sqlite.exec("UPDATE workout_sessions SET user_id = 'a'");
  const row = sqlite.prepare("SELECT * FROM workout_sessions WHERE id = 'legacy'").get()!;
  const remote = { ...row, user_id: remoteOwner, name: 'Foreign server data', updated_at: '2027-01-01' };
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: remote, error: null }) };
  mockFrom.mockReturnValue(chain);
  await expect(syncWorkoutRowToSupabase(config, row, 'a')).rejects.toThrow('ownership');
  expect(sqlite.prepare("SELECT user_id, name, synced FROM workout_sessions WHERE id = 'legacy'").get())
    .toEqual({ user_id: 'a', name: 'Local newer', synced: 0 });
});

test('download and realtime persist server ownership, including unsynced legacy rows', async () => {
  const remote = { id: 'downloaded', user_id: 'a', started_at: '2026-01-01', updated_at: '2026-01-01' };
  const chain = { select: () => chain, eq: () => chain, order: () => chain, range: async () => ({ data: [remote], error: null }) };
  mockFrom.mockReturnValue(chain);
  await downloadTableFromSupabase(config, 'a');
  expect(sqlite.prepare("SELECT user_id FROM workout_sessions WHERE id = 'downloaded'").get()).toEqual({ user_id: 'a' });
  await handleGenericRealtimeChange(config, { eventType: 'UPDATE', new: { ...remote, id: 'legacy' }, old: {} } as never, jest.fn(), jest.fn());
  expect(sqlite.prepare("SELECT user_id FROM workout_sessions WHERE id = 'legacy'").get()).toEqual({ user_id: 'a' });
});


test('server download attributes legacy rows even when their local content is newer', async () => {
  const remote = { id: 'legacy', user_id: 'a', name: 'Server older', started_at: '2020-01-01', updated_at: '2020-01-01' };
  const chain = { select: () => chain, eq: () => chain, order: () => chain, range: async () => ({ data: [remote], error: null }) };
  mockFrom.mockReturnValue(chain);
  await downloadTableFromSupabase(config, 'a');
  expect(sqlite.prepare('SELECT user_id, name, synced FROM workout_sessions').get()).toEqual({ user_id: 'a', name: 'Local newer', synced: 0 });
});
