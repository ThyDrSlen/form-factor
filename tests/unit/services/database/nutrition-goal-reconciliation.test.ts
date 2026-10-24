/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB as nativeDB, type LocalNutritionGoals } from '@/lib/services/database/local-db';
import { localDB as webDB } from '@/lib/services/database/local-db.web';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

const capturedAt = '2026-10-01T10:00:00.000Z';
const remoteAt = '2026-10-01T11:00:00.000Z';
const goals = (overrides: Partial<LocalNutritionGoals> = {}): LocalNutritionGoals => ({
  id: 'local-goals', user_id: 'owner-a', calories_goal: 2000, protein_goal: 120,
  carbs_goal: 250, fat_goal: 70, synced: 0, updated_at: capturedAt, ...overrides,
});
const remote = (overrides: Partial<LocalNutritionGoals> = {}): LocalNutritionGoals => goals({
  id: 'remote-goals', calories_goal: 2400, protein_goal: 150, carbs_goal: 280,
  fat_goal: 80, updated_at: remoteAt, ...overrides,
});

type Bind = string | number | null;
let sqlite: DatabaseSync;
let previousDB: typeof nativeDB.db;
let previousStorage: PropertyDescriptor | undefined;
let beforePrepareReturns: (() => Promise<void>) | undefined;
let execute: jest.Mock;
let finalize: jest.Mock;
const storage = new Map<string, string>();

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  previousDB = nativeDB.db;
  beforePrepareReturns = undefined;
  execute = jest.fn();
  finalize = jest.fn(async () => undefined);
  const connection = sqlite;
  const execAsync = async (sql: string) => { connection.exec(sql); };
  Object.assign(nativeDB, { db: {
    execAsync,
    runAsync: async (sql: string, args: Bind[] = []) => connection.prepare(sql).run(...args),
    prepareAsync: async (sql: string) => {
      const statement = connection.prepare(sql);
      await beforePrepareReturns?.();
      return {
        executeAsync: async (args: Bind[] = []) => {
          execute();
          return statement.run(...args);
        },
        finalizeAsync: finalize,
      };
    },
    getAllAsync: async (sql: string, args: Bind[] = []) => connection.prepare(sql).all(...args),
    withTransactionAsync: async (task: () => Promise<void>) => {
      try {
        await execAsync('BEGIN');
        await task();
        await execAsync('COMMIT');
      } catch (error) {
        await execAsync('ROLLBACK');
        throw error;
      }
    },
  } });
  await (nativeDB as unknown as { createTables(): Promise<void> }).createTables();
  storage.clear();
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

function seed(platform: string, ...rows: LocalNutritionGoals[]) {
  if (platform === 'web') {
    storage.set('formfactor_nutrition_goals', JSON.stringify(rows));
  } else {
    for (const row of rows) {
      sqlite.prepare(`INSERT INTO nutrition_goals
        (id, user_id, calories_goal, protein_goal, carbs_goal, fat_goal, synced, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.user_id, row.calories_goal, row.protein_goal,
        row.carbs_goal, row.fat_goal, row.synced, row.updated_at,
      );
    }
  }
}

describe.each([['native', nativeDB], ['web', webDB]] as const)('%s nutrition reconciliation', (platform, db) => {
  test.each([
    ['calories_goal', 0], ['protein_goal', 0], ['carbs_goal', 0], ['fat_goal', 0],
    ['calories_goal', 2100], ['protein_goal', 121], ['carbs_goal', 251], ['fat_goal', 71],
    ['synced', 1], ['updated_at', remoteAt], ['user_id', 'owner-b'], ['id', 'replacement-id'],
  ] as const)('rejects a changed captured field %s=%s without touching persistence', async (field, value) => {
    const expected = goals();
    const edited = goals({ [field]: value });
    seed(platform, edited);

    expect(await db.reconcileNutritionGoals(remote(), expected)).toBe(false);

    expect(await db.getNutritionGoalsById(edited.id)).toEqual(edited);
  });

  test('does not insert or resurrect a missing captured row', async () => {
    expect(await db.reconcileNutritionGoals(remote(), goals())).toBe(false);
    expect(await db.getNutritionGoalsById('local-goals')).toBeNull();
    expect(await db.getNutritionGoalsById('remote-goals')).toBeNull();
  });

  test.each([
    ['owner-b', 'owner-a'], [null, 'owner-a'], ['owner-a', null], [null, null], ['', ''],
  ])('rejects unverified owners (incoming %s, expected %s)', async (incomingOwner, expectedOwner) => {
    const local = goals();
    seed(platform, local);
    const incoming = remote({ user_id: incomingOwner as string });
    const expected = goals({ user_id: expectedOwner as string });

    expect(await db.reconcileNutritionGoals(incoming, expected)).toBe(false);

    expect(await db.getNutritionGoalsById(local.id)).toEqual(local);
  });

  test('a false current guard leaves the captured row untouched', async () => {
    const expected = goals();
    seed(platform, expected);
    expect(await db.reconcileNutritionGoals(remote(), expected, () => false)).toBe(false);
    expect(await db.getNutritionGoalsById(expected.id)).toEqual(expected);
  });

  test('accepts explicit zero server values and preserves the exact server revision', async () => {
    const expected = goals();
    seed(platform, expected);
    const incoming = remote({ calories_goal: 0, protein_goal: 0, carbs_goal: 0, fat_goal: 0, updated_at: capturedAt });
    expect(await db.reconcileNutritionGoals(incoming, expected, () => true)).toBe(true);
    expect(await db.getNutritionGoalsById(expected.id)).toEqual({ ...incoming, id: expected.id, synced: 1 });
  });

  test('a foreign row sharing the incoming remote ID is never changed', async () => {
    const expected = goals();
    const foreign = goals({ id: 'remote-goals', user_id: 'owner-b' });
    seed(platform, expected, foreign);
    expect(await db.reconcileNutritionGoals(remote(), expected)).toBe(true);
    expect(await db.getNutritionGoalsById(foreign.id)).toEqual(foreign);
    expect(await db.getNutritionGoalsById(expected.id)).toEqual(remote({ id: expected.id, synced: 1 }));
  });

  test('applies server content with a different remote ID while preserving local identity and queue', async () => {
    const expected = goals();
    seed(platform, expected);
    await db.addToSyncQueue('nutrition_goals', 'upsert', expected.id, expected);
    const queue = await db.getSyncQueue();

    expect(await db.reconcileNutritionGoals(remote(), expected)).toBe(true);

    expect(await db.getNutritionGoalsById(expected.id)).toEqual(remote({ id: expected.id, synced: 1 }));
    expect(await db.getNutritionGoalsById('remote-goals')).toBeNull();
    expect(await db.getSyncQueue()).toEqual(queue);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('web comparison and persistence do not yield between reading and writing', async () => {
  seed('web', goals());
  const pending = webDB.reconcileNutritionGoals(remote(), goals(), () => true);
  expect(JSON.parse(storage.get('formfactor_nutrition_goals')!)).toEqual([remote({ id: 'local-goals', synced: 1 })]);
  expect(await pending).toBe(true);
});

test('web rejects an ownerless stored snapshot instead of treating two null owners as a match', async () => {
  const ownerless = goals({ user_id: null as unknown as string });
  seed('web', ownerless);
  expect(await webDB.reconcileNutritionGoals(remote({ user_id: ownerless.user_id }), ownerless)).toBe(false);
  expect(await webDB.getNutritionGoalsById(ownerless.id)).toEqual(ownerless);
});

describe('native prepared nutrition writes', () => {
  test.each([
    ['calories_goal', 0], ['protein_goal', 0], ['carbs_goal', 0], ['fat_goal', 0],
    ['synced', 1], ['updated_at', remoteAt], ['user_id', 'owner-b'], ['id', 'replacement-id'],
  ] as const)('compares %s atomically after preparation', async (field, value) => {
    const expected = goals();
    seed('native', expected);
    beforePrepareReturns = async () => {
      sqlite.prepare(`UPDATE nutrition_goals SET ${field} = ? WHERE id = ?`).run(value, expected.id);
    };
    expect(await nativeDB.reconcileNutritionGoals(remote(), expected)).toBe(false);
    expect(sqlite.prepare('SELECT * FROM nutrition_goals').all()).toEqual([{ ...expected, [field]: value }]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('a row deleted during preparation is never resurrected', async () => {
    seed('native', goals());
    beforePrepareReturns = async () => { sqlite.prepare('DELETE FROM nutrition_goals').run(); };
    expect(await nativeDB.reconcileNutritionGoals(remote(), goals())).toBe(false);
    expect(sqlite.prepare('SELECT * FROM nutrition_goals').all()).toEqual([]);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('finalizes a successful statement', async () => {
    seed('native', goals());
    expect(await nativeDB.reconcileNutritionGoals(remote(), goals())).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('finalizes a statement even when SQLite rejects the write', async () => {
    const expected = goals();
    seed('native', expected);
    const incoming = remote({ calories_goal: null as unknown as number });
    await expect(nativeDB.reconcileNutritionGoals(incoming, expected)).rejects.toThrow('NOT NULL');
    expect(await nativeDB.getNutritionGoalsById(expected.id)).toEqual(expected);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test.each(['cancel', 'replace connection', 'replace connection without guard'] as const)(
    'does not execute stale work after delayed preparation: %s', async mode => {
      const expected = goals();
      seed('native', expected);
      const originalConnection = nativeDB.db;
      const entered = deferred();
      const release = deferred();
      let current = true;
      beforePrepareReturns = async () => {
        entered.resolve();
        await release.promise;
      };
      const pending = nativeDB.reconcileNutritionGoals(
        remote(), expected, mode === 'replace connection without guard' ? undefined : () => current,
      );
      try {
        expect(await Promise.race([
          entered.promise.then(() => 'prepared'), pending.then(() => 'finished'),
        ])).toBe('prepared');
        if (mode === 'cancel') current = false;
        else Object.assign(nativeDB, { db: { ...originalConnection } });
        release.resolve();
        expect(await pending).toBe(false);
        expect(execute).not.toHaveBeenCalled();
        expect(finalize).toHaveBeenCalledTimes(1);
        expect(sqlite.prepare('SELECT * FROM nutrition_goals WHERE id = ?').get(expected.id)).toEqual(expected);
      } finally {
        release.resolve();
        await pending;
        nativeDB.db = originalConnection;
      }
    },
  );
});
