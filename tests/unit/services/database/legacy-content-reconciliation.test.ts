/** @jest-environment node */
import { DatabaseSync } from 'node:sqlite';
import { localDB as nativeDB, type LocalFood, type LocalWorkout } from '@/lib/services/database/local-db';
import { localDB as webDB } from '@/lib/services/database/local-db.web';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

const capturedAt = '2026-10-01T10:00:00.000Z';
const remoteAt = '2026-10-01T11:00:00.000Z';
type Row = LocalFood | LocalWorkout;
type Table = 'foods' | 'workouts';
type DB = typeof nativeDB | typeof webDB;
type Bind = string | number | null;
const fixtures = [
  {
    table: 'foods' as const,
    expected: { id: 'food-1', name: 'Local food', calories: 200, protein: 10, carbs: 20, fat: 5,
      date: '2026-10-01', synced: 0, deleted: 0, updated_at: capturedAt } as LocalFood,
    incoming: { id: 'food-1', name: 'Server food', calories: 0, protein: 0, carbs: 0, fat: 0,
      date: '2026-10-02', synced: 0, deleted: 0, updated_at: remoteAt } as LocalFood,
    nullable: ['protein', 'carbs', 'fat'],
    required: 'name',
  },
  {
    table: 'workouts' as const,
    expected: { id: 'workout-1', exercise: 'Local workout', sets: 3, reps: 8, weight: 40, duration: 30,
      date: '2026-10-01', synced: 0, deleted: 0, updated_at: capturedAt } as LocalWorkout,
    incoming: { id: 'workout-1', exercise: 'Server workout', sets: 0, reps: 0, weight: 0, duration: 0,
      date: '2026-10-02', synced: 0, deleted: 0, updated_at: remoteAt } as LocalWorkout,
    nullable: ['reps', 'weight', 'duration'],
    required: 'exercise',
  },
];

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

function seed(platform: string, table: Table, ...rows: Row[]) {
  if (platform === 'web') {
    storage.set(`formfactor_${table}`, JSON.stringify(rows));
  } else {
    for (const row of rows) {
      const entries = Object.entries(row);
      sqlite.prepare(`INSERT INTO ${table} (${entries.map(([field]) => field).join(', ')})
        VALUES (${entries.map(() => '?').join(', ')})`).run(...entries.map(([, value]) => value ?? null));
    }
  }
}

function reconcile(db: DB, table: Table, incoming: Row, expected: Row, isCurrent?: () => boolean) {
  return table === 'foods'
    ? db.reconcileFood(incoming as LocalFood, expected as LocalFood, isCurrent)
    : db.reconcileWorkout(incoming as LocalWorkout, expected as LocalWorkout, isCurrent);
}

function withFields(row: Row, fields: string[], value: unknown): Row {
  return { ...row, ...Object.fromEntries(fields.map(field => [field, value])) };
}

function edits(row: Row): [string, string | number][] {
  return Object.entries(row).map(([field, value]) => [
    field, typeof value === 'string' ? `${value}-edited` : value === 0 ? 1 : 0,
  ]);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe.each(fixtures)('$table native prepared writes', ({ table, expected, incoming, required }) => {
  test.each(edits(expected))('compares %s atomically after preparation', async (field, value) => {
    seed('native', table, expected);
    beforePrepareReturns = async () => {
      sqlite.prepare(`UPDATE ${table} SET ${field} = ? WHERE id = ?`).run(value, expected.id);
    };
    expect(await reconcile(nativeDB, table, incoming, expected)).toBe(false);
    expect(sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([{ ...expected, [field]: value }]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('never resurrects a row removed during preparation', async () => {
    seed('native', table, expected);
    beforePrepareReturns = async () => { sqlite.prepare(`DELETE FROM ${table}`).run(); };
    expect(await reconcile(nativeDB, table, incoming, expected)).toBe(false);
    expect(sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('finalizes a successful statement', async () => {
    seed('native', table, expected);
    expect(await reconcile(nativeDB, table, incoming, expected)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('finalizes a statement even when SQLite rejects the write', async () => {
    seed('native', table, expected);
    await expect(reconcile(nativeDB, table, { ...incoming, [required]: null }, expected)).rejects.toThrow('NOT NULL');
    expect(await getRow(nativeDB, table, expected.id)).toEqual(expected);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test.each(['cancel', 'replace connection', 'replace connection without guard'] as const)(
    'does not execute stale work after delayed preparation: %s', async mode => {
      seed('native', table, expected);
      const originalConnection = nativeDB.db;
      const entered = deferred();
      const release = deferred();
      let current = true;
      beforePrepareReturns = async () => {
        entered.resolve();
        await release.promise;
      };
      const pending = reconcile(nativeDB, table, incoming, expected,
        mode === 'replace connection without guard' ? undefined : () => current);
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
        expect(sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(expected.id)).toEqual(expected);
      } finally {
        release.resolve();
        await pending;
        nativeDB.db = originalConnection;
      }
    },
  );
});

describe.each(fixtures)('$table web atomic writes', ({ table, expected, incoming, nullable }) => {
  test('comparison and persistence do not yield between reading and writing', async () => {
    seed('web', table, expected);
    const pending = reconcile(webDB, table, incoming, expected, () => true);
    expect(JSON.parse(storage.get(`formfactor_${table}`)!)).toEqual([{ ...incoming, synced: 1 }]);
    expect(await pending).toBe(true);
  });

  test.each([[null, undefined], [undefined, null]])(
    'normalizes stored %s and expected %s nullable values equivalently', async (stored, captured) => {
      seed('web', table, withFields(expected, nullable, stored));
      expect(await reconcile(webDB, table, incoming, withFields(expected, nullable, captured))).toBe(true);
      expect(await getRow(webDB, table, expected.id)).toEqual({ ...incoming, synced: 1 });
    },
  );
});

function getRow(db: DB, table: Table, id: string) {
  return table === 'foods' ? db.getFoodById(id) : db.getWorkoutById(id);
}

describe.each([['native', nativeDB], ['web', webDB]] as const)('%s legacy reconciliation', (platform, db) => {
  describe.each(fixtures)('$table', ({ table, expected, incoming, nullable }) => {
    test.each(edits(expected))('rejects an edited captured field %s even at the same timestamp', async (field, value) => {
      const edited = { ...expected, [field]: value };
      seed(platform, table, edited);
      expect(await reconcile(db, table, incoming, expected)).toBe(false);
      expect(await getRow(db, table, edited.id)).toEqual(edited);
    });

    test.each(nullable)('compares omitted nullable field %s rather than skipping it', async field => {
      seed(platform, table, expected);
      expect(await reconcile(db, table, incoming, { ...expected, [field]: undefined })).toBe(false);
      expect(await getRow(db, table, expected.id)).toEqual(expected);
    });

    test.each([null, undefined])('matches nullable %s values and accepts server zeros', async value => {
      const captured = withFields(expected, nullable, value);
      seed(platform, table, captured);
      expect(await reconcile(db, table, incoming, captured)).toBe(true);
      expect(await getRow(db, table, expected.id)).toEqual({ ...incoming, synced: 1 });
    });

    test.each([null, undefined])('replaces existing nullable values with server %s', async value => {
      seed(platform, table, expected);
      const remote = withFields(incoming, nullable, value);
      expect(await reconcile(db, table, remote, expected)).toBe(true);
      const persisted = await getRow(db, table, expected.id);
      expect(withFields(persisted!, nullable, null)).toEqual(withFields({ ...remote, synced: 1 }, nullable, null));
      for (const field of nullable) expect((persisted as unknown as Record<string, unknown>)[field] ?? null).toBeNull();
    });

    test.each(nullable)('does not equate zero with null for %s', async field => {
      const captured = { ...expected, [field]: null };
      const edited = { ...expected, [field]: 0 };
      seed(platform, table, edited);
      expect(await reconcile(db, table, incoming, captured)).toBe(false);
      expect(await getRow(db, table, expected.id)).toEqual(edited);
    });

    test.each([[0, 1], [1, 0], [1, 1]])('reconciles captured deleted=%s to incoming deleted=%s', async (before, after) => {
      const captured = { ...expected, deleted: before };
      const remote = { ...incoming, deleted: after };
      seed(platform, table, captured);
      expect(await reconcile(db, table, remote, captured)).toBe(true);
      expect(await getRow(db, table, expected.id)).toEqual({ ...remote, synced: 1 });
    });

    test('acknowledges a tombstone with incoming equal to expected', async () => {
      const captured = { ...expected, deleted: 1 };
      seed(platform, table, captured);
      expect(await reconcile(db, table, captured, captured)).toBe(true);
      expect(await getRow(db, table, expected.id)).toEqual({ ...captured, synced: 1 });
    });

    test('does not overwrite a same-timestamp restore with a captured tombstone', async () => {
      const captured = { ...expected, deleted: 1 };
      seed(platform, table, expected);
      expect(await reconcile(db, table, captured, captured)).toBe(false);
      expect(await getRow(db, table, expected.id)).toEqual(expected);
    });

    test('does not insert a missing captured row', async () => {
      expect(await reconcile(db, table, incoming, expected)).toBe(false);
      expect(await getRow(db, table, expected.id)).toBeNull();
    });

    test('rejects mismatched IDs without modifying either row', async () => {
      const other = { ...incoming, id: 'other-row' };
      seed(platform, table, expected, other);
      expect(await reconcile(db, table, other, expected)).toBe(false);
      expect(await getRow(db, table, expected.id)).toEqual(expected);
      expect(await getRow(db, table, other.id)).toEqual(other);
      expect(execute).not.toHaveBeenCalled();
      expect(finalize).not.toHaveBeenCalled();
    });

    test('a false current guard leaves persistence untouched', async () => {
      seed(platform, table, expected);
      expect(await reconcile(db, table, incoming, expected, () => false)).toBe(false);
      expect(await getRow(db, table, expected.id)).toEqual(expected);
      expect(execute).not.toHaveBeenCalled();
      expect(finalize).not.toHaveBeenCalled();
    });

    test('only compares and copies allowlisted fields', async () => {
      seed(platform, table, expected);
      expect(await reconcile(db, table, withFields(incoming, ['unexpected'], 'remote'),
        withFields(expected, ['unexpected'], 'captured'))).toBe(true);
      expect(await getRow(db, table, expected.id)).toEqual({ ...incoming, synced: 1 });
    });

    test('works inside the existing transaction without consuming its queue', async () => {
      seed(platform, table, expected);
      await db.addToSyncQueue(table, 'upsert', expected.id, expected);
      const queue = await db.getSyncQueue();
      await db.withTransaction(async () => {
        expect(await reconcile(db, table, incoming, expected)).toBe(true);
      });
      expect(await getRow(db, table, expected.id)).toEqual({ ...incoming, synced: 1 });
      expect(await db.getSyncQueue()).toEqual(queue);
    });

    test('participates in caller transaction rollback', async () => {
      seed(platform, table, expected);
      await expect(db.withTransaction(async () => {
        expect(await reconcile(db, table, incoming, expected)).toBe(true);
        throw new Error('rollback');
      })).rejects.toThrow('rollback');
      expect(await getRow(db, table, expected.id)).toEqual(expected);
    });

    test('copies server content, explicit zeros and exact revision without changing identity or queue', async () => {
      seed(platform, table, expected);
      await db.addToSyncQueue(table, 'upsert', expected.id, expected);
      const queue = await db.getSyncQueue();

      expect(await reconcile(db, table, incoming, expected)).toBe(true);

      expect(await getRow(db, table, expected.id)).toEqual({ ...incoming, synced: 1 });
      expect(await db.getSyncQueue()).toEqual(queue);
    });
  });
});
