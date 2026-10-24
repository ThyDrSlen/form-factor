/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';
import type { SyncTableName } from '@/lib/services/database/sync-types';

const mockWrites: Array<{ table: string; operation: string }> = [];
let mockFailure = true;
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
  from: (table: string) => {
    let operation = 'select';
    const builder = {
      select: () => builder, eq: () => builder, single: () => builder,
      upsert: () => { operation = 'upsert'; return builder; },
      delete: () => { operation = 'delete'; return builder; },
      then: (resolve: (value: unknown) => unknown) => {
        if (operation !== 'select') mockWrites.push({ table, operation });
        return Promise.resolve(resolve({ data: null,
          error: operation !== 'select' && mockFailure ? { code: '42501', message: 'retryable denial' } : null,
        }));
      },
    };
    return builder;
  },
} }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

const NOW = '2026-10-03T12:00:00.000Z';
const DUE = '2026-10-03T12:01:00.000Z';
let sqlite: DatabaseSync;
let previous: typeof localDB.db;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
  sqlite = new DatabaseSync(':memory:');
  previous = localDB.db;
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    prepareAsync: async (sql: string) => {
      const statement = sqlite.prepare(sql);
      return {
        executeAsync: async (args: (string | number | null)[] = []) => statement.run(...args),
        finalizeAsync: async () => {},
      };
    },
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
    withTransactionAsync: async (task: () => Promise<void>) => {
      sqlite.exec('BEGIN');
      try { await task(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  mockWrites.length = 0;
  mockFailure = true;
});
afterEach(() => {
  localDB.db = previous;
  sqlite.close();
  jest.useRealTimers();
});

const cases: Array<[SyncTableName, Record<string, string | number>]> = [
  ['foods', { name: 'Apple', calories: 50, date: NOW }],
  ['workouts', { exercise: 'Squat', sets: 3, date: NOW }],
  ['health_metrics', { user_id: 'owner', summary_date: '2026-10-03', steps: 100 }],
  ['nutrition_goals', { user_id: 'owner', calories_goal: 2000, protein_goal: 100, carbs_goal: 200, fat_goal: 60 }],
  ['exercises', { name: 'Squat', created_by: 'owner' }],
  ['workout_templates', { name: 'Template' }],
  ['workout_template_exercises', { template_id: 'template', exercise_id: 'exercise' }],
  ['workout_template_sets', { template_exercise_id: 'template-exercise' }],
  ['workout_sessions', { user_id: 'owner', started_at: NOW }],
  ['workout_session_exercises', { session_id: 'parent', exercise_id: 'exercise' }],
  ['workout_session_sets', { session_exercise_id: 'parent-exercise' }],
  ['workout_session_events', { session_id: 'parent', created_at: NOW, type: 'session_started' }],
];

function seed(table: SyncTableName, fields: Record<string, string | number>): void {
  // Independent persisted parent ownership, never inferred from queue JSON.
  sqlite.prepare('INSERT INTO workout_sessions (id, user_id, started_at, synced) VALUES (?, ?, ?, 1)')
    .run('parent', 'owner', NOW);
  sqlite.prepare('INSERT INTO workout_session_exercises (id, session_id, exercise_id, synced) VALUES (?, ?, ?, 1)')
    .run('parent-exercise', 'parent', 'exercise');
  const row = { id: 'record', synced: 0, ...(table === 'workout_session_events' ? {} : { updated_at: NOW }), ...fields };
  sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`)
    .run(...Object.values(row));
}

test.each(cases)('%s has one retry owner across the complete upload pass', async (table, fields) => {
  seed(table, fields);
  await localDB.addToSyncQueue(table, 'upsert', 'record', { id: 'record', ...fields });
  sqlite.prepare('UPDATE sync_queue SET retry_count = 8, next_retry_at = ?').run(DUE);
  const [original] = await localDB.getSyncQueue();

  await syncService.syncToSupabase();
  expect(mockWrites).toEqual([]);
  expect(await localDB.getSyncQueue()).toEqual([original]);

  jest.setSystemTime(new Date(DUE));
  await syncService.syncToSupabase();
  expect(mockWrites).toEqual([{ table, operation: 'upsert' }]);
  const [failed] = await localDB.getSyncQueue();
  expect(failed).toEqual({ ...original, retry_count: 9, next_retry_at: '2026-10-03T12:02:00.000Z' });
  expect(sqlite.prepare(`SELECT synced FROM ${table} WHERE id = ?`).get('record')).toEqual({ synced: 0 });
  expect(syncService.getSyncStatus().state).toBe('error');

  await syncService.syncToSupabase();
  expect(mockWrites).toHaveLength(1);
  expect(await localDB.getSyncQueue()).toEqual([failed]);

  mockFailure = false;
  jest.setSystemTime(new Date(failed.next_retry_at!));
  await syncService.syncToSupabase();
  expect(mockWrites).toEqual([{ table, operation: 'upsert' }, { table, operation: 'upsert' }]);
  expect(await localDB.getSyncQueue()).toEqual([]);
  expect(sqlite.prepare(`SELECT synced FROM ${table} WHERE id = ?`).get('record')).toEqual({ synced: 1 });
});
