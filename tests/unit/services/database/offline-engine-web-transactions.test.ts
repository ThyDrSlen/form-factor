/** @jest-environment node */
import { localDB } from '@/lib/services/database/local-db.web';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

const storage = new Map<string, string>();
let previousStorage: PropertyDescriptor | undefined;

beforeEach(() => {
  storage.clear();
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
});

afterEach(() => {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const food = (id: string) => ({ id, name: id, calories: 100, date: '2026-10-01' });

test('failed overlapping transaction cannot roll back another transaction\'s row and queue', async () => {
  const entered = deferred();
  const release = deferred();
  const failure = new Error('first transaction failed');
  const first = localDB.withTransaction(async () => {
    await localDB.insertFood(food('rolled-back'));
    await localDB.addToSyncQueue('foods', 'upsert', 'rolled-back');
    entered.resolve();
    await release.promise;
    throw failure;
  });
  await entered.promise;
  const second = localDB.withTransaction(async () => {
    await localDB.insertFood(food('survivor'));
    await localDB.addToSyncQueue('foods', 'upsert', 'survivor');
  });
  const settled = Promise.allSettled([first, second]);
  release.resolve();

  expect(await settled).toEqual([
    { status: 'rejected', reason: failure },
    { status: 'fulfilled', value: undefined },
  ]);
  expect((await localDB.getAllFoods()).map(row => row.id)).toEqual(['survivor']);
  expect((await localDB.getSyncQueue()).map(row => row.record_id)).toEqual(['survivor']);

  // A rejected predecessor must not poison subsequent transactions.
  await localDB.withTransaction(async () => {
    await localDB.insertFood(food('later'));
  });
  expect((await localDB.getAllFoods()).map(row => row.id).sort()).toEqual(['later', 'survivor']);
});
