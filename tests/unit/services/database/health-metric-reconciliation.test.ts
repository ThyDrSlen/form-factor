/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB as nativeDB, type LocalHealthMetric } from '@/lib/services/database/local-db';
import { localDB as webDB } from '@/lib/services/database/local-db.web';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

const capturedAt = '2026-10-01T10:00:00.000Z';
const remoteAt = '2026-10-01T11:00:00.000Z';
const metric = (overrides: Partial<LocalHealthMetric> = {}): LocalHealthMetric => ({
  id: 'legacy-local-id', user_id: 'test-owner', summary_date: '2026-10-01',
  steps: 100, heart_rate_bpm: 60, heart_rate_timestamp: capturedAt,
  weight_kg: 70, weight_timestamp: capturedAt, synced: 0, updated_at: capturedAt,
  ...overrides,
});
const remote = (overrides: Partial<LocalHealthMetric> = {}) => metric({
  id: 'server-uuid', steps: 900, heart_rate_bpm: 65, heart_rate_timestamp: remoteAt,
  weight_kg: null, weight_timestamp: null, synced: 1, updated_at: remoteAt, ...overrides,
});

type Bind = string | number | null;
let sqlite: DatabaseSync;
let previousDB: typeof nativeDB.db;
let previousStorage: PropertyDescriptor | undefined;
let beforeWrite: (() => void) | undefined;
const storage = new Map<string, string>();

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  previousDB = nativeDB.db;
  beforeWrite = undefined;
  const execAsync = async (sql: string) => { sqlite.exec(sql); };
  Object.assign(nativeDB, { db: {
    execAsync,
    runAsync: async (sql: string, args: Bind[] = []) => {
      const hook = beforeWrite;
      beforeWrite = undefined;
      hook?.();
      return sqlite.prepare(sql).run(...args);
    },
    getAllAsync: async (sql: string, args: Bind[] = []) => sqlite.prepare(sql).all(...args),
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
  // Execute production schema/migrations rather than a permissive test schema.
  await (nativeDB as unknown as { createTables(): Promise<void> }).createTables();
  storage.clear();
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
});

afterEach(() => {
  nativeDB.db = previousDB;
  sqlite.close();
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function seed(platform: string, ...rows: LocalHealthMetric[]) {
  if (platform === 'web') {
    storage.set('formfactor_health_metrics', JSON.stringify(rows));
  } else {
    for (const row of rows) {
      sqlite.prepare(`INSERT INTO health_metrics
        (id, user_id, summary_date, steps, heart_rate_bpm, heart_rate_timestamp, weight_kg, weight_timestamp, synced, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.user_id, row.summary_date, row.steps, row.heart_rate_bpm,
        row.heart_rate_timestamp, row.weight_kg, row.weight_timestamp, row.synced, row.updated_at,
      );
    }
  }
}

describe.each([['native', nativeDB], ['web', webDB]] as const)('%s Health reconciliation', (platform, db) => {
  test('acknowledging an older upload does not mark a concurrent edit synced', async () => {
    const edited = metric({ updated_at: remoteAt, steps: 800 });
    seed(platform, edited);
    await db.updateHealthMetricSyncStatus(edited.id, true, capturedAt);
    expect(await db.getHealthMetricById(edited.id)).toEqual(edited);
  });

  test.each([undefined, capturedAt])('sync flag changes preserve content timestamp (guard %s)', async expectedAt => {
    const local = metric();
    seed(platform, local);
    await db.updateHealthMetricSyncStatus(local.id, true, expectedAt);
    expect(await db.getHealthMetricById(local.id)).toEqual({ ...local, synced: 1 });
    await db.updateHealthMetricSyncStatus(local.id, false, expectedAt);
    expect(await db.getHealthMetricById(local.id)).toEqual(local);
  });

  test.each([0, 1])('captured upload cannot overwrite a changed version (synced=%s)', async synced => {
    const edited = metric({ updated_at: '2026-10-01T10:30:00.000Z', steps: 800, synced });
    seed(platform, edited);
    expect(await db.reconcileHealthMetric(remote(), capturedAt)).toBe(false);
    expect(await db.getHealthMetricById(edited.id)).toEqual(edited);
  });

  test('captured upload cannot resurrect a removed row', async () => {
    expect(await db.reconcileHealthMetric(remote(), capturedAt)).toBe(false);
    expect(await db.getHealthMetricByDate('test-owner', '2026-10-01')).toBeNull();
  });

  test('captured upload rejects older remote content', async () => {
    const local = metric();
    seed(platform, local);
    expect(await db.reconcileHealthMetric(remote({ updated_at: '2026-10-01T09:59:59.999Z' }), capturedAt)).toBe(false);
    expect(await db.getHealthMetricById(local.id)).toEqual(local);
  });

  test('the preserved snapshot overload also rejects older remote content', async () => {
    const local = metric();
    seed(platform, local);
    expect(await db.reconcileHealthMetric(remote({ updated_at: '2026-10-01T09:59:59.999Z' }), local)).toBe(false);
    expect(await db.getHealthMetricById(local.id)).toEqual(local);
  });

  test('captured upload accepts equal remote timestamps', async () => {
    seed(platform, metric());
    expect(await db.reconcileHealthMetric(remote({ updated_at: capturedAt }), capturedAt)).toBe(true);
    expect(await db.getHealthMetricById('legacy-local-id')).toEqual(remote({ id: 'legacy-local-id', updated_at: capturedAt }));
  });

  test('ordinary ingestion inserts a stable natural-key ID and retains remote timestamp', async () => {
    expect(await db.reconcileHealthMetric(remote())).toBe(true);
    expect(await db.getHealthMetricByDate('test-owner', '2026-10-01')).toEqual(remote({ id: 'test-owner_2026-10-01' }));
  });

  test.each([
    metric(),
    metric({ synced: 1, updated_at: '2026-10-01T12:00:00.000Z' }),
  ])('ordinary ingestion preserves unsynced or newer synced content: %j', async local => {
    seed(platform, local);
    expect(await db.reconcileHealthMetric(remote())).toBe(false);
    expect(await db.getHealthMetricById(local.id)).toEqual(local);
  });

  test.each([capturedAt, remoteAt])('ordinary ingestion preserves existing legacy identity (timestamp %s)', async updatedAt => {
    seed(platform, metric({ synced: 1, updated_at: updatedAt }));
    await db.addToSyncQueue('health_metrics', 'upsert', 'legacy-local-id');
    const queue = await db.getSyncQueue();
    expect(await db.reconcileHealthMetric(remote())).toBe(true);
    expect(await db.getHealthMetricById('legacy-local-id')).toEqual(remote({ id: 'legacy-local-id' }));
    expect(await db.getSyncQueue()).toEqual(queue);
  });

  test('natural keys isolate users and dates even when remote IDs match existing local IDs', async () => {
    const local = metric({ synced: 1 });
    seed(platform, local);
    expect(await db.reconcileHealthMetric(remote({ id: local.id, user_id: 'other-owner' }))).toBe(true);
    expect(await db.reconcileHealthMetric(remote({ id: local.id, summary_date: '2026-10-02' }))).toBe(true);
    expect(await db.getHealthMetricById(local.id)).toEqual(local);
  });

  test('server-wins applies captured unsynced content without changing local identity or queue references', async () => {
    seed(platform, metric());
    await db.addToSyncQueue('health_metrics', 'upsert', 'legacy-local-id', { steps: 100 });
    const queue = await db.getSyncQueue();
    expect(await db.reconcileHealthMetric(remote(), capturedAt)).toBe(true);
    expect(await db.getHealthMetricByDate('test-owner', '2026-10-01')).toEqual(remote({ id: 'legacy-local-id' }));
    expect(await db.getSyncQueue()).toEqual(queue);
    expect(await db.getHealthMetricById('server-uuid')).toBeNull();
  });
});

describe('native SQL write-boundary guards', () => {
  test.each([undefined, capturedAt])('a local edit at the write boundary survives ingestion (guard %s)', async expectedAt => {
    seed('native', metric({ synced: expectedAt === undefined ? 1 : 0 }));
    beforeWrite = () => {
      sqlite.prepare('UPDATE health_metrics SET steps = 777, synced = 0, updated_at = ? WHERE id = ?')
        .run('2026-10-01T10:30:00.000Z', 'legacy-local-id');
    };
    expect(await nativeDB.reconcileHealthMetric(remote(), expectedAt)).toBe(false);
    expect(await nativeDB.getHealthMetricById('legacy-local-id')).toEqual(metric({
      steps: 777, updated_at: '2026-10-01T10:30:00.000Z',
    }));
  });

  test('a newer synced row at the write boundary survives ordinary ingestion', async () => {
    seed('native', metric({ synced: 1 }));
    beforeWrite = () => {
      sqlite.prepare('UPDATE health_metrics SET steps = 888, updated_at = ? WHERE id = ?')
        .run('2026-10-01T12:00:00.000Z', 'legacy-local-id');
    };
    expect(await nativeDB.reconcileHealthMetric(remote())).toBe(false);
    expect(await nativeDB.getHealthMetricById('legacy-local-id')).toEqual(metric({
      steps: 888, synced: 1, updated_at: '2026-10-01T12:00:00.000Z',
    }));
  });

  test('a local edit at the write boundary survives acknowledgement', async () => {
    seed('native', metric());
    beforeWrite = () => {
      sqlite.prepare('UPDATE health_metrics SET steps = 777, updated_at = ? WHERE id = ?')
        .run(remoteAt, 'legacy-local-id');
    };
    await nativeDB.updateHealthMetricSyncStatus('legacy-local-id', true, capturedAt);
    expect(await nativeDB.getHealthMetricById('legacy-local-id')).toEqual(metric({ steps: 777, updated_at: remoteAt }));
  });

  test('reconciliation runs inside serialized caller transactions without nesting or deadlock', async () => {
    seed('native', metric());
    const applied: boolean[] = [];
    await Promise.all([
      nativeDB.withTransaction(async () => {
        applied.push(await nativeDB.reconcileHealthMetric(remote(), capturedAt));
        await nativeDB.updateHealthMetricSyncStatus('legacy-local-id', true, remoteAt);
      }),
      nativeDB.withTransaction(async () => {
        applied.push(await nativeDB.reconcileHealthMetric(remote({ summary_date: '2026-10-02' })));
      }),
    ]);
    expect(applied).toEqual([true, true]);
    expect(await nativeDB.getHealthMetricsCount('test-owner')).toBe(2);
  });
});
