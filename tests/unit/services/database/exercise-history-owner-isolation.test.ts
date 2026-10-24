import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';

jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn() }));

const emptyRecords = {
  maxWeight: null, maxReps: null, maxVolume: null, maxDurationSeconds: null,
};

describe('native exercise history owner isolation', () => {
  let sqlite: DatabaseSync;
  let previous: typeof localDB.db;

  function seed(
    id: string,
    owner: string | null,
    options: {
      exercise?: string;
      date?: string;
      sessionDeleted?: number | null;
      exerciseDeleted?: number | null;
      setDeleted?: number | null;
      completed?: boolean;
      weight?: number | null;
      reps?: number | null;
      seconds?: number | null;
    } = {},
  ) {
    const date = options.date ?? '2026-02-01';
    sqlite.prepare(`INSERT INTO workout_sessions (id, user_id, started_at, ended_at, deleted)
      VALUES (?, ?, ?, ?, ?)`).run(id, owner, date, date, options.sessionDeleted === undefined ? 0 : options.sessionDeleted);
    sqlite.prepare(`INSERT INTO workout_session_exercises (id, session_id, exercise_id, deleted)
      VALUES (?, ?, ?, ?)`).run(`${id}-exercise`, id, options.exercise ?? 'squat', options.exerciseDeleted === undefined ? 0 : options.exerciseDeleted);
    sqlite.prepare(`INSERT INTO workout_session_sets
      (id, session_exercise_id, actual_weight, actual_reps, actual_seconds, completed_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      `${id}-set`, `${id}-exercise`,
      options.weight === undefined ? 999 : options.weight,
      options.reps === undefined ? 999 : options.reps,
      options.seconds === undefined ? 999 : options.seconds,
      options.completed === false ? null : date,
      options.setDeleted === undefined ? 0 : options.setDeleted,
    );
  }

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    previous = localDB.db;
    // Execute production SQL on real SQLite; only adapt Expo's asynchronous API.
    Object.assign(localDB, { db: {
      execAsync: async (sql: string) => sqlite.exec(sql),
      getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
    } });
    await (localDB as unknown as { createTables(): Promise<void> }).createTables();
    seed('owned-old', 'owner-a', { date: '2026-01-01', weight: 100, reps: 5, seconds: null });
    seed('owned-new', 'owner-a', { date: '2026-01-02', weight: 80, reps: 10, seconds: 60,
      sessionDeleted: null, exerciseDeleted: null, setDeleted: null });
    seed('foreign', 'owner-b');
    seed('unknown', null);
    seed('blank-owner', '');
    seed('deleted-session', 'owner-a', { sessionDeleted: 1 });
    seed('deleted-exercise', 'owner-a', { exerciseDeleted: 1 });
    seed('deleted-set', 'owner-a', { setDeleted: 1 });
    seed('incomplete', 'owner-a', { completed: false });
    seed('other-exercise', 'owner-a', { exercise: 'deadlift' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localDB.db = previous;
    sqlite.close();
  });

  test('history includes only the requested owner and exercise, completed and undeleted across the graph', async () => {
    const history = await localDB.getExerciseHistory('owner-a', 'squat');
    expect(history.map(row => row.id)).toEqual(['owned-new-set', 'owned-old-set']);
    expect(history[0]).toEqual(expect.objectContaining({
      session_id: 'owned-new', session_exercise_id: 'owned-new-exercise', exercise_id: 'squat',
      actual_weight: 80, actual_reps: 10, actual_seconds: 60,
    }));
    expect((await localDB.getExerciseHistory('owner-b', 'squat')).map(row => row.id)).toEqual(['foreign-set']);
    expect(await localDB.getExerciseHistory('absent-owner', 'squat')).toEqual([]);
  });

  test('history preserves default, explicit, fractional and invalid limit behavior within the owner scope', async () => {
    for (let index = 0; index < 25; index++) {
      seed(`owned-extra-${index}`, 'owner-a', { date: '2025-12-01' });
    }
    expect(await localDB.getExerciseHistory('owner-a', 'squat')).toHaveLength(20);
    expect((await localDB.getExerciseHistory('owner-a', 'squat', 1.9)).map(row => row.id)).toEqual(['owned-new-set']);
    expect(await localDB.getExerciseHistory('owner-a', 'squat', 22)).toHaveLength(22);
    for (const limit of [0, -1, NaN, Infinity]) {
      expect(await localDB.getExerciseHistory('owner-a', 'squat', limit)).toHaveLength(20);
    }
  });

  test('owner and exercise identifiers are exact bound values, not SQL or inferred ownership', async () => {
    const owner = "owner' OR 1=1 --";
    const exercise = "squat' OR 1=1 --";
    expect(await localDB.getExerciseHistory(owner, 'squat')).toEqual([]);
    expect(await localDB.getPersonalRecords(owner, 'squat')).toEqual(emptyRecords);
    seed('literal-identifiers', owner, { exercise, weight: 12, reps: null, seconds: null });
    expect((await localDB.getExerciseHistory(owner, exercise)).map(row => row.id)).toEqual(['literal-identifiers-set']);
    expect(await localDB.getPersonalRecords(owner, exercise)).toEqual({ ...emptyRecords, maxWeight: 12 });
    expect(await localDB.getExerciseHistory('owner-a', exercise)).toEqual([]);
    expect(await localDB.getPersonalRecords('owner-a', exercise)).toEqual(emptyRecords);
    expect(await localDB.getExerciseHistory(' owner-a ', 'squat')).toEqual([]);
    expect(await localDB.getPersonalRecords(' owner-a ', 'squat')).toEqual(emptyRecords);
  });

  describe.each(['getExerciseHistory', 'getPersonalRecords'] as const)('%s', method => {
    test.each(['', ' ', '\t\n'])('rejects blank owner %j before initialization or database access', async userId => {
      const initialize = jest.spyOn(localDB, 'ensureInitialized');
      const query = jest.spyOn(localDB.db!, 'getAllAsync');
      await expect(localDB[method](userId, 'squat')).rejects.toThrow(/userId/);
      expect(initialize).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });
  });

  test('personal records aggregate only the requested owner and exercise over eligible graph rows', async () => {
    expect(await localDB.getPersonalRecords('owner-a', 'squat')).toEqual({
      maxWeight: 100, maxReps: 10, maxVolume: 800, maxDurationSeconds: 60,
    });
    expect(await localDB.getPersonalRecords('absent-owner', 'squat')).toEqual(emptyRecords);
    expect(await localDB.getPersonalRecords('owner-a', 'missing-exercise')).toEqual(emptyRecords);
    seed('null-values', 'owner-a', { exercise: 'empty-values', weight: null, reps: null, seconds: null });
    expect(await localDB.getPersonalRecords('owner-a', 'empty-values')).toEqual(emptyRecords);
  });
});
