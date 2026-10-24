import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn() }));

test.each([false, true])('initialization adds nullable ownership without claiming or destroying legacy rows (existing=%s)', async (existing) => {
  const sqlite = new DatabaseSync(':memory:');
  if (existing) sqlite.exec(`CREATE TABLE workout_sessions (
    id TEXT PRIMARY KEY, template_id TEXT, name TEXT, goal_profile TEXT NOT NULL DEFAULT 'hypertrophy',
    started_at TEXT NOT NULL, ended_at TEXT, timezone_offset_minutes INTEGER NOT NULL DEFAULT 0,
    bodyweight_lb REAL, notes TEXT, synced INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT ''
  ); INSERT INTO workout_sessions (id, name, started_at) VALUES ('legacy', 'Do not claim', '2026-01-01');`);
  const previous = localDB.db;
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    getAllAsync: async (sql: string, args: string[] = []) => sqlite.prepare(sql).all(...args),
  } });
  try {
    const createTables = () => (localDB as unknown as { createTables(): Promise<void> }).createTables();
    await createTables();
    await createTables();
    expect(sqlite.prepare('PRAGMA table_info(workout_sessions)').all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user_id', notnull: 0 }),
    ]));
    if (existing) expect(sqlite.prepare('SELECT id, name, user_id FROM workout_sessions').get()).toEqual({ id: 'legacy', name: 'Do not claim', user_id: null });
  } finally {
    localDB.db = previous;
    sqlite.close();
  }
});
