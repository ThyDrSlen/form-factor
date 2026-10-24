/** @jest-environment node */
import { localDB } from '@/lib/services/database/local-db.web';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

const storage = new Map<string, string>();
let original: PropertyDescriptor | undefined;
const revision = '2026-01-01T12:00:00.000Z';
const food = { id: 'food', name: 'Oats', calories: 100, date: revision };
const workout = { id: 'workout', exercise: 'Squat', sets: 3, date: revision };

beforeEach(() => {
  storage.clear();
  original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test.each(['food', 'workout'])('web %s recovery preserves the supplied server revision', async kind => {
  if (kind === 'food') {
    await localDB.insertFood(food);
    await localDB.updateFood(food.id, { synced: 1, updated_at: revision });
    expect(await localDB.getFoodById(food.id)).toMatchObject({ synced: 1, updated_at: revision });
  } else {
    await localDB.insertWorkout(workout);
    await localDB.updateWorkout(workout.id, { synced: 1, updated_at: revision });
    expect(await localDB.getWorkoutById(workout.id)).toMatchObject({ synced: 1, updated_at: revision });
  }
});

test('a web workout deleted offline remains discoverable by the upload worker', async () => {
  await localDB.insertWorkout(workout);
  await localDB.softDeleteWorkout(workout.id);
  expect(await localDB.getAllWorkouts()).toEqual([]);
  expect(await localDB.getUnsyncedWorkouts()).toEqual([
    expect.objectContaining({ id: workout.id, deleted: 1, synced: 0 }),
  ]);
});
