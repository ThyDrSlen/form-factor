import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers';
import { localDB } from '@/lib/services/database/local-db';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn() }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function makeAdapter(sqlite: DatabaseSync) {
  const execAsync = async (sql: string) => { sqlite.exec(sql); };
  return {
    execAsync,
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
    // Real SQLite boundaries, with the same awaited scheduling as expo-sqlite.
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
  };
}

let sqlite: DatabaseSync;
let previous: typeof localDB.db;

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  previous = localDB.db;
  Object.assign(localDB, { db: makeAdapter(sqlite) });
  // Exercise the actual native schema/migrations, not a reduced test schema.
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  sqlite.exec(`
    INSERT INTO foods (id, name, calories, date, updated_at)
      VALUES ('food', 'Original food', 100, '2026-10-01', '2026-10-01');
    INSERT INTO workouts (id, exercise, sets, date, updated_at)
      VALUES ('workout', 'Squat', 1, '2026-10-01', '2026-10-01');
    INSERT INTO health_metrics (id, user_id, summary_date, updated_at)
      VALUES ('metric', 'owner', '2026-10-01', '2026-10-01');
    INSERT INTO nutrition_goals (id, user_id, calories_goal, protein_goal, carbs_goal, fat_goal, updated_at)
      VALUES ('goals', 'owner', 2000, 100, 200, 50, '2026-10-01');
    INSERT INTO sync_queue (table_name, operation, record_id, created_at)
      VALUES ('foods', 'upsert', 'food', '2026-10-01');
    INSERT INTO sync_queue (table_name, operation, record_id, created_at)
      VALUES ('foods', 'upsert', 'removed-tail', '2026-10-01');
    DELETE FROM sync_queue WHERE record_id = 'removed-tail';
    INSERT INTO exercises (id, name) VALUES ('exercise', 'Squat');
    INSERT INTO workout_templates (id, name) VALUES ('template', 'Workout');
    INSERT INTO workout_template_exercises (id, template_id, exercise_id)
      VALUES ('template-exercise', 'template', 'exercise');
    INSERT INTO workout_template_sets (id, template_exercise_id)
      VALUES ('template-set', 'template-exercise');
    INSERT INTO workout_sessions (id, template_id, started_at, user_id)
      VALUES ('session', 'template', '2026-10-01', 'owner');
    INSERT INTO workout_session_exercises (id, session_id, exercise_id)
      VALUES ('session-exercise', 'session', 'exercise');
    INSERT INTO workout_session_sets (id, session_exercise_id)
      VALUES ('session-set', 'session-exercise');
    INSERT INTO workout_session_events (id, session_id, created_at, type, session_exercise_id, session_set_id)
      VALUES ('event', 'session', '2026-10-01', 'set_completed', 'session-exercise', 'session-set');
    INSERT INTO debrief_notes (session_id, notes, updated_at)
      VALUES ('session', 'Keep until cleanup commits', '2026-10-01');
  `);
});

afterEach(() => {
  localDB.db = previous;
  sqlite.close();
});

function tables() {
  return sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
}

function snapshot() {
  return Object.fromEntries(tables().map(({ name }) => [name, sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

test('pending transaction rollback cannot resurrect rows after clearAllData', async () => {
  const entered = deferred();
  const release = deferred();
  const failure = new Error('pending transaction failed');
  const pending = localDB.withTransaction(async () => {
    sqlite.exec("UPDATE foods SET name = 'Uncommitted change'");
    entered.resolve();
    await release.promise;
    throw failure;
  });
  await entered.promise;
  const cleanup = localDB.clearAllData();
  const outcomes = Promise.allSettled([pending, cleanup]);
  // Give the old un-serialized cleanup time to run inside the open transaction.
  // Always release before awaiting either operation, including on the fixed path.
  await new Promise<void>(resolve => setImmediate(resolve));
  release.resolve();
  expect(await outcomes).toEqual([
    { status: 'rejected', reason: failure },
    { status: 'fulfilled', value: undefined },
  ]);
  for (const rows of Object.values(snapshot())) expect(rows).toEqual([]);
});

test('a mid-delete SQL failure rolls back the entire cleanup and permits a later retry', async () => {
  const before = snapshot();
  // RAISE(ABORT) aborts only this statement, so only a real transaction can
  // undo the earlier foods/workouts deletes in the same execAsync batch.
  sqlite.exec(`CREATE TRIGGER fail_cleanup BEFORE DELETE ON health_metrics
    BEGIN SELECT RAISE(ABORT, 'intentional cleanup SQL failure'); END;`);
  await expect(localDB.clearAllData()).rejects.toThrow('intentional cleanup SQL failure');
  expect(snapshot()).toEqual(before);
  sqlite.exec('DROP TRIGGER fail_cleanup');
  await localDB.clearAllData();
  for (const rows of Object.values(snapshot())) expect(rows).toEqual([]);
});

test('cleanup empties the production schema without resetting queue AUTOINCREMENT identity', async () => {
  const sequence = sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'sync_queue'").get();
  expect(sequence).toBeDefined();
  expect(sqlite.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  for (const { name } of tables()) {
    // The current native schema has logical relationships but no declared FKs;
    // do not silently claim this fixture verifies a future FK migration's order.
    expect(sqlite.prepare(`PRAGMA foreign_key_list("${name}")`).all()).toEqual([]);
    expect(snapshot()[name]).toHaveLength(1);
  }

  await localDB.clearAllData();

  for (const rows of Object.values(snapshot())) expect(rows).toEqual([]);
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'sync_queue'").get()).toEqual(sequence);
  await localDB.addToSyncQueue('foods', 'upsert', 'new-food');
  const queue = sqlite.prepare('SELECT id, record_id FROM sync_queue').all();
  expect(queue).toHaveLength(1);
  expect(queue[0].record_id).toBe('new-food');
  // The high-water mark includes the already-deleted tail row, not only MAX(id).
  expect(queue[0].id).toBeGreaterThan(Number(sequence!.seq));
});

test('uninitialized cleanup rejects without opening a database', async () => {
  localDB.db = null;
  const initialize = jest.spyOn(localDB, 'initialize').mockRejectedValue(new Error('must not initialize'));
  try {
    await expect(localDB.clearAllData()).rejects.toThrow('Database not initialized');
    expect(initialize).not.toHaveBeenCalled();
  } finally {
    initialize.mockRestore();
  }
});

test('queued cleanup retains its captured connection instead of clearing a replacement', async () => {
  const original = localDB.db;
  const replacement = new DatabaseSync(':memory:');
  const entered = deferred();
  const release = deferred();
  let outcomes: Promise<PromiseSettledResult<void>[]> | undefined;
  try {
    Object.assign(localDB, { db: makeAdapter(replacement) });
    await (localDB as unknown as { createTables(): Promise<void> }).createTables();
    replacement.exec(`INSERT INTO foods (id, name, calories, date, updated_at)
      VALUES ('replacement-food', 'Untouched', 100, '2026-10-01', '2026-10-01');`);
    const replacementConnection = localDB.db;
    localDB.db = original;
    const pending = localDB.withTransaction(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const cleanup = localDB.clearAllData();
    outcomes = Promise.allSettled([pending, cleanup]);
    // Replace immediately, including before withTransaction's initialization
    // await resumes. Its transaction and deletes must both use the original.
    localDB.db = replacementConnection;
    await new Promise<void>(resolve => setImmediate(resolve));
    release.resolve();
    expect(await outcomes).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]);
    for (const rows of Object.values(snapshot())) expect(rows).toEqual([]);
    expect(replacement.prepare('SELECT id, name FROM foods').all()).toEqual([
      { id: 'replacement-food', name: 'Untouched' },
    ]);
  } finally {
    release.resolve();
    await outcomes;
    localDB.db = original;
    replacement.close();
  }
});
