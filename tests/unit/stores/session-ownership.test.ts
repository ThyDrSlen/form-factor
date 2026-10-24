import { cancelRestNotification, scheduleRestNotification } from '@/lib/services/rest-timer';
import { DatabaseSync } from 'node:sqlite';
import { localDB } from '@/lib/services/database/local-db';
import { accountCleanup } from '@/lib/services/database/account-cleanup';
import { onSessionFinished, subscribeToEvents, useSessionRunner } from '@/lib/stores/session-runner';
import { getWorkoutSessionHistoryDetail, listWorkoutSessionHistory } from '@/lib/services/workout-session-history';

jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));
let mockUser: string | null = 'a';
let mockAuthListener: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
function changeAccount(userId: string | null) {
  mockUser = userId;
  mockAuthListener?.(userId ? 'SIGNED_IN' : 'SIGNED_OUT', userId ? { user: { id: userId } } : null);
}
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: jest.fn((listener) => { mockAuthListener = listener; return { data: { subscription: { unsubscribe: jest.fn() } } }; }), getSession: jest.fn(async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null }, error: null })) }, from: jest.fn(() => { throw new Error('offline'); }) } }));
jest.mock('@/lib/services/rest-timer', () => ({ cancelRestNotification: jest.fn(), computeRemainingSeconds: jest.fn(() => 0), computeRestSeconds: jest.fn(() => 90), scheduleRestNotification: jest.fn(async () => 'notification') }));
jest.mock('@/lib/logger', () => ({ logWithTs: jest.fn(), errorWithTs: jest.fn(), warnWithTs: jest.fn() }));

let sqlite: DatabaseSync;
beforeEach(async () => {
  changeAccount('a');
  sqlite = new DatabaseSync(':memory:');
  Object.assign(localDB, { db: {
    execAsync: async (sql: string) => sqlite.exec(sql),
    prepareAsync: async (sql: string) => ({
      executeAsync: async (args: (string | number | null)[] = []) => sqlite.prepare(sql).run(...args),
      finalizeAsync: async () => {},
    }),
    runAsync: async (sql: string, args: (string | number | null)[] = []) => {
      const statement = await localDB.db!.prepareAsync(sql);
      try { return await statement.executeAsync(args); }
      finally { await statement.finalizeAsync(); }
    },
    getAllAsync: async (sql: string, args: (string | number | null)[] = []) => sqlite.prepare(sql).all(...args),
  } });
  await (localDB as unknown as { createTables(): Promise<void> }).createTables();
  jest.spyOn(localDB, 'initialize').mockResolvedValue();
  useSessionRunner.setState({ activeSession: null, exercises: [], sets: {}, error: null, restTimer: null });
});
afterEach(() => { jest.restoreAllMocks(); sqlite.close(); });

test('new offline session is immediately reviewable after finish and isolated on account switch', async () => {
  await useSessionRunner.getState().startSession({ name: 'Offline workout' });
  expect(useSessionRunner.getState().error).toBeNull();
  const id = useSessionRunner.getState().activeSession!.id;
  await useSessionRunner.getState().finishSession();
  expect(await getWorkoutSessionHistoryDetail('a', id)).toMatchObject({ id, name: 'Offline workout' });
  expect(await listWorkoutSessionHistory('b')).toEqual([]);
});

test('resume selects only the authenticated owner, even when cleanup failed', async () => {
  await useSessionRunner.getState().startSession();
  expect(useSessionRunner.getState().error).toBeNull();
  const id = useSessionRunner.getState().activeSession!.id;
  mockUser = 'b';
  await useSessionRunner.getState().loadActiveSession();
  expect(useSessionRunner.getState().activeSession).toBeNull();
  mockUser = 'a';
  await useSessionRunner.getState().loadActiveSession();
  expect(useSessionRunner.getState().activeSession?.id).toBe(id);
  sqlite.exec('UPDATE workout_sessions SET user_id = NULL');
  await useSessionRunner.getState().loadActiveSession();
  expect(useSessionRunner.getState().activeSession).toBeNull();
});

test('signed-out creation writes neither a session nor events', async () => {
  mockUser = null;
  await useSessionRunner.getState().startSession();
  expect(useSessionRunner.getState().error).toMatch(/sign.*in/i);
  expect(useSessionRunner.getState().activeSession).toBeNull();
  expect(sqlite.prepare('SELECT * FROM workout_sessions').all()).toEqual([]);
  expect(sqlite.prepare('SELECT * FROM workout_session_events').all()).toEqual([]);
});

test.each(['startSession', 'loadActiveSession'] as const)('%s rejects the old auth lifetime after A-B-A', async (action) => {
  await useSessionRunner.getState().startSession();
  const gate = holdNextExerciseRead();
  const pending = useSessionRunner.getState()[action]();
  await gate.entered;
  changeAccount('b');
  changeAccount('a');
  gate.release();
  await pending;
  expect(useSessionRunner.getState().activeSession).toBeNull();
  expect(useSessionRunner.getState().isWorkoutInProgress).toBe(false);
  expect(useSessionRunner.getState().isLoading).toBe(false);
  expect(useSessionRunner.getState().error).toBeNull();
});

test('finish invalidates a pending resume snapshot', async () => {
  await useSessionRunner.getState().startSession();
  const gate = holdNextExerciseRead();
  const pending = useSessionRunner.getState().loadActiveSession();
  await gate.entered;
  await useSessionRunner.getState().finishSession();
  gate.release();
  await pending;
  expect(useSessionRunner.getState().activeSession).toBeNull();
  expect(useSessionRunner.getState().isLoading).toBe(false);
  expect(sqlite.prepare('SELECT ended_at FROM workout_sessions').get()?.ended_at).not.toBeNull();
});

test('late finish does not clear a newer session', async () => {
  await useSessionRunner.getState().startSession();
  const oldId = useSessionRunner.getState().activeSession!.id;
  const gate = defer();
  jest.mocked(cancelRestNotification).mockImplementationOnce(() => gate.promise);
  const finishing = useSessionRunner.getState().finishSession();
  await useSessionRunner.getState().startSession({ name: 'New session' });
  const latest = useSessionRunner.getState().activeSession;
  gate.resolve();
  await finishing;
  expect(useSessionRunner.getState().activeSession).toEqual(latest);
  expect(sqlite.prepare('SELECT ended_at FROM workout_sessions WHERE id = ?').get(oldId)?.ended_at).not.toBeNull();
});

test('resume started during finish cannot restore the completed snapshot', async () => {
  await useSessionRunner.getState().startSession();
  const finishGate = defer();
  jest.mocked(cancelRestNotification).mockImplementationOnce(() => finishGate.promise);
  const finishing = useSessionRunner.getState().finishSession();
  const readGate = holdNextExerciseRead();
  const loading = useSessionRunner.getState().loadActiveSession();
  await readGate.entered;
  finishGate.resolve();
  await finishing;
  readGate.release();
  await loading;
  expect(useSessionRunner.getState().activeSession).toBeNull();
  expect(useSessionRunner.getState().isLoading).toBe(false);
});

test('finish cannot write after its auth lifetime ends even on A-B-A', async () => {
  await useSessionRunner.getState().startSession();
  const gate = defer();
  jest.mocked(cancelRestNotification).mockImplementationOnce(() => gate.promise);
  const finishing = useSessionRunner.getState().finishSession();
  changeAccount('b');
  changeAccount('a');
  await useSessionRunner.getState().loadActiveSession();
  const latest = useSessionRunner.getState().activeSession;
  const rejected = expect(finishing).rejects.toThrow(/account changed/i);
  gate.resolve();
  await rejected;
  expect(useSessionRunner.getState().activeSession).toEqual(latest);
  expect(sqlite.prepare('SELECT ended_at FROM workout_sessions').get()?.ended_at).toBeNull();
});

test.each([false, true])('committed finish event failure leaves no finished active state (replacement=%s)', async (replace) => {
  await useSessionRunner.getState().startSession();
  const oldId = useSessionRunner.getState().activeSession!.id;
  const entered = defer();
  const release = defer();
  const db = localDB.db!;
  const original = db.runAsync.bind(db);
  jest.spyOn(db, 'runAsync').mockImplementation(async (...args: Parameters<typeof db.runAsync>) => {
    if (args[0].includes('INSERT INTO workout_session_events') && JSON.stringify(args[1]).includes('session_completed')) {
      entered.resolve();
      await release.promise;
      throw new Error('event write failed');
    }
    return original(...args);
  });
  const finishing = useSessionRunner.getState().finishSession();
  const rejected = expect(finishing).rejects.toThrow('event write failed');
  await entered.promise;
  if (replace) await useSessionRunner.getState().startSession({ name: 'Replacement' });
  const expected = replace ? useSessionRunner.getState().activeSession : null;
  release.resolve();
  await rejected;
  expect(useSessionRunner.getState().activeSession).toEqual(expected);
  expect(sqlite.prepare('SELECT ended_at FROM workout_sessions WHERE id = ?').get(oldId)?.ended_at).not.toBeNull();
});

test('auth events clear published workout state synchronously without deleting offline rows', async () => {
  await useSessionRunner.getState().startSession();
  const id = useSessionRunner.getState().activeSession!.id;
  useSessionRunner.setState({ isPaused: true, totalPausedMs: 123, error: 'old error' });
  changeAccount('b');
  expect(useSessionRunner.getState()).toMatchObject({
    activeSession: null, exercises: [], sets: {}, formTargetsByExercise: {},
    exerciseSuggestionsByExerciseId: {}, restTimer: null, isPaused: false,
    totalPausedMs: 0, isWorkoutInProgress: false, isLoading: false, error: null,
  });
  changeAccount('a');
  await useSessionRunner.getState().loadActiveSession();
  expect(useSessionRunner.getState().activeSession?.id).toBe(id);
  mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'a' } });
  expect(useSessionRunner.getState().activeSession?.id).toBe(id);
  changeAccount(null);
  expect(useSessionRunner.getState().activeSession).toBeNull();
});

test('finish does not notify the next auth lifetime after a committed event await', async () => {
  await useSessionRunner.getState().startSession();
  const entered = defer();
  const release = defer();
  const db = localDB.db!;
  const original = db.runAsync.bind(db);
  jest.spyOn(db, 'runAsync').mockImplementation(async (...args: Parameters<typeof db.runAsync>) => {
    const result = await original(...args);
    if (args[0].includes('INSERT INTO workout_session_events') && JSON.stringify(args[1]).includes('session_completed')) {
      entered.resolve();
      await release.promise;
    }
    return result;
  });
  const finished = jest.fn();
  const events = jest.fn();
  const unsubscribe = onSessionFinished(finished);
  const unsubscribeEvents = subscribeToEvents(events);
  try {
    const finishing = useSessionRunner.getState().finishSession();
    await entered.promise;
    changeAccount('b');
    release.resolve();
    await finishing;
    expect(finished).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT ended_at FROM workout_sessions').get()?.ended_at).not.toBeNull();
  } finally {
    unsubscribe();
    unsubscribeEvents();
  }
});

test.each([
  ['switch', false],
  ['round-trip', false],
  ['sign-out', false],
  ['sign-out-in', false],
  ['switch', true],
] as const)(
  'finish stops listener fan-out when auth changes during an awaited listener (%s, rejects=%s)',
  async (transition, rejects) => {
    await useSessionRunner.getState().startSession();
    const sessionId = useSessionRunner.getState().activeSession!.id;
    const entered = defer();
    const release = defer();
    const first = jest.fn(async () => {
      entered.resolve();
      await release.promise;
      if (rejects) throw new Error('listener failed after auth transition');
    });
    const next = jest.fn();
    const unsubscribeFirst = onSessionFinished(first);
    const unsubscribeNext = onSessionFinished(next);
    try {
      const finishing = useSessionRunner.getState().finishSession();
      await entered.promise;
      changeAccount(transition === 'sign-out' || transition === 'sign-out-in' ? null : 'b');
      if (transition === 'round-trip' || transition === 'sign-out-in') changeAccount('a');
      release.resolve();
      await finishing;
      expect(first).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
      expect(sqlite.prepare('SELECT ended_at FROM workout_sessions WHERE id = ?').get(sessionId)).toEqual({
        ended_at: expect.any(String),
      });
    } finally {
      release.resolve();
      unsubscribeFirst();
      unsubscribeNext();
    }
  },
);

test('same-owner token refresh preserves delivery to later finish listeners', async () => {
  await useSessionRunner.getState().startSession();
  const entered = defer();
  const release = defer();
  const next = jest.fn();
  const unsubscribeFirst = onSessionFinished(async () => {
    entered.resolve();
    await release.promise;
  });
  const unsubscribeNext = onSessionFinished(next);
  try {
    const finishing = useSessionRunner.getState().finishSession();
    await entered.promise;
    mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'a' } });
    release.resolve();
    await finishing;
    expect(next).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
    unsubscribeFirst();
    unsubscribeNext();
  }
});

function defer() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('late addExercise cannot publish the previous account exercise into a new session', async () => {
  await useSessionRunner.getState().startSession({ name: 'A session' });
  const oldSession = useSessionRunner.getState().activeSession!;
  const gate = holdNextExerciseRead('FROM exercises WHERE id = ?');
  const pending = useSessionRunner.getState().addExercise('bench').catch((error: unknown) => error);
  await gate.entered;
  changeAccount('b');
  await useSessionRunner.getState().startSession({ name: 'B session' });
  const replacement = useSessionRunner.getState().activeSession;
  gate.release();
  const result = await pending;
  expect(useSessionRunner.getState().activeSession).toEqual(replacement);
  expect(useSessionRunner.getState().exercises).toEqual([]);
  expect(useSessionRunner.getState().sets).toEqual({});
  expect(result).toBeInstanceOf(Error);
  expect(sqlite.prepare('SELECT session_id FROM workout_session_exercises').all()).toEqual([
    { session_id: oldSession.id },
  ]);
  expect(sqlite.prepare('SELECT * FROM workout_session_sets').all()).toEqual([]);
});

test.each(['addExercise', 'addSet'] as const)('%s cannot publish after its write completes in a new account lifetime', async (action) => {
  await useSessionRunner.getState().startSession();
  const exerciseId = await useSessionRunner.getState().addExercise('bench');
  const entered = defer();
  const release = defer();
  const db = localDB.db!;
  const original = db.prepareAsync.bind(db);
  const table = action === 'addExercise' ? 'workout_session_exercises' : 'workout_session_sets';
  let held = false;
  jest.spyOn(db, 'prepareAsync').mockImplementation(async (sql) => {
    const statement = await original(sql);
    if (!held && sql.includes(`INSERT INTO ${table} `)) {
      held = true;
      const execute = statement.executeAsync.bind(statement);
      statement.executeAsync = (async (...args: Parameters<typeof statement.executeAsync>) => {
        const result = await execute(...args);
        entered.resolve();
        await release.promise;
        return result;
      }) as typeof statement.executeAsync;
    }
    return statement;
  });
  const pending = (action === 'addExercise'
    ? useSessionRunner.getState().addExercise('squat')
    : useSessionRunner.getState().addSet(exerciseId)).catch((error: unknown) => error);
  await entered.promise;
  changeAccount('b');
  await useSessionRunner.getState().startSession();
  const replacement = useSessionRunner.getState().activeSession;
  release.resolve();
  const result = await pending;
  expect(useSessionRunner.getState().activeSession).toEqual(replacement);
  expect(useSessionRunner.getState().sets).toEqual({});
  expect(useSessionRunner.getState().exercises).toEqual([]);
  expect(result).toBeInstanceOf(Error);
});

test.each(['exercise', 'event', 'set'] as const)('account switch during %s preparation prevents stale persistence', async (boundary) => {
  await useSessionRunner.getState().startSession();
  const exerciseId = await useSessionRunner.getState().addExercise('bench');
  const table = boundary === 'exercise' ? 'workout_session_exercises'
    : boundary === 'event' ? 'workout_session_events' : 'workout_session_sets';
  const before = sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  const entered = defer();
  const release = defer();
  const db = localDB.db!;
  const original = db.prepareAsync.bind(db);
  let held = false;
  const finalized = jest.fn();
  jest.spyOn(db, 'prepareAsync').mockImplementation(async (sql) => {
    const statement = await original(sql);
    if (!held && sql.includes(`INSERT INTO ${table} `)) {
      held = true;
      statement.finalizeAsync = finalized;
      entered.resolve();
      await release.promise;
    }
    return statement;
  });
  const pending = (boundary === 'set' ? useSessionRunner.getState().addSet(exerciseId)
    : useSessionRunner.getState().addExercise('squat')).catch((error: unknown) => error);
  await entered.promise;
  changeAccount('b');
  release.resolve();
  const result = await pending;
  expect(sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(before);
  expect(result).toBeInstanceOf(Error);
  expect(finalized).toHaveBeenCalledTimes(1);
  expect(useSessionRunner.getState().exercises).toEqual([]);
  expect(useSessionRunner.getState().sets).toEqual({});
});

test.each(['round-trip', 'sign-out-in', 'replacement', 'finish', 'cleanup'] as const)(
  'late exercise metadata cannot cross %s boundaries', async (transition) => {
    await useSessionRunner.getState().startSession();
    const gate = holdNextExerciseRead('FROM exercises WHERE id = ?');
    const pending = useSessionRunner.getState().addExercise('bench').catch((error: unknown) => error);
    await gate.entered;
    if (transition === 'round-trip' || transition === 'sign-out-in') {
      changeAccount(transition === 'round-trip' ? 'b' : null);
      changeAccount('a');
      await useSessionRunner.getState().loadActiveSession();
    } else if (transition === 'replacement') {
      await useSessionRunner.getState().startSession();
    } else if (transition === 'finish') {
      await useSessionRunner.getState().finishSession();
    } else {
      await accountCleanup.run(async () => {});
    }
    const { activeSession, exercises, sets } = useSessionRunner.getState();
    gate.release();
    expect(await pending).toBeInstanceOf(Error);
    expect(useSessionRunner.getState()).toMatchObject({ activeSession, exercises, sets });
    expect(sqlite.prepare('SELECT * FROM workout_session_sets').all()).toEqual([]);
  },
);

test('same-owner refresh allows the pending exercise and first set to finish', async () => {
  await useSessionRunner.getState().startSession();
  const gate = holdNextExerciseRead('FROM exercises WHERE id = ?');
  const pending = useSessionRunner.getState().addExercise('bench');
  await gate.entered;
  mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'a' } });
  gate.release();
  const id = await pending;
  expect(useSessionRunner.getState().exercises.map((exercise) => exercise.id)).toEqual([id]);
  expect(useSessionRunner.getState().sets[id]).toHaveLength(1);
});

test.each(['unknown', 'previous-session'] as const)('addSet rejects an %s exercise without writing', async (parent) => {
  await useSessionRunner.getState().startSession();
  const id = parent === 'unknown' ? 'missing' : await useSessionRunner.getState().addExercise('bench');
  if (parent === 'previous-session') await useSessionRunner.getState().startSession();
  const before = sqlite.prepare('SELECT * FROM workout_session_sets').all();
  await expect(useSessionRunner.getState().addSet(id)).rejects.toThrow();
  expect(sqlite.prepare('SELECT * FROM workout_session_sets').all()).toEqual(before);
  expect(useSessionRunner.getState().sets).toEqual({});
});

test('exercise events stop fan-out when an earlier subscriber changes account', async () => {
  await useSessionRunner.getState().startSession();
  const first = jest.fn(() => changeAccount('b'));
  const next = jest.fn();
  const unsubscribeFirst = subscribeToEvents(first);
  const unsubscribeNext = subscribeToEvents(next);
  try {
    await expect(useSessionRunner.getState().addExercise('bench')).rejects.toThrow();
    expect(first).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(useSessionRunner.getState().exercises).toEqual([]);
  } finally {
    unsubscribeFirst();
    unsubscribeNext();
  }
});

describe('skipRest lifetime', () => {
  test.each(['switch', 'return', 'replacement'] as const)('cancel continuation preserves state after %s', async (transition) => {
    await useSessionRunner.getState().startSession();
    const exerciseId = await useSessionRunner.getState().addExercise('bench');
    const setId = useSessionRunner.getState().sets[exerciseId][0].id;
    const timer = { setId, startedAt: new Date().toISOString(), targetSeconds: 90 };
    useSessionRunner.setState({ restTimer: timer });
    const published = useSessionRunner.getState();
    const entered = defer();
    const release = defer();
    jest.mocked(cancelRestNotification).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const events = jest.fn();
    const unsubscribe = subscribeToEvents(events);
    try {
      const pending = useSessionRunner.getState().skipRest().catch((error: unknown) => error);
      await entered.promise;
      if (transition !== 'replacement') changeAccount('b');
      if (transition === 'return') {
        changeAccount('a');
        useSessionRunner.setState({ activeSession: published.activeSession, exercises: published.exercises, sets: published.sets });
      } else if (transition === 'switch') {
        await useSessionRunner.getState().startSession();
      }
      const replacement = { ...timer, targetSeconds: 120 };
      useSessionRunner.setState({ restTimer: replacement });
      events.mockClear();
      release.resolve();
      await pending;
      expect(sqlite.prepare('SELECT rest_skipped FROM workout_session_sets WHERE id = ?').get(setId)?.rest_skipped).toBe(0);
      expect(sqlite.prepare("SELECT * FROM workout_session_events WHERE type = 'rest_skipped'").all()).toEqual([]);
      expect(events).not.toHaveBeenCalled();
      expect(useSessionRunner.getState().restTimer).toBe(replacement);
    } finally {
      release.resolve();
      unsubscribe();
    }
  });
});

describe('completeSet auth lifetime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(scheduleRestNotification).mockClear();
  });
  afterEach(() => {
    changeAccount(null);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test.each(['event-prepare', 'event-commit', 'notification'] as const)(
    'completeSet suppresses late continuation at %s', async (boundary) => {
      await useSessionRunner.getState().startSession();
      const exerciseId = await useSessionRunner.getState().addExercise('bench');
      const setId = useSessionRunner.getState().sets[exerciseId][0].id;
      const entered = defer();
      const release = defer();
      const db = localDB.db!;
      const original = db.prepareAsync.bind(db);
      let held = false;
      if (boundary === 'notification') {
        jest.mocked(scheduleRestNotification).mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
          return 'already-scheduled';
        });
      } else {
        jest.spyOn(db, 'prepareAsync').mockImplementation(async (sql) => {
          const statement = await original(sql);
          if (!held && sql.includes('INSERT INTO workout_session_events')) {
            held = true;
            if (boundary === 'event-prepare') {
              entered.resolve();
              await release.promise;
            } else {
              const execute = statement.executeAsync.bind(statement);
              statement.executeAsync = (async (...args: Parameters<typeof statement.executeAsync>) => {
                const result = await execute(...args);
                entered.resolve();
                await release.promise;
                return result;
              }) as typeof statement.executeAsync;
            }
          }
          return statement;
        });
      }
      const events = jest.fn();
      const unsubscribe = subscribeToEvents(events);
      try {
        const pending = useSessionRunner.getState().completeSet(setId).catch((error: unknown) => error);
        await entered.promise;
        const published = useSessionRunner.getState();
        changeAccount('b');
        changeAccount('a');
        // Restore identical visible session identity; identity snapshots alone
        // must not reauthorize an operation from the earlier lifetime.
        useSessionRunner.setState({ activeSession: published.activeSession, exercises: published.exercises, sets: published.sets });
        events.mockClear();
        release.resolve();
        expect(await pending).toBeInstanceOf(Error);
        expect(events).not.toHaveBeenCalled();
        expect(useSessionRunner.getState().restTimer).toBeNull();
        expect(useSessionRunner.getState().restTimerCompletionTimeout).toBeNull();
        const persisted = sqlite.prepare("SELECT type FROM workout_session_events WHERE type IN ('set_completed', 'rest_started') ORDER BY type").all();
        expect(persisted).toEqual(boundary === 'event-prepare' ? [] : boundary === 'event-commit'
          ? [{ type: 'set_completed' }] : [{ type: 'rest_started' }, { type: 'set_completed' }]);
        if (boundary !== 'notification') expect(scheduleRestNotification).not.toHaveBeenCalled();
      } finally {
        release.resolve();
        unsubscribe();
      }
    },
  );

  test.each(['switch', 'sign-out', 'return'] as const)('notification receives a lifetime guard for %s', async (transition) => {
    await useSessionRunner.getState().startSession();
    const exerciseId = await useSessionRunner.getState().addExercise('bench');
    const setId = useSessionRunner.getState().sets[exerciseId][0].id;
    await useSessionRunner.getState().completeSet(setId);
    const guard = jest.mocked(scheduleRestNotification).mock.calls[0][3];
    expect(guard).toEqual(expect.any(Function));
    expect(guard!()).toBe(true);
    jest.mocked(cancelRestNotification).mockClear();
    mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'a' } });
    expect(guard!()).toBe(true);
    expect(cancelRestNotification).not.toHaveBeenCalled();
    const published = useSessionRunner.getState();
    changeAccount(transition === 'sign-out' ? null : 'b');
    if (transition === 'return') {
      changeAccount('a');
      useSessionRunner.setState({ activeSession: published.activeSession, exercises: published.exercises, sets: published.sets });
    }
    expect(guard!()).toBe(false);
    expect(cancelRestNotification).toHaveBeenCalled();
  });

  test('same-owner refresh permits legitimate completion and rest publication', async () => {
    await useSessionRunner.getState().startSession();
    const exerciseId = await useSessionRunner.getState().addExercise('bench');
    const setId = useSessionRunner.getState().sets[exerciseId][0].id;
    const entered = defer();
    const release = defer();
    jest.mocked(scheduleRestNotification).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return 'valid-notification';
    });
    const pending = useSessionRunner.getState().completeSet(setId);
    await entered.promise;
    mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'a' } });
    release.resolve();
    await pending;
    expect(useSessionRunner.getState().sets[exerciseId][0].completed_at).not.toBeNull();
    expect(useSessionRunner.getState().restTimer).toMatchObject({ setId, targetSeconds: 90 });
    expect(useSessionRunner.getState().restTimerCompletionTimeout).not.toBeNull();
    expect(sqlite.prepare("SELECT type FROM workout_session_events WHERE session_set_id = ? ORDER BY type").all(setId)).toEqual([
      { type: 'rest_started' }, { type: 'set_completed' },
    ]);
  });

  test.each(['switch', 'round-trip', 'sign-out'] as const)(
    'committed set does not publish events or restore rest after %s', async (transition) => {
      await useSessionRunner.getState().startSession();
      const exerciseId = await useSessionRunner.getState().addExercise('bench');
      const setId = useSessionRunner.getState().sets[exerciseId][0].id;
      const entered = defer();
      const release = defer();
      const db = localDB.db!;
      const original = db.runAsync.bind(db);
      jest.spyOn(db, 'runAsync').mockImplementation(async (...args: Parameters<typeof db.runAsync>) => {
        const result = await original(...args);
        if (args[0].includes('completed_at = ?, rest_target_seconds')) {
          entered.resolve();
          await release.promise;
        }
        return result;
      });
      const events = jest.fn();
      const unsubscribe = subscribeToEvents(events);
      try {
        const pending = useSessionRunner.getState().completeSet(setId).catch((error: unknown) => error);
        await entered.promise;
        // This write committed while authorized. Cancellation must not undo it.
        expect(sqlite.prepare('SELECT completed_at FROM workout_session_sets WHERE id = ?').get(setId)?.completed_at).not.toBeNull();
        changeAccount(transition === 'sign-out' ? null : 'b');
        if (transition === 'round-trip') changeAccount('a');
        if (transition !== 'sign-out') await useSessionRunner.getState().startSession();
        const replacement = useSessionRunner.getState().activeSession;
        events.mockClear();
        release.resolve();
        await pending;
        expect(events).not.toHaveBeenCalled();
        expect(sqlite.prepare("SELECT * FROM workout_session_events WHERE type IN ('set_completed', 'rest_started')").all()).toEqual([]);
        expect(useSessionRunner.getState()).toMatchObject({ activeSession: replacement, sets: {}, restTimer: null, restTimerCompletionTimeout: null });
        expect(scheduleRestNotification).not.toHaveBeenCalled();
        expect(sqlite.prepare('SELECT completed_at FROM workout_session_sets WHERE id = ?').get(setId)?.completed_at).not.toBeNull();
      } finally {
        release.resolve();
        unsubscribe();
      }
    },
  );
});

// Delay only delivery; queries still execute against the real SQLite schema.
function holdNextExerciseRead(query = 'FROM workout_session_exercises WHERE session_id') {
  const entered = defer();
  const release = defer();
  const db = localDB.db!;
  const original = db.getAllAsync.bind(db);
  let held = false;
  jest.spyOn(db, 'getAllAsync').mockImplementation(async (...args: Parameters<typeof db.getAllAsync>) => {
    const rows = await original(...args);
    if (!held && args[0].includes(query)) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return rows;
  });
  return { entered: entered.promise, release: release.resolve };
}

test.each(['startSession', 'loadActiveSession'] as const)('%s discards hydration after an account switch', async (action) => {
  if (action === 'loadActiveSession') {
    await useSessionRunner.getState().startSession();
    useSessionRunner.setState({ activeSession: null });
  }
  const gate = holdNextExerciseRead();
  const pending = useSessionRunner.getState()[action]();
  await gate.entered;
  mockUser = 'b';
  gate.release();
  await pending;
  expect(useSessionRunner.getState().activeSession).toBeNull();
  expect(useSessionRunner.getState().isLoading).toBe(false);
  expect(sqlite.prepare('SELECT DISTINCT user_id FROM workout_sessions').all()).toEqual([{ user_id: 'a' }]);
});

test.each(['startSession', 'loadActiveSession'] as const)('%s cannot overwrite a newer session request', async (action) => {
  if (action === 'loadActiveSession') await useSessionRunner.getState().startSession();
  const gate = holdNextExerciseRead();
  const pending = useSessionRunner.getState()[action]();
  await gate.entered;
  await useSessionRunner.getState().startSession({ name: 'New request' });
  const latest = useSessionRunner.getState().activeSession;
  gate.release();
  await pending;
  expect(useSessionRunner.getState().activeSession).toEqual(latest);
  expect(useSessionRunner.getState().error).toBeNull();
});

test.each(['startSession', 'loadActiveSession'] as const)('%s discards hydration after sign-out', async (action) => {
  if (action === 'loadActiveSession') {
    await useSessionRunner.getState().startSession();
    useSessionRunner.setState({ activeSession: null });
  }
  const gate = holdNextExerciseRead();
  const pending = useSessionRunner.getState()[action]();
  await gate.entered;
  mockUser = null;
  gate.release();
  await pending;
  expect(useSessionRunner.getState().activeSession).toBeNull();
  expect(useSessionRunner.getState().isLoading).toBe(false);
});

test('an old empty resume cannot clear a newer account session', async () => {
  const gate = holdNextExerciseRead('FROM workout_sessions WHERE ended_at');
  const pending = useSessionRunner.getState().loadActiveSession();
  await gate.entered;
  mockUser = 'b';
  await useSessionRunner.getState().startSession({ name: 'Account B' });
  const latest = useSessionRunner.getState().activeSession;
  gate.release();
  await pending;
  expect(useSessionRunner.getState().activeSession).toEqual(latest);
  expect(useSessionRunner.getState().error).toBeNull();
});

test('stale active state cannot finish another account session', async () => {
  await useSessionRunner.getState().startSession();
  mockUser = 'b';
  await expect(useSessionRunner.getState().finishSession()).rejects.toThrow();
  expect(sqlite.prepare('SELECT ended_at FROM workout_sessions').get()).toEqual({ ended_at: null });
});
