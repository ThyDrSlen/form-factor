import { DatabaseSync } from 'node:sqlite';
import { localDB, LocalHealthMetric } from '@/lib/services/database/local-db';
import { localDB as webDB } from '@/lib/services/database/local-db.web';
import { syncService } from '@/lib/services/database/sync-service';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));
jest.mock('@/lib/services/database/generic-sync', () => ({ WORKOUT_SYNC_CONFIGS: [], cleanupWorkoutSyncedDeletes: jest.fn(), downloadAllWorkoutTablesFromSupabase: jest.fn() }));
const mockGetUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: () => mockGetUser() }, from: (...args: unknown[]) => mockFrom(...args) } }));

const service = syncService as any;
const owner = 'synthetic-owner';
const oldTime = '2026-01-01T00:00:00.000Z';
const newTime = '2026-01-02T00:00:00.000Z';
const metric = (updates: Partial<LocalHealthMetric> = {}): LocalHealthMetric => ({
  id: `${owner}_2026-01-01`, user_id: owner, summary_date: '2026-01-01', steps: 9000,
  heart_rate_bpm: null, heart_rate_timestamp: null, weight_kg: null, weight_timestamp: null,
  updated_at: oldTime, synced: 0, ...updates,
});
let sqlite: DatabaseSync;
let previous: typeof localDB.db;

beforeEach(async () => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: owner } } });
  sqlite = new DatabaseSync(':memory:');
  previous = localDB.db;
  const execAsync = async (sql: string) => { sqlite.exec(sql); };
  Object.assign(localDB, { db: {
    execAsync,
    prepareAsync: async (sql: string) => {
      const statement = sqlite.prepare(sql);
      return {
        executeAsync: async (args: (string | number | null)[] = []) => statement.run(...args),
        finalizeAsync: async () => {},
      };
    },
    runAsync: async (sql: string, args: any[] = []) => sqlite.prepare(sql).run(...args),
    getAllAsync: async (sql: string, args: any[] = []) => sqlite.prepare(sql).all(...args),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      try { await execAsync('BEGIN'); await fn(); await execAsync('COMMIT'); }
      catch (e) { await execAsync('ROLLBACK'); throw e; }
    },
  } });
  await (localDB as any).createTables();
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
});
afterEach(() => { localDB.db = previous; sqlite.close(); jest.restoreAllMocks(); });

async function seed(db: typeof localDB | typeof webDB, row = metric()) {
  await db.insertHealthMetric(row);
  await db.updateHealthMetric(row.id, row);
}
function query(response: unknown) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'single', 'order', 'range', 'upsert', 'delete']) builder[method] = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown) => void) => Promise.resolve(typeof response === 'function' ? response() : response).then(resolve);
  return builder;
}

test.each(['native', 'web'] as const)('%s rejects cancelled health writes and deletes', async platform => {
  const db = platform === 'native' ? localDB : webDB;
  const existing = metric({ synced: 1 });
  await seed(db, existing);
  expect(await db.reconcileHealthMetric(metric({ steps: 9999, updated_at: newTime }), undefined, () => false)).toBe(false);
  await db.deleteSyncedHealthMetric(owner, existing.summary_date, newTime, () => false);
  expect(await db.getHealthMetricById(existing.id)).toEqual(existing);
});

test('server-newer upload applies actual values while preserving the local identity and server content time', async () => {
  await seed(localDB);
  const remote = metric({ id: 'remote-uuid', steps: 1000, updated_at: newTime });
  const builder = query({ data: remote, error: null });
  mockFrom.mockReturnValue(builder);
  await service.syncHealthMetricsToSupabase();
  expect(await localDB.getHealthMetricById(metric().id)).toEqual(metric({ steps: 1000, updated_at: newTime, synced: 1 }));
  expect(builder.select).toHaveBeenCalledWith('*');
  expect(builder.upsert).not.toHaveBeenCalled();
});

test.each(['local-newer', 'server-newer'])('%s upload cannot acknowledge a concurrent same-timestamp edit', async branch => {
  await seed(localDB);
  const response = async () => {
    await localDB.updateHealthMetric(metric().id, { steps: 9999, updated_at: oldTime });
    return { data: branch === 'server-newer' ? metric({ steps: 1, updated_at: newTime }) : null, error: null };
  };
  mockFrom.mockReturnValueOnce(query(branch === 'server-newer' ? response : { data: null, error: null }));
  mockFrom.mockReturnValue(query(response));
  await service.syncHealthMetricsToSupabase();
  expect(await localDB.getHealthMetricById(metric().id)).toEqual(metric({ steps: 9999 }));
});

test('foreign persisted rows and queues remain intact and are not uploaded', async () => {
  const foreign = metric({ user_id: 'other-owner' });
  await seed(localDB, foreign);
  await localDB.addToSyncQueue('health_metrics', 'upsert', foreign.id, foreign);
  await service.syncHealthMetricsToSupabase();
  await service.processSyncQueue();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(await localDB.getHealthMetricById(foreign.id)).toEqual(foreign);
  expect(await localDB.getSyncQueue()).toHaveLength(1);
});

test('a fetched row with the wrong owner cannot authorize a local upload', async () => {
  await seed(localDB);
  const builder = query({ data: metric({ user_id: 'other-owner' }), error: null });
  mockFrom.mockReturnValue(builder);
  await service.syncHealthMetricsToSupabase();
  expect(builder.upsert).not.toHaveBeenCalled();
  expect(await localDB.getHealthMetricById(metric().id)).toEqual(metric());
});

test('queued retry uploads the current persisted row, never its stale payload', async () => {
  await seed(localDB);
  await localDB.addToSyncQueue('health_metrics', 'upsert', metric().id, metric({ steps: 1 }));
  const builder = query({ data: null, error: null });
  mockFrom.mockReturnValue(builder);
  await service.processSyncQueue();
  expect(builder.upsert).toHaveBeenCalledWith([expect.objectContaining({ steps: 9000, user_id: owner })], { onConflict: 'user_id,summary_date' });
  expect(await localDB.getHealthMetricById(metric().id)).toEqual(metric({ synced: 1 }));
  expect(await localDB.getSyncQueue()).toHaveLength(0);
});

test('queued upload keeps a concurrent edit pending after acknowledgement', async () => {
  await seed(localDB);
  await localDB.addToSyncQueue('health_metrics', 'upsert', metric().id, metric());
  mockFrom.mockReturnValueOnce(query({ data: null, error: null }));
  mockFrom.mockReturnValue(query(async () => {
    await localDB.updateHealthMetric(metric().id, { steps: 9999, updated_at: oldTime });
    return { data: null, error: null };
  }));
  await service.processSyncQueue();
  expect(await localDB.getHealthMetricById(metric().id)).toEqual(metric({ steps: 9999 }));
  expect(await localDB.getSyncQueue()).toHaveLength(1);
});

test('orphan health queue entries cannot claim current-user ownership', async () => {
  await localDB.addToSyncQueue('health_metrics', 'upsert', metric().id, metric());
  mockFrom.mockReturnValue(query({ data: null, error: null }));
  expect(await service.processSyncQueue()).toBe(true);
  expect(mockFrom).not.toHaveBeenCalled();
  expect(await localDB.getSyncQueue()).toHaveLength(1);
});

test('full recovery downloads all Health pages by owner and preserves content timestamps', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => metric({ id: `remote-${i}`, summary_date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), synced: 1 }));
  const health = query({ data: [], error: null });
  health.range.mockImplementation((from: number, to: number) => query({ data: rows.slice(from, to + 1), error: null }));
  mockFrom.mockImplementation((table: string) => table === 'health_metrics' ? health : query({ data: [], error: null }));
  await service.downloadFromSupabase();
  expect(await localDB.getHealthMetricsCount(owner)).toBe(501);
  expect(health.eq).toHaveBeenCalledWith('user_id', owner);
  expect(health.order).toHaveBeenCalledWith('summary_date', { ascending: true });
  expect(health.range).toHaveBeenCalledWith(500, 999);
  expect(await localDB.getHealthMetricByDate(owner, rows[500].summary_date)).toEqual({ ...rows[500], id: `${owner}_${rows[500].summary_date}` });
});

test('realtime rejects a foreign row even if an old subscription delivers it', async () => {
  await service.handleRealtimeHealthMetricChange({ eventType: 'UPDATE', new: metric({ user_id: 'foreign' }), old: {} });
  expect(await localDB.getHealthMetricsCount('foreign')).toBe(0);
});

test('account switch during upload leaves the old owner snapshot pending', async () => {
  await seed(localDB);
  mockFrom.mockReturnValueOnce(query({ data: null, error: null }));
  mockFrom.mockReturnValue(query(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'replacement-owner' } } });
    return { data: null, error: null };
  }));
  await service.syncHealthMetricsToSupabase();
  expect(await localDB.getHealthMetricById(metric().id)).toEqual(metric());
});

test('UUID-only realtime deletes cannot delete a dirty legacy row', async () => {
  await seed(localDB, metric({ id: 'server-uuid' }));
  await service.handleRealtimeHealthMetricChange({ eventType: 'DELETE', new: {}, old: { id: 'server-uuid' } });
  expect(await localDB.getHealthMetricById('server-uuid')).toEqual(metric({ id: 'server-uuid' }));
});

test('full-key realtime deletes remove only the matching clean natural-key row', async () => {
  await seed(localDB, metric({ synced: 1 }));
  await service.handleRealtimeHealthMetricChange({ eventType: 'DELETE', new: {}, old: metric({ id: 'remote-uuid' }) });
  expect(await localDB.getHealthMetricById(metric().id)).toBeNull();
});

test('invalid UUID server errors do not purge pending Health data', async () => {
  await seed(localDB);
  await localDB.addToSyncQueue('health_metrics', 'upsert', metric().id, metric());
  mockFrom.mockReturnValue(query({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } }));
  expect(await service.processSyncQueue()).toBe(true);
  expect(await localDB.getHealthMetricById(metric().id)).toEqual(metric());
  expect(await localDB.getSyncQueue()).toHaveLength(1);
});

test('atomic Health import queues the preserved persisted identity', async () => {
  await seed(localDB, metric({ id: 'legacy-uuid', synced: 1 }));
  await localDB.insertHealthMetricAndQueue(metric({ steps: 1234 }));
  expect(await localDB.getHealthMetricById('legacy-uuid')).toEqual(expect.objectContaining({ steps: 1234, synced: 0 }));
  expect(await localDB.getSyncQueue()).toEqual([expect.objectContaining({ record_id: 'legacy-uuid' })]);
});

test('native remote apply remains atomic when a local edit lands at SQL dispatch', async () => {
  await seed(localDB, metric({ synced: 1 }));
  const adapter = localDB.db!;
  const original = adapter.runAsync.bind(adapter);
  jest.spyOn(adapter, 'runAsync').mockImplementationOnce(async (...args: any[]) => {
    sqlite.prepare('UPDATE health_metrics SET steps = ?, synced = 0 WHERE user_id = ?').run(9999, owner);
    return (original as any)(...args);
  });
  expect(await localDB.reconcileHealthMetric(metric({ id: 'server-uuid', steps: 1, updated_at: newTime }))).toBe(false);
  expect(await localDB.getHealthMetricById(metric().id)).toEqual(metric({ steps: 9999 }));
});

for (const [name, db] of [['sqlite', localDB], ['web', webDB]] as const) {
  test(`${name}: missing-row recovery keeps a canonical identity and remote timestamp`, async () => {
    expect(await db.reconcileHealthMetric(metric({ id: 'remote-uuid', updated_at: newTime }))).toBe(true);
    expect(await db.getHealthMetricById(metric().id)).toEqual(metric({ synced: 1, updated_at: newTime }));
  });
  test(`${name}: clean reconciliation preserves legacy identity and rejects older data`, async () => {
    await seed(db, metric({ id: 'legacy-uuid', synced: 1 }));
    expect(await db.reconcileHealthMetric(metric({ id: 'remote-uuid', steps: 1234, updated_at: newTime }))).toBe(true);
    expect(await db.reconcileHealthMetric(metric({ steps: 1 }))).toBe(false);
    expect(await db.getHealthMetricById('legacy-uuid')).toEqual(metric({ id: 'legacy-uuid', steps: 1234, synced: 1, updated_at: newTime }));
  });
  test(`${name}: snapshot reconciliation rejects same-timestamp edits and deleted rows`, async () => {
    await seed(db);
    await db.updateHealthMetric(metric().id, { steps: 9999, updated_at: oldTime });
    expect(await db.reconcileHealthMetric(metric({ updated_at: newTime }), metric())).toBe(false);
    await db.deleteHealthMetric(metric().id);
    expect(await db.reconcileHealthMetric(metric({ updated_at: newTime }), metric())).toBe(false);
    expect(await db.getHealthMetricById(metric().id)).toBeNull();
  });
  test(`${name}: remote delete cannot remove a dirty or newer clean row`, async () => {
    await seed(db);
    await db.deleteSyncedHealthMetric(owner, metric().summary_date, newTime);
    expect(await db.getHealthMetricById(metric().id)).toEqual(metric());
    await db.updateHealthMetric(metric().id, { synced: 1, updated_at: newTime });
    await db.deleteSyncedHealthMetric(owner, metric().summary_date, oldTime);
    expect(await db.getHealthMetricById(metric().id)).toEqual(metric({ synced: 1, updated_at: newTime }));
  });
  test(`${name}: local HealthKit import preserves an existing legacy identity`, async () => {
    await seed(db, metric({ id: 'legacy-uuid', synced: 1 }));
    await db.insertHealthMetric(metric({ steps: 1234 }));
    expect(await db.getHealthMetricByDate(owner, metric().summary_date)).toEqual(expect.objectContaining({ id: 'legacy-uuid', steps: 1234, synced: 0 }));
    expect(await db.getHealthMetricById(metric().id)).toBeNull();
  });
  test(`${name}: sync status does not manufacture a content timestamp`, async () => {
    await seed(db);
    await db.updateHealthMetricSyncStatus(metric().id, true);
    expect(await db.getHealthMetricById(metric().id)).toEqual(metric({ synced: 1 }));
  });

  test(`${name}: realtime server UUID cannot evict a dirty natural-key row`, async () => {
    await seed(db);
    // Drive the real service with each actual persistence implementation.
    const spy = db === webDB ? jest.spyOn(localDB, 'getHealthMetricById').mockImplementation(webDB.getHealthMetricById.bind(webDB)) : null;
    const replacements = db === webDB ? ['getHealthMetricByDate', 'insertHealthMetric', 'updateHealthMetric', 'updateHealthMetricSyncStatus', 'withTransaction', 'reconcileHealthMetric'] : [];
    for (const method of replacements) {
      if (typeof (localDB as any)[method] === 'function') jest.spyOn(localDB as any, method).mockImplementation((webDB as any)[method].bind(webDB));
    }
    jest.spyOn(service, 'scheduleConflictReconcile').mockImplementation(() => {});
    await service.handleRealtimeHealthMetricChange({ eventType: 'UPDATE', new: metric({ id: 'server-uuid', steps: 1000, updated_at: newTime }), old: {} });
    expect(await db.getHealthMetricByDate(owner, '2026-01-01')).toEqual(metric());
    spy?.mockRestore();
  });
}
