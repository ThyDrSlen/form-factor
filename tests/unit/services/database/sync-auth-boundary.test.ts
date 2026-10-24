import { AuthSessionMissingError } from '@supabase/supabase-js';
import { syncService } from '@/lib/services/database/sync-service';
import { errorWithTs } from '@/lib/logger';

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockQueueCount = jest.fn(async () => 3);
const mockDirtyFoods = jest.fn(async () => []);
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() },
  from: (...args: unknown[]) => mockFrom(...args),
} }));
jest.mock('@/lib/services/database/local-db', () => ({ localDB: {
  countSyncQueueItems: () => mockQueueCount(),
  getUnsyncedFoods: () => mockDirtyFoods(),
} }));
jest.mock('@/lib/services/database/generic-sync', () => ({ WORKOUT_SYNC_CONFIGS: [] }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(syncService, {
    syncPromise: null,
    syncStatus: { state: 'idle', queueSize: 3, lastError: null, lastErrorAt: null },
  });
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
});

test('signed-out recovery is a no-op, not a red-overlay error, and retains pending queue count', async () => {
  await syncService.downloadFromSupabase();
  expect(errorWithTs).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(syncService.getSyncStatus()).toMatchObject({ state: 'idle', queueSize: 3, lastError: null });
});

test('a real auth failure remains visible and prevents cloud and local upload work', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('Auth storage unavailable') });
  await syncService.syncToSupabase();
  expect(syncService.getSyncStatus()).toMatchObject({ state: 'error', lastError: 'Auth storage unavailable' });
  expect(errorWithTs).toHaveBeenCalled();
  expect(mockDirtyFoods).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
});
