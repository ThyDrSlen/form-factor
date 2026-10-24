import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';
import { getWorkoutSessionHistoryDetail, listWorkoutSessionHistory } from '@/lib/services/workout-session-history';

jest.mock('@/lib/services/database/local-db', () => ({ localDB: { supportsWorkoutSync: true, initialize: jest.fn(), db: null } }));

const mockOwnedIds = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn(() => ({ select: () => ({ eq: (column: string, userId: string) => ({ order: () => ({ range: (start: number, end: number) => mockOwnedIds(column, userId, start, end) }) }) }) })) } }));

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE workout_sessions (id TEXT, user_id TEXT, name TEXT, started_at TEXT, ended_at TEXT, deleted INTEGER);
    CREATE TABLE workout_session_exercises (id TEXT, session_id TEXT, exercise_id TEXT, sort_order INTEGER, deleted INTEGER);
    CREATE TABLE workout_session_sets (id TEXT, session_exercise_id TEXT, sort_order INTEGER, set_type TEXT, actual_reps INTEGER, actual_seconds INTEGER, actual_weight REAL, completed_at TEXT, deleted INTEGER);
    CREATE TABLE exercises (id TEXT, name TEXT, deleted INTEGER);
    INSERT INTO workout_sessions VALUES ('mine','u1','Upper','2026-01-01','2026-01-02',0), ('other','u2','Private','2026-01-01','2026-01-02',0), ('active','u1','Active','2026-01-01',NULL,0), ('deleted','u1','Deleted','2026-01-01','2026-01-02',1);
    INSERT INTO workout_session_exercises VALUES ('e1','mine','bench',0,0), ('e2','mine','squat',1,0), ('e3','mine','bench',2,1);
    INSERT INTO exercises VALUES ('bench','Bench press',0),('squat','Squat',0);
    INSERT INTO workout_session_sets VALUES ('s1','e1',0,'normal',8,NULL,100,'2026-01-01',0), ('planned','e1',1,'normal',NULL,NULL,NULL,NULL,0), ('deleted','e1',2,'normal',8,NULL,100,'2026-01-01',1), ('orphan','e3',0,'normal',8,NULL,100,'2026-01-01',0);
  `);
  sqlite.exec("INSERT INTO workout_sessions VALUES ('unknown',NULL,'Unattributed','2026-01-01','2026-01-02',0)");
  mockOwnedIds.mockReset().mockImplementation(async (_column: string, userId: string) => ({ data: (userId === 'u1' ? ['mine', 'deleted', 'active'] : ['other']).map(id => ({ id })), error: null }));
  Object.assign(localDB, { supportsWorkoutSync: true, db: {
    getAllAsync: jest.fn(async (sql: string, args: string[] = []) => sqlite.prepare(sql).all(...args)),
  } });
});
afterEach(() => sqlite.close());

test('detail includes only actual completed sets and enforces ownership even with a known ID', async () => {
  const detail = await getWorkoutSessionHistoryDetail('u1', 'mine');
  expect(detail?.exercises).toEqual([{ id: 'e1', name: 'Bench press', sets: [{ id: 's1', sort_order: 0, set_type: 'normal', actual_reps: 8, actual_seconds: null, actual_weight: 100, completed_at: '2026-01-01' }] }]);
  expect(await getWorkoutSessionHistoryDetail('u2', 'mine')).toBeNull();
  expect(await getWorkoutSessionHistoryDetail('u1', 'deleted')).toBeNull();
  expect(await getWorkoutSessionHistoryDetail('u1', 'active')).toBeNull();
});

test('history preserves canonical precision, null, and zero without changing stored weights', async () => {
  const pounds = 20.55555 * 2.20462;
  const insert = sqlite.prepare(`INSERT INTO workout_session_sets VALUES (?, 'e2', ?, 'normal', 8, NULL, ?, '2026-01-01', 0)`);
  insert.run('unset-load', 0, null);
  insert.run('zero-load', 1, 0);
  insert.run('precise-load', 2, pounds);
  const before = sqlite.prepare('SELECT id, actual_weight FROM workout_session_sets ORDER BY id').all();

  for (let read = 0; read < 2; read += 1) {
    const detail = await getWorkoutSessionHistoryDetail('u1', 'mine');
    expect(detail?.exercises.find(exercise => exercise.id === 'e2')?.sets.map(set => set.actual_weight))
      .toEqual([null, 0, pounds]);
  }
  expect(sqlite.prepare('SELECT id, actual_weight FROM workout_session_sets ORDER BY id').all()).toEqual(before);
});

test.each(['list', 'detail'])('%s rejects missing identity and unsupported storage distinctly', async (operation) => {
  const run = (user: string) => operation === 'list' ? listWorkoutSessionHistory(user) : getWorkoutSessionHistoryDetail(user, 'mine');
  await expect(run(' ')).rejects.toMatchObject({ code: 'authentication-required' });
  Object.assign(localDB, { supportsWorkoutSync: false });
  await expect(run('u1')).rejects.toMatchObject({ code: 'unsupported-platform' });
  expect(localDB.db!.getAllAsync).not.toHaveBeenCalled();
});

test('persisted ownership permits immediate offline review and never claims unknown rows', async () => {
  mockOwnedIds.mockRejectedValue(new Error('offline'));
  expect(await listWorkoutSessionHistory('u1')).toHaveLength(1);
  expect(await getWorkoutSessionHistoryDetail('u1', 'mine')).not.toBeNull();
  expect(await getWorkoutSessionHistoryDetail('u2', 'mine')).toBeNull();
  expect(await getWorkoutSessionHistoryDetail('u1', 'unknown')).toBeNull();
  expect(await listWorkoutSessionHistory('new-account')).toEqual([]);
  expect(mockOwnedIds).not.toHaveBeenCalled();
});

test('lists only owned finished sessions and counts only live exercises with completed sets', async () => {
  expect(await listWorkoutSessionHistory('u1')).toEqual([{ id: 'mine', name: 'Upper', started_at: '2026-01-01', ended_at: '2026-01-02', completed_exercise_count: 1, completed_set_count: 1 }]);
});
