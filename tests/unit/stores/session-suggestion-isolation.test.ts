import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';
import { supabase } from '@/lib/supabase';
import { useSessionRunner } from '@/lib/stores/session-runner';
import { errorWithTs } from '@/lib/logger';

jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID() }));
let mockUser: string | null = 'a';
let mockAuthListener: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
function changeAccount(userId: string | null) {
  mockUser = userId;
  mockAuthListener?.(userId ? 'SIGNED_IN' : 'SIGNED_OUT', userId ? { user: { id: userId } } : null);
}
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: {
    onAuthStateChange: jest.fn(listener => {
      mockAuthListener = listener;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    getSession: jest.fn(async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null }, error: null })),
  },
  from: jest.fn(() => { throw new Error('No network permitted'); }),
} }));
jest.mock('@/lib/services/rest-timer', () => ({ cancelRestNotification: jest.fn(), computeRemainingSeconds: jest.fn(() => 0) }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

let sqlite: DatabaseSync;
let previousDb: typeof localDB.db;
beforeEach(async () => {
  jest.clearAllMocks();
  changeAccount(null);
  changeAccount('a');
  sqlite = new DatabaseSync(':memory:');
  previousDb = localDB.db;
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  sqlite.exec("INSERT INTO exercises (id, name) VALUES ('squat', 'Squat')");
  useSessionRunner.setState({ activeSession: null, exercises: [], sets: {}, exerciseSuggestionsByExerciseId: {}, error: null, restTimer: null });
});
afterEach(() => {
  jest.restoreAllMocks();
  localDB.db = previousDb;
  sqlite.close();
});

test('signed-out suggestion loading returns no recommendation and performs no history reads', async () => {
  changeAccount(null);
  const history = jest.spyOn(localDB, 'getExerciseHistory');
  const records = jest.spyOn(localDB, 'getPersonalRecords');
  await expect(useSessionRunner.getState().loadExerciseSuggestion('squat')).resolves.toBeNull();
  expect(history).not.toHaveBeenCalled();
  expect(records).not.toHaveBeenCalled();
  expect(useSessionRunner.getState().exerciseSuggestionsByExerciseId).toEqual({});
  expect(supabase.from).not.toHaveBeenCalled();
});

function defer() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

type ReadStage = 'auth' | 'exercise' | 'history' | 'records';
function holdRead(stage: ReadStage, failure?: Error) {
  const entered = defer();
  const release = defer();
  if (stage === 'auth') {
    const original = supabase.auth.getSession.bind(supabase.auth);
    jest.spyOn(supabase.auth, 'getSession').mockImplementationOnce(async () => {
      const result = await original();
      entered.resolve();
      await release.promise;
      return result;
    });
  } else {
    const db = localDB.db!;
    const original = db.getAllAsync.bind(db);
    let held = false;
    const fragment = { exercise: 'FROM exercises WHERE', history: 'ws.id,', records: 'MAX(ws.actual_weight)' }[stage];
    jest.spyOn(db, 'getAllAsync').mockImplementation(async (...args: Parameters<typeof db.getAllAsync>) => {
      const result = await original(...args);
      if (!held && args[0].includes(fragment)) {
        held = true;
        entered.resolve();
        await release.promise;
        if (failure) throw failure;
      }
      return result;
    });
  }
  return { entered: entered.promise, release: release.resolve };
}

describe.each(['auth', 'exercise', 'history', 'records'] as const)('pending %s read', stage => {
  test.each(['switch', 'round-trip', 'sign-out', 'sign-out-in'] as const)('rejects %s lifetime without publishing', async transition => {
    // Establish the initial observed owner before pausing a captured read.
    await useSessionRunner.getState().loadExerciseSuggestion('squat');
    const history = jest.spyOn(localDB, 'getExerciseHistory');
    const records = jest.spyOn(localDB, 'getPersonalRecords');
    const gate = holdRead(stage);
    const pending = useSessionRunner.getState().loadExerciseSuggestion('squat');
    await gate.entered;
    changeAccount(transition.startsWith('sign-out') ? null : 'b');
    if (transition === 'round-trip' || transition === 'sign-out-in') changeAccount('a');
    gate.release();
    await expect(pending).resolves.toBeNull();
    expect(useSessionRunner.getState().exerciseSuggestionsByExerciseId).toEqual({});
    if (stage === 'auth' || stage === 'exercise') expect(history).not.toHaveBeenCalled();
    if (stage !== 'records') expect(records).not.toHaveBeenCalled();
  });
});

test('current owner is supplied to both history APIs without network access', async () => {
  const history = jest.spyOn(localDB, 'getExerciseHistory');
  const records = jest.spyOn(localDB, 'getPersonalRecords');
  const suggestion = await useSessionRunner.getState().loadExerciseSuggestion('squat');
  expect(suggestion?.exerciseId).toBe('squat');
  expect(history).toHaveBeenCalledWith('a', 'squat', 24);
  expect(records).toHaveBeenCalledWith('a', 'squat');
  expect(useSessionRunner.getState().getExerciseSuggestionFor('squat')).toEqual(suggestion);
  expect(supabase.from).not.toHaveBeenCalled();
});

test('same-owner token refresh does not invalidate the current suggestion', async () => {
  const gate = holdRead('history');
  const pending = useSessionRunner.getState().loadExerciseSuggestion('squat');
  await gate.entered;
  mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'a' } });
  gate.release();
  await expect(pending).resolves.toMatchObject({ exerciseId: 'squat' });
});

function seedHistory(userId: string | null, weight: number) {
  const id = `history-${userId ?? 'unknown'}`;
  sqlite.prepare('INSERT INTO workout_sessions (id, user_id, started_at, ended_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, '2026-01-01', '2026-01-02');
  sqlite.prepare('INSERT INTO workout_session_exercises (id, session_id, exercise_id) VALUES (?, ?, ?)')
    .run(id, id, 'squat');
  sqlite.prepare('INSERT INTO workout_session_sets (id, session_exercise_id, actual_weight, actual_reps, completed_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, id, weight, 5, '2026-01-02');
}

type BulkAction = 'startSession' | 'loadActiveSession';
function prepareBulk(action: BulkAction) {
  seedHistory('a', 100);
  seedHistory('b', 999);
  seedHistory(null, 9999);
  if (action === 'startSession') {
    sqlite.exec(`INSERT INTO workout_templates (id, name) VALUES ('template', 'Test template');
      INSERT INTO workout_template_exercises (id, template_id, exercise_id) VALUES ('template-squat', 'template', 'squat');`);
  } else {
    sqlite.exec(`INSERT INTO workout_sessions (id, user_id, started_at) VALUES ('active', 'a', '2026-01-03');
      INSERT INTO workout_session_exercises (id, session_id, exercise_id) VALUES ('active-squat', 'active', 'squat');`);
  }
}
function loadBulk(action: BulkAction) {
  return action === 'startSession'
    ? useSessionRunner.getState().startSession({ templateId: 'template' })
    : useSessionRunner.getState().loadActiveSession();
}

test.each(['startSession', 'loadActiveSession'] as const)('%s recommendations use only the captured session owner', async action => {
  prepareBulk(action);
  const history = jest.spyOn(localDB, 'getExerciseHistory');
  const records = jest.spyOn(localDB, 'getPersonalRecords');
  await loadBulk(action);
  expect(useSessionRunner.getState().error).toBeNull();
  expect(history).toHaveBeenCalledWith('a', 'squat', 24);
  expect(records).toHaveBeenCalledWith('a', 'squat');
  expect(useSessionRunner.getState().getExerciseSuggestionFor('squat')).toMatchObject({
    exerciseId: 'squat', lastSessionWeight: 100,
  });
});

describe.each(['startSession', 'loadActiveSession'] as const)('%s bulk suggestion cancellation', action => {
  test.each(['exercise', 'history', 'records'] as const)('stops after a stale %s read and does not continue other recommendations', async stage => {
    prepareBulk(action);
    sqlite.exec("INSERT INTO exercises (id, name) VALUES ('bench', 'Bench Press')");
    if (action === 'startSession') {
      sqlite.exec("INSERT INTO workout_template_exercises (id, template_id, exercise_id, sort_order) VALUES ('template-bench', 'template', 'bench', 1)");
    } else {
      sqlite.exec("INSERT INTO workout_session_exercises (id, session_id, exercise_id, sort_order) VALUES ('active-bench', 'active', 'bench', 1)");
    }
    const history = jest.spyOn(localDB, 'getExerciseHistory');
    const records = jest.spyOn(localDB, 'getPersonalRecords');
    const gate = holdRead(stage);
    const pending = loadBulk(action);
    await gate.entered;
    changeAccount('b');
    changeAccount('a');
    gate.release();
    await pending;
    expect(useSessionRunner.getState().activeSession).toBeNull();
    expect(useSessionRunner.getState().exerciseSuggestionsByExerciseId).toEqual({});
    expect(history).toHaveBeenCalledTimes(stage === 'exercise' ? 0 : 1);
    expect(records).toHaveBeenCalledTimes(stage === 'records' ? 1 : 0);
    expect(useSessionRunner.getState().error).toBeNull();
  });
});

test.each(['single', 'startSession', 'loadActiveSession'] as const)('%s drops a stale read error without logging it into the next lifetime', async action => {
  if (action !== 'single') prepareBulk(action);
  const gate = holdRead('history', new Error('old account read failed'));
  const pending = action === 'single'
    ? useSessionRunner.getState().loadExerciseSuggestion('squat')
    : loadBulk(action);
  await gate.entered;
  changeAccount('b');
  changeAccount('a');
  gate.release();
  await pending;
  expect(useSessionRunner.getState().exerciseSuggestionsByExerciseId).toEqual({});
  expect(errorWithTs).not.toHaveBeenCalled();
});

test('a session change not yet delivered through auth events is caught before publication', async () => {
  const gate = holdRead('records');
  const pending = useSessionRunner.getState().loadExerciseSuggestion('squat');
  await gate.entered;
  mockUser = 'b';
  gate.release();
  await expect(pending).resolves.toBeNull();
  expect(useSessionRunner.getState().exerciseSuggestionsByExerciseId).toEqual({});
});

test('an older recommendation cannot replace a newer snapshot for the same exercise', async () => {
  seedHistory('a', 100);
  const gate = holdRead('history');
  const old = useSessionRunner.getState().loadExerciseSuggestion('squat');
  await gate.entered;
  sqlite.exec("UPDATE workout_session_sets SET actual_weight = 200 WHERE id = 'history-a'");
  const latest = await useSessionRunner.getState().loadExerciseSuggestion('squat');
  expect(latest?.lastSessionWeight).toBe(200);
  gate.release();
  await expect(old).resolves.toBeNull();
  expect(useSessionRunner.getState().getExerciseSuggestionFor('squat')).toEqual(latest);
});
