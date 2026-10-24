import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACCOUNT_CLEANUP_KEY, AccountCleanupBarrier } from '@/lib/services/database/account-cleanup';

let storage: Map<string, string>;
beforeEach(() => {
  jest.clearAllMocks();
  storage = new Map();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => storage.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { storage.set(key, value); });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { storage.delete(key); });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('failed cleanup remains blocked in a new service instance until a successful retry', async () => {
  const first = new AccountCleanupBarrier();
  const failure = new Error('database unavailable');
  await expect(first.run(async () => { throw failure; })).rejects.toBe(failure);
  expect(storage.get(ACCOUNT_CLEANUP_KEY)).toBe('1');
  const restarted = new AccountCleanupBarrier();
  await expect(restarted.assertReady()).rejects.toThrow(/cleanup/);
  const cleanup = jest.fn(async () => {});
  await restarted.run(cleanup);
  expect(cleanup).toHaveBeenCalledTimes(1);
  await expect(restarted.assertReady()).resolves.toBeUndefined();
  expect(storage.has(ACCOUNT_CLEANUP_KEY)).toBe(false);
});

test('ordinary cleanup cannot discharge a durable unfinished SDK logout', async () => {
  const barrier = new AccountCleanupBarrier();
  await barrier.run(async () => {}, { logoutOwner: 'owner-a' });
  const restarted = new AccountCleanupBarrier();
  expect(await restarted.getPendingLogoutOwner()).toBe('owner-a');
  await restarted.run(async () => {});
  await expect(restarted.assertReady()).rejects.toThrow(/cleanup/);
  expect(await restarted.getPendingLogoutOwner()).toBe('owner-a');
  await restarted.run(async () => {}, { resolveLogout: true });
  await expect(new AccountCleanupBarrier().assertReady()).resolves.toBeUndefined();
});

test('marker persistence failure prevents destructive work and remains blocked', async () => {
  const barrier = new AccountCleanupBarrier();
  const cleanup = jest.fn(async () => {});
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage denied'));
  await expect(barrier.run(cleanup)).rejects.toThrow('storage denied');
  expect(cleanup).not.toHaveBeenCalled();
  await expect(barrier.assertReady()).rejects.toThrow(/cleanup/);
  await barrier.run(cleanup);
  await expect(barrier.assertReady()).resolves.toBeUndefined();
});

test('marker removal failure does not reopen access', async () => {
  const barrier = new AccountCleanupBarrier();
  jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('remove denied'));
  await expect(barrier.run(async () => {})).rejects.toThrow('remove denied');
  await expect(barrier.assertReady()).rejects.toThrow(/cleanup/);
  expect(storage.get(ACCOUNT_CLEANUP_KEY)).toBe('1');
});

test.each(['1', '', 'malformed'])('an existing %p marker is a cleanup obligation, not empty state', async value => {
  storage.set(ACCOUNT_CLEANUP_KEY, value);
  await expect(new AccountCleanupBarrier().assertReady()).rejects.toThrow(/cleanup/);
});

test('a denied marker read blocks instead of treating storage as empty', async () => {
  const barrier = new AccountCleanupBarrier();
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('read denied'));
  await expect(barrier.assertReady()).rejects.toThrow('read denied');
  expect(barrier.isBlocked).toBe(true);
});

test('overlapping retries serialize and the older completion cannot reopen access', async () => {
  const barrier = new AccountCleanupBarrier();
  const entered = deferred();
  const firstGate = deferred();
  const secondGate = deferred();
  const secondCleanup = jest.fn(() => secondGate.promise);
  const first = barrier.run(async () => { entered.resolve(); await firstGate.promise; });
  await entered.promise;
  const second = barrier.run(secondCleanup);
  expect(secondCleanup).not.toHaveBeenCalled();
  firstGate.resolve();
  await first;
  await expect(barrier.assertReady()).rejects.toThrow(/cleanup/);
  expect(storage.get(ACCOUNT_CLEANUP_KEY)).toBe('1');
  secondGate.resolve();
  await second;
  await expect(barrier.assertReady()).resolves.toBeUndefined();
});

test('a transition during marker removal remains durable after the old run settles', async () => {
  const barrier = new AccountCleanupBarrier();
  const entered = deferred();
  const removal = deferred();
  jest.mocked(AsyncStorage.removeItem).mockImplementationOnce(async key => {
    entered.resolve();
    await removal.promise;
    storage.delete(key);
  });
  const cleanup = barrier.run(async () => {});
  await entered.promise;
  barrier.block(); // New SDK event, before its deferred cleanup starts.
  removal.resolve();
  await cleanup;
  expect(barrier.isBlocked).toBe(true);
  await expect(new AccountCleanupBarrier().assertReady()).rejects.toThrow(/cleanup/);
});
