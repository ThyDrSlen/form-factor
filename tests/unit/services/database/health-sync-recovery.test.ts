import { DatabaseSync } from 'node:sqlite';
import { localDB, type LocalHealthMetric } from '@/lib/services/database/local-db';
import { syncService } from '@/lib/services/database/sync-service';

interface Query {
  table: string;
  operation: string;
  filters: Record<string, unknown>;
  range?: [number, number];
  single?: boolean;
  payload?: unknown;
}
const mockQueries: Query[] = [];
let mockRemote: LocalHealthMetric[] = [];
let mockUser: string | null = 'health-owner';
let mockBeforeResponse: ((query: Query) => Promise<void>) | undefined;
let mockError: { message: string; code: string } | null = null;
let mockAfterAuthCapture: (() => Promise<void>) | undefined;
let mockAuthError: Error | null = null;
let mockBeforePreparedWrite: (() => Promise<void>) | undefined;

jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: jest.fn(async () => {
    const user = mockUser ? { id: mockUser } : null;
    await mockAfterAuthCapture?.();
    return { data: { user }, error: mockAuthError };
  }) },
  removeChannel: jest.fn(),
  from: (table: string) => {
    const query: Query = { table, operation: 'select', filters: {} };
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { query.filters[key] = value; return builder; },
      order: () => builder,
      range: (start: number, end: number) => { query.range = [start, end]; return builder; },
      single: () => { query.single = true; return builder; },
      upsert: (payload: unknown) => { query.operation = 'upsert'; query.payload = payload; return builder; },
      delete: () => { query.operation = 'delete'; return builder; },
      then: async (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        try {
          mockQueries.push(query);
          await mockBeforeResponse?.(query);
          if (table !== 'health_metrics') return resolve({ data: query.single ? null : [], error: null });
          const matches = mockRemote.filter(row => Object.entries(query.filters).every(
            ([key, value]) => row[key as keyof LocalHealthMetric] === value,
          ));
          const data = query.single ? matches[0] ?? null : query.range
            ? matches.slice(query.range[0], query.range[1] + 1) : matches;
          return resolve({ data, error: mockError });
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
const service = syncService as unknown as {
  syncHealthMetricsToSupabase(): Promise<void>;
  processSyncQueue(): Promise<boolean>;
  handleRealtimeHealthMetricChange(payload: unknown): Promise<void>;
};
const metric = (overrides: Partial<LocalHealthMetric> = {}): LocalHealthMetric => ({
  id: 'server-uuid', user_id: 'health-owner', summary_date: '2026-10-01',
  steps: 500, heart_rate_bpm: null, heart_rate_timestamp: null,
  weight_kg: null, weight_timestamp: null, synced: 1, updated_at: '2026-10-01T12:00:00.000Z',
  ...overrides,
});
const seed = (row: LocalHealthMetric) => sqlite.prepare(
  'INSERT INTO health_metrics (id,user_id,summary_date,steps,heart_rate_bpm,heart_rate_timestamp,weight_kg,weight_timestamp,synced,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
).run(row.id,row.user_id,row.summary_date,row.steps,row.heart_rate_bpm,row.heart_rate_timestamp,row.weight_kg,row.weight_timestamp,row.synced,row.updated_at);

beforeEach(async () => {
  jest.useFakeTimers();
  mockBeforePreparedWrite = undefined;
  sqlite = new DatabaseSync(':memory:');
  previous = localDB.db;
  const prepareAsync = async (sql: string) => {
    const statement = sqlite.prepare(sql);
    await mockBeforePreparedWrite?.();
    return {
      executeAsync: async (args: (string | number | null)[] = []) => statement.run(...args),
      finalizeAsync: jest.fn(async () => {}),
    };
  };
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    prepareAsync,
    runAsync: async (sql: string, args: (string | number | null)[] = []) => {
      const statement = await prepareAsync(sql);
      try { return await statement.executeAsync(args); } finally { await statement.finalizeAsync(); }
    },
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      sqlite.exec('BEGIN');
      try { await fn(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  mockQueries.length = 0;
  mockRemote = [];
  mockUser = 'health-owner';
  mockBeforeResponse = undefined;
  mockError = null;
  mockAfterAuthCapture = undefined;
  mockAuthError = null;
});
afterEach(async () => {
  await syncService.cleanupRealtimeSync();
  localDB.db = previous;
  sqlite.close();
  jest.useRealTimers();
});

test('cleanup while the health owner check is pending prevents cache repopulation', async () => {
  mockRemote = [metric()];
  mockBeforeResponse = async query => {
    if (query.table === 'health_metrics') {
      mockAfterAuthCapture = async () => {
        mockAfterAuthCapture = undefined;
        await syncService.cleanupRealtimeSync();
      };
    }
  };
  await syncService.downloadFromSupabase();
  expect(await localDB.getHealthMetricByDate('health-owner', '2026-10-01')).toBeNull();
});

test('cleanup during native statement preparation prevents a delayed recovery write', async () => {
  mockRemote = [metric()];
  mockBeforePreparedWrite = async () => {
    mockBeforePreparedWrite = undefined;
    await syncService.cleanupRealtimeSync();
  };
  await syncService.downloadFromSupabase();
  expect(await localDB.getHealthMetricByDate('health-owner', '2026-10-01')).toBeNull();
});

test.each(['UPDATE', 'DELETE'] as const)('realtime %s is cancelled during native statement preparation', async eventType => {
  const existing = metric({ id: 'local-existing' });
  seed(existing);
  mockBeforePreparedWrite = async () => {
    mockBeforePreparedWrite = undefined;
    await syncService.cleanupRealtimeSync();
  };
  await service.handleRealtimeHealthMetricChange({ eventType, new: metric({ steps: 777 }), old: metric() });
  expect(await localDB.getHealthMetricById(existing.id)).toEqual(existing);
});

test('health owner-check failures remain visible and stop full sync', async () => {
  let authCalls = 0;
  mockAfterAuthCapture = async () => {
    mockAuthError = ++authCalls === 2 ? new Error('Auth storage unavailable') : null;
  };
  await syncService.fullSync();
  expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: 'Auth storage unavailable' });
  expect(mockQueries).toHaveLength(0);
});

test.each(['UPDATE', 'DELETE'] as const)('realtime %s cannot mutate after cleanup during auth', async eventType => {
  seed(metric({ id: 'local-existing' }));
  mockAfterAuthCapture = async () => {
    mockAfterAuthCapture = undefined;
    await syncService.cleanupRealtimeSync();
  };
  await service.handleRealtimeHealthMetricChange({
    eventType, new: metric({ steps: 777 }), old: metric(),
  });
  expect(await localDB.getHealthMetricById('local-existing')).toEqual(metric({ id: 'local-existing' }));
});

test('health upload cannot apply server content after cleanup during its owner check', async () => {
  const pending = metric({ id: 'local-pending', synced: 0, steps: 123 });
  seed(pending);
  mockRemote = [metric({ steps: 777, updated_at: '2026-10-02T12:00:00.000Z' })];
  mockBeforeResponse = async query => {
    if (query.table === 'health_metrics') {
      mockAfterAuthCapture = async () => {
        mockAfterAuthCapture = undefined;
        await syncService.cleanupRealtimeSync();
      };
    }
  };
  await service.syncHealthMetricsToSupabase();
  expect(await localDB.getHealthMetricById(pending.id)).toEqual(pending);
});

test('recovery download includes health metrics and preserves server content timestamps', async () => {
  mockRemote = [metric()];
  await syncService.downloadFromSupabase();
  expect(await localDB.getHealthMetricByDate('health-owner', '2026-10-01')).toMatchObject({
    steps: 500, synced: 1, updated_at: metric().updated_at,
  });
  expect(mockQueries.filter(q => q.table === 'health_metrics')).toEqual([
    expect.objectContaining({ filters: { user_id: 'health-owner' }, range: [0, 499] }),
  ]);
});

test('recovery pages beyond one server page without losing dirty local data', async () => {
  mockRemote = Array.from({ length: 501 }, (_, index) => metric({
    id: `remote-${index}`, summary_date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  }));
  const pending = { ...mockRemote[0], id: 'local-pending', synced: 0, steps: 999 };
  seed(pending);
  await localDB.addToSyncQueue('health_metrics', 'upsert', pending.id, pending);
  await syncService.downloadFromSupabase();
  expect(await localDB.getHealthMetricById(pending.id)).toEqual(pending);
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM health_metrics').get()).toEqual({ count: 501 });
  expect(await localDB.getSyncQueue()).toHaveLength(1);
  expect(mockQueries.filter(q => q.table === 'health_metrics').map(q => q.range)).toEqual([[0, 499], [500, 999]]);
});

test('recovery never treats an unauthenticated empty result as server deletions', async () => {
  seed(metric({ id: 'existing-health' }));
  mockUser = null;
  await syncService.downloadFromSupabase();
  expect(mockQueries).toHaveLength(0);
  expect(await localDB.getHealthMetricById('existing-health')).not.toBeNull();
});

test('realtime server UUID preserves a dirty natural-key local row and its queue', async () => {
  const pending = metric({ id: 'health-owner_2026-10-01', synced: 0, steps: 999 });
  seed(pending);
  await localDB.addToSyncQueue('health_metrics', 'upsert', pending.id, pending);
  await service.handleRealtimeHealthMetricChange({ eventType: 'UPDATE', new: metric(), old: {} });
  expect(await localDB.getHealthMetricById(pending.id)).toEqual(pending);
  expect((await localDB.getSyncQueue())[0].record_id).toBe(pending.id);
});

test('server-wins upload applies remote values without changing the local ID', async () => {
  const pending = metric({ id: 'legacy-local-id', synced: 0, steps: 123 });
  seed(pending);
  mockRemote = [metric({ steps: 777, updated_at: '2026-10-02T12:00:00.000Z' })];
  await service.syncHealthMetricsToSupabase();
  expect(await localDB.getHealthMetricById(pending.id)).toEqual({ ...pending, steps: 777, synced: 1, updated_at: mockRemote[0].updated_at });
  expect(mockQueries.filter(q => q.operation === 'upsert')).toHaveLength(0);
});

test('an edit during upload stays unsynced even when it shares the submitted timestamp', async () => {
  const pending = metric({ id: 'local-id', synced: 0, steps: 123 });
  seed(pending);
  mockBeforeResponse = async query => {
    if (query.operation === 'upsert') await localDB.updateHealthMetric(pending.id, { steps: 456 });
  };
  await service.syncHealthMetricsToSupabase();
  expect(await localDB.getHealthMetricById(pending.id)).toEqual({ ...pending, steps: 456 });
});

test('health queue retries load the current row instead of replaying stale JSON', async () => {
  const pending = metric({ id: 'local-id', synced: 0, steps: 456 });
  seed(pending);
  await localDB.addToSyncQueue('health_metrics', 'upsert', pending.id, { ...pending, steps: 123 });
  await service.processSyncQueue();
  expect(mockQueries.find(q => q.operation === 'upsert')?.payload).toEqual([
    expect.objectContaining({ steps: 456, user_id: pending.user_id }),
  ]);
  expect(await localDB.getHealthMetricById(pending.id)).toMatchObject({ steps: 456, synced: 1, updated_at: pending.updated_at });
  expect(await localDB.getSyncQueue()).toHaveLength(0);
});

test('health queue retry trusts persisted ownership instead of a stale payload owner', async () => {
  const pending = metric({ id: 'local-id', synced: 0, steps: 456 });
  seed(pending);
  await localDB.addToSyncQueue('health_metrics', 'upsert', pending.id, {
    ...pending, user_id: 'stale-owner', steps: 123,
  });

  await service.syncHealthMetricsToSupabase();
  expect(mockQueries).toHaveLength(0);
  expect(await service.processSyncQueue()).toBe(false);

  expect(mockQueries.find(q => q.operation === 'upsert')?.payload).toEqual([
    expect.objectContaining({ steps: 456, user_id: pending.user_id }),
  ]);
  expect(await localDB.getHealthMetricById(pending.id)).toEqual({ ...pending, synced: 1 });
  expect(await localDB.getSyncQueue()).toHaveLength(0);
});

test('health queue payload cannot authorize a foreign persisted row', async () => {
  const pending = metric({ user_id: 'another-owner', id: 'another-id', synced: 0 });
  seed(pending);
  await localDB.addToSyncQueue('health_metrics', 'upsert', pending.id, {
    ...pending, user_id: 'health-owner',
  });
  const queue = await localDB.getSyncQueue();

  await service.processSyncQueue();

  expect(mockQueries).toHaveLength(0);
  expect(await localDB.getHealthMetricById(pending.id)).toEqual(pending);
  expect(await localDB.getSyncQueue()).toEqual(queue);
});

test('sync preserves another account\'s pending health rows and queue', async () => {
  const pending = metric({ user_id: 'another-owner', id: 'another-id', synced: 0 });
  seed(pending);
  await localDB.addToSyncQueue('health_metrics', 'upsert', pending.id, pending);
  await service.syncHealthMetricsToSupabase();
  await service.processSyncQueue();
  expect(mockQueries).toHaveLength(0);
  expect(await localDB.getHealthMetricById(pending.id)).toEqual(pending);
  expect(await localDB.getSyncQueue()).toHaveLength(1);
});
