import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn() }));

let sqlite: DatabaseSync;
let previous: typeof localDB.db;

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  previous = localDB.db;
  const execAsync = async (sql: string) => { sqlite.exec(sql); };
  Object.assign(localDB, { db: {
    execAsync,
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
    // Match expo-sqlite's BEGIN/COMMIT/ROLLBACK and asynchronous scheduling.
    withTransactionAsync: async (task: () => Promise<void>) => {
      try {
        await execAsync('BEGIN');
        await task();
        await execAsync('COMMIT');
      } catch (error) {
        await execAsync('ROLLBACK');
        throw error;
      }
    },
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
});

afterEach(() => {
  localDB.db = previous;
  sqlite.close();
});

const metric = (id: string) => ({
  id,
  user_id: 'test-owner',
  summary_date: id,
  steps: 100,
  heart_rate_bpm: null,
  heart_rate_timestamp: null,
  weight_kg: null,
  weight_timestamp: null,
});

test('concurrent realtime health inserts each commit without nested transactions', async () => {
  const results = await Promise.allSettled(['2026-10-01', '2026-10-02', '2026-10-03'].map(id =>
    localDB.withTransaction(async () => {
      await localDB.insertHealthMetric(metric(id));
      await localDB.updateHealthMetricSyncStatus(id, true);
    }),
  ));
  expect(results).toEqual(Array.from({ length: 3 }, () => ({ status: 'fulfilled', value: undefined })));
  expect(sqlite.prepare('SELECT id, synced FROM health_metrics ORDER BY id').all()).toEqual([
    { id: '2026-10-01', synced: 1 },
    { id: '2026-10-02', synced: 1 },
    { id: '2026-10-03', synced: 1 },
  ]);
});

test('a failed transaction rolls back only its own work and does not poison the queue', async () => {
  const failure = new Error('Intentional transaction failure');
  const results = await Promise.allSettled([
    localDB.withTransaction(async () => {
      await localDB.insertHealthMetric(metric('2026-10-01'));
      throw failure;
    }),
    localDB.withTransaction(async () => {
      await localDB.insertHealthMetric(metric('2026-10-02'));
      await localDB.updateHealthMetricSyncStatus('2026-10-02', true);
    }),
  ]);
  expect(results).toEqual([
    { status: 'rejected', reason: failure },
    { status: 'fulfilled', value: undefined },
  ]);
  expect(sqlite.prepare('SELECT id, synced FROM health_metrics').all()).toEqual([
    { id: '2026-10-02', synced: 1 },
  ]);
});

test('local health writes and queue cleanup share the realtime transaction boundary', async () => {
  const results = await Promise.allSettled([
    localDB.withTransaction(async () => {
      await localDB.insertHealthMetric(metric('2026-10-01'));
      await localDB.updateHealthMetricSyncStatus('2026-10-01', true);
    }),
    localDB.insertHealthMetricAndQueue(metric('2026-10-02')),
    localDB.addToSyncQueue('health_metrics', 'upsert', '2026-10-03'),
    localDB.cleanupSyncedDeletes(),
  ]);
  expect(results).toEqual(Array.from({ length: 4 }, () => ({ status: 'fulfilled', value: undefined })));
  expect(sqlite.prepare('SELECT id, synced FROM health_metrics ORDER BY id').all()).toEqual([
    { id: '2026-10-01', synced: 1 },
    { id: '2026-10-02', synced: 0 },
  ]);
  expect(sqlite.prepare('SELECT record_id FROM sync_queue ORDER BY record_id').all()).toEqual([
    { record_id: '2026-10-02' },
    { record_id: '2026-10-03' },
  ]);
});
