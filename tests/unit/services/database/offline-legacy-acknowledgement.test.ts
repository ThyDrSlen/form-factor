/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB as nativeDB } from '@/lib/services/database/local-db';
import { localDB as webDB } from '@/lib/services/database/local-db.web';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));
const revision = '2026-01-01T12:00:00.000Z';
let sqlite: DatabaseSync;
let previousDB: typeof nativeDB.db;
let previousStorage: PropertyDescriptor | undefined;
beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  previousDB = nativeDB.db;
  Object.assign(nativeDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    prepareAsync: async (sql: string) => {
      const statement = sqlite.prepare(sql);
      return {
        executeAsync: async (args: (string | number | null)[] = []) => statement.run(...args),
        finalizeAsync: async () => undefined,
      };
    },
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
  } });
  await (nativeDB as unknown as { createTables(): Promise<void> }).createTables();
  const storage = new Map<string, string>();
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

describe.each(['native', 'web'])('%s captured-content acknowledgements', backend => {
  test.each(['unchanged', 'edit', 'delete', 'restore'])('food: %s while the upload is in flight', async change => {
    const db = backend === 'native' ? nativeDB : webDB;
    await db.insertFood({ id: 'food', name: 'Oats', calories: 100, date: revision });
    await db.updateFood('food', { updated_at: revision, deleted: change === 'restore' ? 1 : 0 });
    const captured = (await db.getFoodById('food'))!;
    if (change === 'edit') await db.updateFood('food', { calories: 200, updated_at: revision });
    if (change === 'delete' || change === 'restore') await db.updateFood('food', { deleted: change === 'delete' ? 1 : 0, updated_at: revision });
    const beforeAck = await db.getFoodById('food');
    await db.updateFoodSyncStatus('food', true, captured);
    expect(await db.getFoodById('food')).toEqual({ ...beforeAck, synced: change === 'unchanged' ? 1 : 0 });
  });
  test.each(['unchanged', 'edit', 'delete', 'restore'])('workout: %s while the upload is in flight', async change => {
    const db = backend === 'native' ? nativeDB : webDB;
    await db.insertWorkout({ id: 'workout', exercise: 'Squat', sets: 3, reps: 10, date: revision });
    await db.updateWorkout('workout', { updated_at: revision, deleted: change === 'restore' ? 1 : 0 });
    const captured = (await db.getWorkoutById('workout'))!;
    if (change === 'edit') await db.updateWorkout('workout', { reps: 20, updated_at: revision });
    if (change === 'delete' || change === 'restore') await db.updateWorkout('workout', { deleted: change === 'delete' ? 1 : 0, updated_at: revision });
    const beforeAck = await db.getWorkoutById('workout');
    await db.updateWorkoutSyncStatus('workout', true, captured);
    expect(await db.getWorkoutById('workout')).toEqual({ ...beforeAck, synced: change === 'unchanged' ? 1 : 0 });
  });
});
