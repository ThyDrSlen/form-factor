import { syncTableToSupabase, WORKOUT_SYNC_CONFIGS } from '@/lib/services/database/generic-sync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDeferredSyncRecordIds } from '@/lib/services/database/sync-retry-policy';
import { localDB } from '@/lib/services/database/local-db';
import { supabase } from '@/lib/supabase';
import { errorWithTs } from '@/lib/logger';
import type { SyncQueueItem } from '@/lib/services/database/sync-types';

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    db: {
      getAllAsync: jest.fn(), runAsync: jest.fn(),
      async prepareAsync(sql: string) {
        const db = this;
        return {
          executeAsync: async (args: unknown[]) => db.runAsync(sql, args),
          finalizeAsync: async () => {},
        };
      },
    },
    getSyncQueue: jest.fn(),
    addToSyncQueue: jest.fn(),
    removeSyncQueueItem: jest.fn(),
    incrementSyncQueueRetry: jest.fn(),
    clearSyncQueue: jest.fn(),
    withTransaction: jest.fn(),
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));
jest.mock('@/lib/services/ErrorHandler', () => ({ createError: jest.fn(), logError: jest.fn() }));

const NOW = '2026-10-03T12:00:00.000Z';
const FUTURE = '2026-10-03T12:01:00.000Z';
const PAST = '2026-10-03T11:59:00.000Z';
const mockQueue = jest.mocked(localDB.getSyncQueue);
const mockFrom = jest.mocked(supabase.from);

function queueItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: 1,
    table_name: 'workout_sessions',
    record_id: 'session-1',
    operation: 'upsert',
    data: '{}',
    created_at: PAST,
    retry_count: 3,
    next_retry_at: FUTURE,
    ...overrides,
  };
}

function expectNoQueueWrites(): void {
  expect(localDB.addToSyncQueue).not.toHaveBeenCalled();
  expect(localDB.removeSyncQueueItem).not.toHaveBeenCalled();
  expect(localDB.incrementSyncQueueRetry).not.toHaveBeenCalled();
  expect(localDB.clearSyncQueue).not.toHaveBeenCalled();
  expect(localDB.withTransaction).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.resetAllMocks();
  // The real storage API returns null for an absent cleanup marker.
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
  mockQueue.mockResolvedValue([]);
  jest.mocked(localDB.db!.runAsync).mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
});

afterEach(() => jest.useRealTimers());

describe('getDeferredSyncRecordIds', () => {
  it.each([
    ['future retry', FUTURE, PAST, true],
    ['expired retry', PAST, FUTURE, false],
    ['retry due now', NOW, FUTURE, false],
    ['null retry with future creation', null, FUTURE, true],
    ['missing legacy retry with future creation', undefined, FUTURE, true],
    ['null retry with past creation', null, PAST, false],
    ['invalid retry does not fall back to future creation', 'invalid', FUTURE, false],
    ['empty retry does not fall back to future creation', '', FUTURE, false],
    ['invalid creation fallback', null, 'invalid', false],
  ])('handles %s without changing the queue', async (_label, nextRetryAt, createdAt, deferred) => {
    const item = queueItem({ next_retry_at: nextRetryAt as string | null, created_at: createdAt as string });
    const queue = [Object.freeze(item)];
    Object.freeze(queue);
    mockQueue.mockResolvedValue(queue);

    expect(await getDeferredSyncRecordIds('workout_sessions')).toEqual(new Set(deferred ? [item.record_id] : []));
    expectNoQueueWrites();
    expect(localDB.db!.runAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('scopes duplicate record IDs to the requested table', async () => {
    mockQueue.mockResolvedValue([
      queueItem({ id: 1, record_id: 'same-id', next_retry_at: PAST }),
      queueItem({ id: 2, record_id: 'same-id', table_name: 'health_metrics' }),
      queueItem({ id: 3, record_id: 'workout-only' }),
    ]);

    expect(await getDeferredSyncRecordIds('workout_sessions')).toEqual(new Set(['workout-only']));
    expect(await getDeferredSyncRecordIds('health_metrics')).toEqual(new Set(['same-id']));
    expect(await getDeferredSyncRecordIds('foods')).toEqual(new Set());
    expectNoQueueWrites();
  });

  it('allows a malformed newest deadline even when an older retry was deferred', async () => {
    mockQueue.mockResolvedValue([
      queueItem({ id: 2, next_retry_at: 'invalid' }),
      queueItem({ id: 1 }),
    ]);
    expect(await getDeferredSyncRecordIds('workout_sessions')).toEqual(new Set());
    expectNoQueueWrites();
  });

  it('uses the newest queue ID per record, not queue order or creation time', async () => {
    const queue = [
      queueItem({ id: 8, record_id: 'ready', next_retry_at: PAST }),
      queueItem({ id: 6, record_id: 'deferred', next_retry_at: PAST, created_at: NOW }),
      queueItem({ id: 9, record_id: 'deferred', next_retry_at: FUTURE, created_at: PAST }),
      queueItem({ id: 7, record_id: 'ready', next_retry_at: FUTURE }),
    ];
    queue.forEach(Object.freeze);
    Object.freeze(queue);
    mockQueue.mockResolvedValue(queue);

    expect(await getDeferredSyncRecordIds('workout_sessions')).toEqual(new Set(['deferred']));
    expect(mockQueue).toHaveBeenCalledTimes(1);
    expect(queue.map(item => item.id)).toEqual([8, 6, 9, 7]);
    expectNoQueueWrites();
    expect(localDB.db!.runAsync).not.toHaveBeenCalled();
  });
});

it('leaves queued workout retries to the queue worker even when due, but uploads unqueued rows', async () => {
  const row = Object.freeze({
    id: 'session-1', user_id: 'user-1', name: 'Local workout',
    synced: 0, deleted: 0, updated_at: PAST,
  });
  const queue = [Object.freeze(queueItem())];
  Object.freeze(queue);
  mockQueue.mockResolvedValue(queue);
  jest.mocked(localDB.db!.getAllAsync).mockImplementation(async (sql, params) => {
    if (sql === 'SELECT * FROM workout_sessions WHERE synced = 0') return [row];
    if (sql === 'SELECT ws.user_id FROM workout_sessions ws WHERE ws.id = ?'
      && JSON.stringify(params) === JSON.stringify(['session-1'])) return [{ user_id: 'user-1' }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const single = jest.fn().mockResolvedValue({ data: null, error: null });
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const eq = jest.fn().mockReturnValue({ single });
  mockFrom.mockReturnValue({ select: jest.fn().mockReturnValue({ eq }), upsert } as never);
  const config = WORKOUT_SYNC_CONFIGS.find(config => config.localTable === 'workout_sessions')!;

  await syncTableToSupabase(config, 'user-1');
  await syncTableToSupabase(config, 'user-1');

  expect(mockFrom).not.toHaveBeenCalled();
  expect(localDB.db!.runAsync).not.toHaveBeenCalled();
  expectNoQueueWrites();
  expect(queue).toEqual([queueItem()]);
  expect(row.synced).toBe(0);

  jest.setSystemTime(new Date(FUTURE));
  expect(Date.now()).toBe(new Date(FUTURE).getTime());
  await syncTableToSupabase(config, 'user-1');

  expect(errorWithTs).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(localDB.db!.runAsync).not.toHaveBeenCalled();
  expectNoQueueWrites();
  expect(queue).toEqual([queueItem()]);

  // This adapter only owns first attempts. Complete queued retry behavior is
  // exercised with real SQLite by sync-retry-integration.test.ts.
  mockQueue.mockResolvedValue([]);
  await syncTableToSupabase(config, 'user-1');
  expect(mockFrom.mock.calls).toEqual([['workout_sessions'], ['workout_sessions']]);
  expect(upsert).toHaveBeenCalledTimes(1);
  expect(upsert).toHaveBeenCalledWith([{ id: row.id, name: row.name, user_id: 'user-1', updated_at: PAST }], undefined);
  expect(localDB.db!.runAsync).toHaveBeenCalledTimes(1);
  expect(localDB.db!.runAsync).toHaveBeenCalledWith(
    'UPDATE workout_sessions SET synced = ? WHERE id = ? AND "id" IS ? AND "user_id" IS ? AND "name" IS ? AND "synced" IS ? AND "deleted" IS ? AND "updated_at" IS ?',
    [1, row.id, row.id, 'user-1', 'Local workout', 0, 0, PAST],
  );
  expectNoQueueWrites();
  expect(queue).toEqual([queueItem()]);
});
