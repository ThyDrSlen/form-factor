import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACCOUNT_CLEANUP_KEY, accountCleanup } from '@/lib/services/database/account-cleanup';
import { syncService } from '@/lib/services/database/sync-service';

const mockDatabase = {
  supportsWorkoutSync: true,
  getUnsyncedHealthMetrics: jest.fn(), getUnsyncedNutritionGoals: jest.fn(),
  getHealthMetricById: jest.fn(), getNutritionGoalsById: jest.fn(),
  getSyncQueue: jest.fn(), removeSyncQueueItem: jest.fn(), incrementSyncQueueRetry: jest.fn(),
  addToSyncQueue: jest.fn(), clearSyncQueue: jest.fn(), countSyncQueueItems: jest.fn(),
  reconcileHealthMetric: jest.fn(), reconcileNutritionGoals: jest.fn(), withTransaction: jest.fn(),
};
const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockGenericRead = jest.fn();
const mockGenericUpload = jest.fn();
const mockRemoveChannel = jest.fn();
jest.mock('@/lib/services/database/local-db', () => ({ get localDB() { return mockDatabase; } }));
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
  from: (...args: unknown[]) => mockFrom(...args),
  removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
} }));
jest.mock('@/lib/services/database/generic-sync', () => ({
  WORKOUT_SYNC_CONFIGS: [{ localTable: 'workout_sessions', primaryKey: 'id' }],
  genericGetById: (...args: unknown[]) => mockGenericRead(...args),
  syncWorkoutRowToSupabase: (...args: unknown[]) => mockGenericUpload(...args),
}));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

const metric = {
  id: 'owner_2026-10-01', user_id: 'owner', summary_date: '2026-10-01', steps: 100,
  heart_rate_bpm: null, heart_rate_timestamp: null, weight_kg: null, weight_timestamp: null,
  synced: 0, updated_at: '2026-10-01T12:00:00.000Z',
};
const goals = {
  id: 'goals-1', user_id: 'owner', calories_goal: 2000, protein_goal: 100,
  carbs_goal: 250, fat_goal: 60, synced: 0, updated_at: metric.updated_at,
};
const identity = { data: { user: { id: 'owner' } }, error: null };
// Use a structural interface because the exercised entry points are private.
type Service = Omit<typeof syncService, never> & {
  syncHealthMetricsToSupabase(): Promise<void>;
  syncNutritionGoalsToSupabase(): Promise<void>;
  processSyncQueue(): Promise<boolean>;
};
let service: Service;
let storage: Map<string, string>;
let query: { select: jest.Mock; eq: jest.Mock; single: jest.Mock; upsert: jest.Mock; delete: jest.Mock };

function pause(mock: jest.Mock) {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
  mock.mockImplementationOnce(() => { entered(); return pending; });
  return { started, resolve, reject };
}

beforeEach(async () => {
  jest.resetAllMocks();
  storage = new Map();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => storage.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { storage.set(key, value); });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { storage.delete(key); });
  await accountCleanup.run(async () => {});
  service = new (syncService.constructor as { new(): Service })();
  mockGetUser.mockResolvedValue(identity);
  mockDatabase.getUnsyncedHealthMetrics.mockResolvedValue([metric]);
  mockDatabase.getUnsyncedNutritionGoals.mockResolvedValue([goals]);
  mockDatabase.getHealthMetricById.mockResolvedValue(metric);
  mockDatabase.getNutritionGoalsById.mockResolvedValue(goals);
  mockDatabase.getSyncQueue.mockResolvedValue([]);
  mockDatabase.countSyncQueueItems.mockResolvedValue(0);
  mockDatabase.reconcileHealthMetric.mockResolvedValue(true);
  mockDatabase.reconcileNutritionGoals.mockResolvedValue(true);
  mockDatabase.withTransaction.mockImplementation(async (callback: () => Promise<void>) => callback());
  mockGenericRead.mockResolvedValue({ id: 'session-1', user_id: 'owner', synced: 0 });
  mockGenericUpload.mockResolvedValue(undefined);
  query = {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), delete: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
  };
  mockFrom.mockReturnValue(query);
});

const uploads = [
  ['health', 'syncHealthMetricsToSupabase', 'getUnsyncedHealthMetrics', metric],
  ['nutrition', 'syncNutritionGoalsToSupabase', 'getUnsyncedNutritionGoals', goals],
] as const;

test.each(uploads)('%s loop retires after a paused local read', async (_label, method, read, row) => {
  const gate = pause(mockDatabase[read]);
  const work = service[method]();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve([row]);
  await work;
  expect(mockGetUser).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockDatabase.addToSyncQueue).not.toHaveBeenCalled();
});

test.each(uploads)('%s loop treats returned auth errors as failures, not authorization', async (_label, method) => {
  const error = new Error('auth unavailable');
  mockGetUser.mockResolvedValue({ ...identity, error });
  await expect(service[method]()).rejects.toBe(error);
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockDatabase.addToSyncQueue).not.toHaveBeenCalled();
});

test.each(uploads)('%s loop cannot upload after cleanup during its queue read', async (_label, method) => {
  const gate = pause(mockDatabase.getSyncQueue);
  const work = service[method]();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve([]);
  await work;
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockDatabase.addToSyncQueue).not.toHaveBeenCalled();
});

test.each(uploads)('%s loop does not enqueue a retired network failure', async (_label, method) => {
  const gate = pause(query.single);
  const work = service[method]();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.reject(new Error('old network failure'));
  await work;
  expect(mockDatabase.addToSyncQueue).not.toHaveBeenCalled();
  expect(query.upsert).not.toHaveBeenCalled();
});

function queueItem(table = 'health_metrics', id = 1, operation = 'upsert') {
  return {
    id, table_name: table, operation, record_id: table === 'health_metrics' ? metric.id : 'record-1',
    data: JSON.stringify({ user_id: 'owner' }), created_at: metric.updated_at, retry_count: 0,
  };
}

test('queue cannot deduplicate a snapshot read before cleanup', async () => {
  const gate = pause(mockDatabase.getSyncQueue);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve([queueItem('health_metrics', 1), queueItem('health_metrics', 2)]);
  await work;
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
});

test('queue stops deduplication after cleanup during a duplicate removal', async () => {
  mockDatabase.getSyncQueue.mockResolvedValue([1, 2, 3].map(id => queueItem('health_metrics', id)));
  const gate = pause(mockDatabase.removeSyncQueueItem);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve();
  await work;
  expect(mockDatabase.removeSyncQueueItem).toHaveBeenCalledTimes(1);
  expect(mockDatabase.getHealthMetricById).not.toHaveBeenCalled();
});

test('queue checks auth errors before destructive deduplication', async () => {
  const error = new Error('auth unavailable');
  mockGetUser.mockResolvedValue({ ...identity, error });
  mockDatabase.getSyncQueue.mockResolvedValue([queueItem(), queueItem('health_metrics', 2)]);
  await expect(service.processSyncQueue()).rejects.toBe(error);
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
  expect(mockDatabase.incrementSyncQueueRetry).not.toHaveBeenCalled();
});

test.each([0, 1])('health queue ignores a retired row read (synced=%s)', async synced => {
  mockDatabase.getSyncQueue.mockResolvedValue([queueItem()]);
  const gate = pause(mockDatabase.getHealthMetricById);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve({ ...metric, synced });
  await work;
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
  expect(mockDatabase.incrementSyncQueueRetry).not.toHaveBeenCalled();
});

test('health queue does not acknowledge reconciliation completed after cleanup', async () => {
  mockDatabase.getSyncQueue.mockResolvedValue([queueItem()]);
  const gate = pause(mockDatabase.reconcileHealthMetric);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve(true);
  await work;
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
});

test.each([0, 1])('generic queue ignores a retired row read (synced=%s)', async synced => {
  mockDatabase.getSyncQueue.mockResolvedValue([queueItem('workout_sessions')]);
  const gate = pause(mockGenericRead);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve({ id: 'record-1', user_id: 'owner', synced });
  await work;
  expect(mockGenericUpload).not.toHaveBeenCalled();
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
});

test.each(['resolve', 'reject'] as const)('generic queue drops a retired upload %s', async outcome => {
  mockDatabase.getSyncQueue.mockResolvedValue([queueItem('workout_sessions')]);
  const gate = pause(mockGenericUpload);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  if (outcome === 'reject') gate.reject(new Error('old upload failure'));
  else gate.resolve();
  await work;
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
  expect(mockDatabase.incrementSyncQueueRetry).not.toHaveBeenCalled();
});

test.each(['upsert', 'delete'])('fallback queue drops a retired %s response', async operation => {
  mockDatabase.getSyncQueue.mockResolvedValue([queueItem('other_table', 1, operation)]);
  const gate = pause(operation === 'upsert' ? query.upsert : query.eq);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve({ error: null });
  await work;
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
});

test('queue checks its generation inside delayed acknowledgement transactions', async () => {
  mockDatabase.getSyncQueue.mockResolvedValue([queueItem('workout_sessions')]);
  const gate = pause(mockDatabase.withTransaction);
  const work = service.processSyncQueue();
  await gate.started;
  const callback = mockDatabase.withTransaction.mock.calls[0][0];
  await accountCleanup.run(async () => {});
  await callback();
  gate.resolve();
  await work;
  expect(mockDatabase.removeSyncQueueItem).not.toHaveBeenCalled();
});

test('queue does not publish stale errors or process the next item after a paused retry', async () => {
  mockDatabase.getSyncQueue.mockResolvedValue([queueItem('workout_sessions'), queueItem('health_metrics', 2)]);
  mockGenericUpload.mockRejectedValueOnce(new Error('upload failed'));
  const gate = pause(mockDatabase.incrementSyncQueueRetry);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve();
  await work;
  expect(service.getSyncStatus()).toMatchObject({ state: 'idle', lastError: null });
  expect(mockDatabase.getHealthMetricById).not.toHaveBeenCalled();
});

test('queue does not publish a retired queue count', async () => {
  const gate = pause(mockDatabase.countSyncQueueItems);
  const work = service.processSyncQueue();
  await gate.started;
  await accountCleanup.run(async () => {});
  gate.resolve(99);
  await work;
  expect(service.getSyncStatus().queueSize).toBe(0);
});

test.each(['memory', 'persisted'])('clearSyncQueue rejects %s cleanup obligations', async source => {
  if (source === 'memory') accountCleanup.block();
  else storage.set(ACCOUNT_CLEANUP_KEY, '1');
  await expect(service.clearSyncQueue()).rejects.toThrow(/cleanup/i);
  expect(mockDatabase.clearSyncQueue).not.toHaveBeenCalled();
  expect(mockDatabase.countSyncQueueItems).not.toHaveBeenCalled();
  expect(service.getSyncStatus().state).toBe('error');
});

test('clearSyncQueue does not clear if cleanup completes during its readiness check', async () => {
  const gate = pause(jest.mocked(AsyncStorage.getItem));
  const work = service.clearSyncQueue();
  await Promise.race([gate.started, work]);
  expect(AsyncStorage.getItem).toHaveBeenCalledWith(ACCOUNT_CLEANUP_KEY);
  await accountCleanup.run(async () => {});
  gate.resolve(null);
  await work;
  expect(mockDatabase.clearSyncQueue).not.toHaveBeenCalled();
});

test.each(['clearSyncQueue', 'countSyncQueueItems'] as const)(
  'clearSyncQueue does not reset newer cleanup status after paused %s', async method => {
    const gate = pause(mockDatabase[method]);
    const work = service.clearSyncQueue();
    await gate.started;
    accountCleanup.block();
    // The blocked new request publishes the actionable cleanup failure.
    await service.syncToSupabase();
    const status = service.getSyncStatus();
    expect(status.state).toBe('error');
    gate.resolve(method === 'countSyncQueueItems' ? 99 : undefined);
    await work;
    expect(service.getSyncStatus()).toEqual(status);
  },
);

test('clearSyncQueue still clears and refreshes an unblocked queue', async () => {
  await service.clearSyncQueue();
  expect(mockDatabase.clearSyncQueue).toHaveBeenCalledTimes(1);
  expect(mockDatabase.countSyncQueueItems).toHaveBeenCalledTimes(1);
  expect(service.getSyncStatus()).toMatchObject({ state: 'idle', queueSize: 0, lastError: null });
});

test('cleanupRealtimeSync remains callable while account cleanup is blocked', async () => {
  const channel = { name: 'old-health-channel' };
  Object.assign(service, { healthChannel: channel });
  accountCleanup.block();
  await expect(service.cleanupRealtimeSync()).resolves.toBeUndefined();
  expect(mockRemoveChannel).toHaveBeenCalledWith(channel);
  expect(accountCleanup.isBlocked).toBe(true);
});

test.each(['single', 'upsert'] as const)('health upload ignores a retired %s response before checking auth again', async method => {
  const gate = pause(query[method]);
  const work = service.syncHealthMetricsToSupabase();
  await gate.started;
  accountCleanup.block();
  gate.resolve({ data: null, error: null });
  await work;
  expect(mockDatabase.reconcileHealthMetric).not.toHaveBeenCalled();
  expect(mockDatabase.addToSyncQueue).not.toHaveBeenCalled();
  expect(service.getSyncStatus().state).toBe('idle');
});
