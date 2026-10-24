import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACCOUNT_CLEANUP_KEY, accountCleanup } from '@/lib/services/database/account-cleanup';
import { syncService } from '@/lib/services/database/sync-service';

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockChannel = jest.fn();
const mockDirtyFoods = jest.fn(async () => []);
const mockFoodRead = jest.fn(async () => undefined);
const mockFoodWrite = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() },
  from: (...args: unknown[]) => mockFrom(...args),
  channel: (...args: unknown[]) => mockChannel(...args),
  removeChannel: jest.fn(async () => {}),
} }));
jest.mock('@/lib/services/database/local-db', () => ({ localDB: {
  supportsWorkoutSync: false,
  countSyncQueueItems: jest.fn(async () => 0),
  getUnsyncedFoods: () => mockDirtyFoods(),
  getFoodById: () => mockFoodRead(),
  insertFood: (...args: unknown[]) => mockFoodWrite(...args),
} }));
jest.mock('@/lib/services/database/generic-sync', () => ({ WORKOUT_SYNC_CONFIGS: [] }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), warnWithTs: jest.fn(), errorWithTs: jest.fn() }));

let storage: Map<string, string>;
let service: typeof syncService;
beforeEach(async () => {
  storage = new Map();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => storage.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { storage.set(key, value); });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { storage.delete(key); });
  await accountCleanup.run(async () => {});
  jest.clearAllMocks();
  service = new (syncService.constructor as { new(): typeof syncService })();
  mockChannel.mockImplementation(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() }));
  mockGetUser.mockResolvedValue({ data: { user: { id: 'incoming-owner' } }, error: null });
});

test.each(['syncToSupabase', 'downloadFromSupabase', 'fullSync'] as const)(
  '%s cannot use SDK identity to bypass persisted cleanup failure', async method => {
    storage.set(ACCOUNT_CLEANUP_KEY, '1');
    await service[method]();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockDirtyFoods).not.toHaveBeenCalled();
    expect(service.getSyncStatus()).toMatchObject({ state: 'error', lastError: expect.stringMatching(/cleanup/i) });
  },
);

test('realtime setup also rejects an unfinished cleanup', async () => {
  storage.set(ACCOUNT_CLEANUP_KEY, '1');
  await expect(service.initializeRealtimeSync('incoming-owner')).rejects.toThrow(/cleanup/i);
  expect(mockChannel).not.toHaveBeenCalled();
});

test('callbacks from before cleanup stay retired even after cleanup succeeds', async () => {
  await service.initializeRealtimeSync('incoming-owner');
  const channel = mockChannel.mock.results[0].value;
  const callback = channel.on.mock.calls[0][2];
  await accountCleanup.run(async () => {});
  await callback({ eventType: 'INSERT', new: { id: 'old-food', user_id: 'incoming-owner' }, old: {} });
  expect(mockFoodRead).not.toHaveBeenCalled();
  expect(mockFoodWrite).not.toHaveBeenCalled();
  await service.cleanupRealtimeSync();
});

test('cleanup started during SDK lookup cancels that upload before local reads', async () => {
  let resolveUser!: (value: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  mockGetUser.mockImplementationOnce(() => new Promise(resolve => { resolveUser = resolve; entered(); }));
  const sync = service.syncToSupabase();
  await started;
  await accountCleanup.run(async () => {});
  resolveUser({ data: { user: { id: 'incoming-owner' } }, error: null });
  await sync;
  expect(mockDirtyFoods).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
});
