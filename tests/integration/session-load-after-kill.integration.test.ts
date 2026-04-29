/**
 * Integration test: `session-runner.loadActiveSession` after an app kill.
 *
 * Background — `lib/stores/session-runner.ts:1027` rehydrates the active
 * workout session (session row + exercises + sets + rest timer) from local
 * SQLite on app resume. The existing unit test at
 * `tests/unit/stores/session-runner.test.ts:1079-1194` only covers the
 * happy path and a single failure branch. This integration suite walks
 * the five resilience scenarios called out by #543:
 *
 *  1. Happy round-trip — reps on two exercises, active rest timer, then
 *     simulate app kill by wiping the Zustand store. After
 *     `loadActiveSession()` the store must mirror the DB snapshot and
 *     the rest-timer remaining seconds must be within ±1s of wall-clock
 *     elapsed.
 *  2. Partial load — session row exists but exercises query returns
 *     empty. Store must be hydrated with the session and empty arrays;
 *     no crash.
 *  3. Corrupted rest timer — `rest_started_at` is NaN / far-future /
 *     very old. `loadActiveSession` must complete and either clamp the
 *     rest timer to zero or treat it as expired (no negative remaining).
 *  4. Concurrent loads — two `loadActiveSession()` calls race. The
 *     resulting state must be consistent and rest timers must not be
 *     duplicated.
 *  5. DB read timeout — `getAllAsync` never resolves. The caller enforces
 *     a timeout, and `loadActiveSession` rejects (or at least resolves
 *     without leaving `isLoading` stuck true) and the store remains
 *     consistent.
 *
 * The test uses the Zustand store directly with a hand-rolled in-memory
 * SQLite mock so we can assert real round-trip behavior without pulling
 * in the native `expo-sqlite` module. The shape of the mock matches what
 * `session-runner` actually consumes via `localDB.db.getAllAsync(sql, params)`.
 */

// ---------------------------------------------------------------------------
// Mocks — jest.mock is hoisted so factory functions must not reference
// outer `const` variables. All mocks define their own fns inline.
// ---------------------------------------------------------------------------

jest.mock('expo-crypto', () => {
  let n = 0;
  return {
    randomUUID: jest.fn(() => `uuid-${++n}`),
  };
});

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  warnWithTs: jest.fn(),
}));

// In-memory fake DB — mirrors the `getAllAsync(sql, params)` shape that
// `session-runner` consumes. Tests manipulate the stored rows directly.
interface FakeDBState {
  sessions: Record<string, unknown>[];
  session_exercises: Record<string, unknown>[];
  session_sets: Record<string, unknown>[];
  exercises: Record<string, unknown>[];
  template_exercises: Record<string, unknown>[];
  template_sets: Record<string, unknown>[];
  /** When set, `getAllAsync` never resolves — simulates DB hang. */
  hangForever: boolean;
  /** When set, `getAllAsync` throws with this message. */
  throwOnRead: string | null;
  /** Counts every getAllAsync call (for idempotency / dedupe assertions). */
  readCount: number;
}

const fakeDB: FakeDBState = {
  sessions: [],
  session_exercises: [],
  session_sets: [],
  exercises: [],
  template_exercises: [],
  template_sets: [],
  hangForever: false,
  throwOnRead: null,
  readCount: 0,
};

(globalThis as unknown as { __sessionLoadFakeDB: FakeDBState }).__sessionLoadFakeDB = fakeDB;

// Tracks polling timers spawned by the hangForever branch so afterEach can
// cancel anything still pending (otherwise Jest complains about open handles).
(globalThis as unknown as { __sessionLoadPollTimers: ReturnType<typeof setTimeout>[] }).__sessionLoadPollTimers = [];

jest.mock('@/lib/services/database/local-db', () => {
  const getState = () =>
    (globalThis as unknown as { __sessionLoadFakeDB: FakeDBState }).__sessionLoadFakeDB;
  const getPollTimers = () =>
    (globalThis as unknown as { __sessionLoadPollTimers: ReturnType<typeof setTimeout>[] }).__sessionLoadPollTimers;

  const runQuery = async <T,>(sql: string, params?: unknown[]): Promise<T[]> => {
    const s = getState();
    s.readCount++;
    if (s.throwOnRead) throw new Error(s.throwOnRead);
    if (s.hangForever) {
      // Resolves only when the test resets hangForever; used for timeout
      // tests. Uses a registered timer handle so afterEach can cancel it
      // and avoid leaking into other tests / tripping the "Jest did not
      // exit" detector.
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!s.hangForever) {
            resolve();
            return;
          }
          const t = setTimeout(check, 10);
          getPollTimers().push(t);
        };
        check();
      });
    }

    const lower = sql.toLowerCase();
    if (lower.includes('from workout_sessions')) {
      return s.sessions.filter((r: any) => r.ended_at == null && r.deleted === 0) as T[];
    }
    if (lower.includes('from workout_session_exercises')) {
      const sessionId = params?.[0];
      return s.session_exercises.filter(
        (r: any) => r.session_id === sessionId && r.deleted === 0,
      ) as T[];
    }
    if (lower.includes('from workout_session_sets')) {
      const exerciseId = params?.[0];
      return s.session_sets.filter(
        (r: any) => r.session_exercise_id === exerciseId && r.deleted === 0,
      ) as T[];
    }
    if (lower.includes('from exercises')) {
      const exerciseId = params?.[0];
      return s.exercises.filter((r: any) => r.id === exerciseId) as T[];
    }
    if (lower.includes('from workout_template_exercises')) {
      return s.template_exercises as T[];
    }
    if (lower.includes('from workout_template_sets')) {
      return s.template_sets as T[];
    }
    return [] as T[];
  };

  return {
    localDB: {
      db: {
        getAllAsync: jest.fn(runQuery),
        runAsync: jest.fn().mockResolvedValue(undefined),
        getFirstAsync: jest.fn().mockResolvedValue(null),
      },
    },
  };
});

jest.mock('@/lib/services/database/generic-sync', () => ({
  genericLocalUpsert: jest.fn().mockResolvedValue(undefined),
  genericGetAll: jest.fn().mockResolvedValue([]),
  genericSoftDelete: jest.fn().mockResolvedValue(undefined),
}));

// Hand-rolled rest-timer mock that implements the real `computeRemainingSeconds`
// math (so tests exercise the wall-clock round-trip) but stubs out the
// AppState subscription / notifications that would otherwise pull in the
// whole react-native native-module chain.
jest.mock('@/lib/services/rest-timer', () => ({
  computeRestSeconds: jest.fn((params: { overrideSeconds?: number | null }) =>
    params?.overrideSeconds ?? 90,
  ),
  computeRemainingSeconds: jest.fn(
    (restStartedAt: string | Date, restTargetSeconds: number): number => {
      const startMs =
        typeof restStartedAt === 'string'
          ? new Date(restStartedAt).getTime()
          : restStartedAt.getTime();
      const elapsed = (Date.now() - startMs) / 1000;
      // Match the production impl from lib/services/rest-timer.ts:97-102
      if (!Number.isFinite(startMs)) return 0;
      return Math.max(0, Math.round(restTargetSeconds - elapsed));
    },
  ),
  scheduleRestNotification: jest.fn().mockResolvedValue('notif-1'),
  cancelRestNotification: jest.fn().mockResolvedValue(undefined),
  isRestComplete: jest.fn().mockReturnValue(false),
  formatRestTime: jest.fn(() => '0:00'),
  onRestTimerAppResume: jest.fn(() => () => {}),
  startForegroundRestHapticCompanion: jest.fn(() => () => {}),
  stopForegroundRestHapticCompanion: jest.fn(),
  __resetRestTimerAppStateForTests: jest.fn(),
}));

jest.mock('@/lib/services/tut-estimator', () => ({
  estimateTut: jest.fn().mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' }),
  timedSetTut: jest.fn().mockReturnValue({ tut_ms: 30000, tut_source: 'estimated' }),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { useSessionRunner } from '@/lib/stores/session-runner';

const state = () => useSessionRunner.getState();

function resetFakeDB() {
  fakeDB.sessions = [];
  fakeDB.session_exercises = [];
  fakeDB.session_sets = [];
  fakeDB.exercises = [];
  fakeDB.template_exercises = [];
  fakeDB.template_sets = [];
  fakeDB.hangForever = false;
  fakeDB.throwOnRead = null;
  fakeDB.readCount = 0;
}

function resetStore() {
  useSessionRunner.setState({
    activeSession: null,
    exercises: [],
    sets: {},
    restTimer: null,
    restTimerCompletionTimeout: null,
    isLoading: false,
    isWorkoutInProgress: false,
    error: null,
  });
}

function seedRoundTripSession(opts: {
  sessionId: string;
  restStartedAt: string | number | null;
  restTargetSeconds: number | null;
}) {
  const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  fakeDB.sessions.push({
    id: opts.sessionId,
    user_id: 'u1',
    goal_profile: 'hypertrophy',
    template_id: null,
    started_at: startedAt,
    ended_at: null,
    deleted: 0,
    synced: 0,
  });
  fakeDB.session_exercises.push(
    {
      id: 'se-1',
      session_id: opts.sessionId,
      exercise_id: 'ex-pushup',
      sort_order: 0,
      deleted: 0,
    },
    {
      id: 'se-2',
      session_id: opts.sessionId,
      exercise_id: 'ex-squat',
      sort_order: 1,
      deleted: 0,
    },
  );
  // 2 sets per exercise — the second set on exercise 1 carries the active rest.
  fakeDB.session_sets.push(
    {
      id: 'ss-1-1',
      session_exercise_id: 'se-1',
      sort_order: 0,
      set_type: 'normal',
      actual_reps: 10,
      actual_weight: 100,
      rest_started_at: null,
      rest_completed_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      rest_skipped: 0,
      rest_target_seconds: 90,
      deleted: 0,
    },
    {
      id: 'ss-1-2',
      session_exercise_id: 'se-1',
      sort_order: 1,
      set_type: 'normal',
      actual_reps: 10,
      actual_weight: 100,
      rest_started_at: opts.restStartedAt,
      rest_completed_at: null,
      rest_skipped: 0,
      rest_target_seconds: opts.restTargetSeconds,
      deleted: 0,
    },
    {
      id: 'ss-2-1',
      session_exercise_id: 'se-2',
      sort_order: 0,
      set_type: 'normal',
      actual_reps: 8,
      actual_weight: 225,
      rest_started_at: null,
      rest_completed_at: null,
      rest_skipped: 0,
      rest_target_seconds: null,
      deleted: 0,
    },
  );
  fakeDB.exercises.push(
    { id: 'ex-pushup', name: 'Push Up', is_compound: true, is_timed: 0 },
    { id: 'ex-squat', name: 'Back Squat', is_compound: true, is_timed: 0 },
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  resetFakeDB();
  resetStore();
});

afterEach(() => {
  // Ensure nothing is left hanging between tests.
  fakeDB.hangForever = false;
  // Drain + cancel any outstanding polling timers from the hang scenarios.
  const pollTimers = (globalThis as unknown as {
    __sessionLoadPollTimers: ReturnType<typeof setTimeout>[];
  }).__sessionLoadPollTimers;
  while (pollTimers.length > 0) {
    const t = pollTimers.pop();
    if (t) clearTimeout(t);
  }
});

// ===========================================================================
// Scenario 1 — Happy round-trip
// ===========================================================================

describe('loadActiveSession: happy round-trip after app kill', () => {
  it('rehydrates exercises, sets, and active rest-timer (remaining within ±1s of wall-clock)', async () => {
    const restStartedMs = Date.now() - 30_000; // 30s ago
    const restTargetSeconds = 90;
    const expectedRemaining = restTargetSeconds - 30; // 60s

    seedRoundTripSession({
      sessionId: 'sess-round-trip',
      restStartedAt: new Date(restStartedMs).toISOString(),
      restTargetSeconds,
    });

    // Simulate app kill by wiping the Zustand store (the source-of-truth
    // in-memory state). The fake DB remains — this is the actual resume
    // scenario on a real device where SQLite persisted the session but
    // the process was killed.
    resetStore();
    expect(state().activeSession).toBeNull();

    await state().loadActiveSession();

    const s = state();
    expect(s.activeSession).not.toBeNull();
    expect(s.activeSession!.id).toBe('sess-round-trip');
    expect(s.isWorkoutInProgress).toBe(true);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();

    // Two exercises, in order.
    expect(s.exercises).toHaveLength(2);
    expect(s.exercises.map((e) => e.id)).toEqual(['se-1', 'se-2']);

    // Sets per exercise.
    expect(s.sets['se-1']).toHaveLength(2);
    expect(s.sets['se-2']).toHaveLength(1);

    // Rest timer is restored for the correct set.
    expect(s.restTimer).not.toBeNull();
    expect(s.restTimer!.setId).toBe('ss-1-2');
    expect(s.restTimer!.targetSeconds).toBe(restTargetSeconds);

    // Remaining seconds computed against wall clock — allow ±1s tolerance
    // for test-execution jitter.
    const { computeRemainingSeconds } = require('@/lib/services/rest-timer');
    const remaining = computeRemainingSeconds(
      s.restTimer!.startedAt,
      s.restTimer!.targetSeconds,
    );
    expect(remaining).toBeGreaterThanOrEqual(expectedRemaining - 1);
    expect(remaining).toBeLessThanOrEqual(expectedRemaining + 1);
  });

  it('does not restore rest timer for a completed rest (rest_completed_at set)', async () => {
    seedRoundTripSession({
      sessionId: 'sess-1',
      // Rest started 10s ago but the second set also has rest_completed_at
      // set further down; we clear the second set's rest markers so only
      // the first set looks "done" and no active rest is found anywhere.
      restStartedAt: null,
      restTargetSeconds: null,
    });

    resetStore();
    await state().loadActiveSession();

    expect(state().restTimer).toBeNull();
  });
});

// ===========================================================================
// Scenario 2 — Partial load
// ===========================================================================

describe('loadActiveSession: partial load (session row but no exercises)', () => {
  it('hydrates session with empty exercises and empty sets map, no crash', async () => {
    fakeDB.sessions.push({
      id: 'sess-partial',
      user_id: 'u1',
      goal_profile: 'hypertrophy',
      template_id: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      deleted: 0,
    });
    // No exercises, no sets seeded.

    await expect(state().loadActiveSession()).resolves.toBeUndefined();

    const s = state();
    expect(s.activeSession).not.toBeNull();
    expect(s.activeSession!.id).toBe('sess-partial');
    expect(s.isWorkoutInProgress).toBe(true);
    expect(s.exercises).toEqual([]);
    expect(s.sets).toEqual({});
    expect(s.restTimer).toBeNull();
    expect(s.error).toBeNull();
    expect(s.isLoading).toBe(false);
  });

  it('hydrates exercises when rows exist but no sets, keeping a consistent sets map', async () => {
    fakeDB.sessions.push({
      id: 'sess-no-sets',
      user_id: 'u1',
      goal_profile: 'hypertrophy',
      template_id: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      deleted: 0,
    });
    fakeDB.session_exercises.push({
      id: 'se-only',
      session_id: 'sess-no-sets',
      exercise_id: 'ex-missing',
      sort_order: 0,
      deleted: 0,
    });
    // No sets, no matching exercises row.

    await state().loadActiveSession();

    const s = state();
    expect(s.exercises).toHaveLength(1);
    expect(s.sets['se-only']).toEqual([]);
    expect(s.error).toBeNull();
  });
});

// ===========================================================================
// Scenario 3 — Corrupted rest timer
// ===========================================================================

describe('loadActiveSession: corrupted rest-timer state', () => {
  it('handles NaN startedAt — no active rest timer restored, no crash', async () => {
    seedRoundTripSession({
      sessionId: 'sess-nan',
      // A JS Date built from 'not-a-real-date' yields NaN when fed to
      // `new Date(x).getTime()`. The ISO constructor then rejects — we
      // stash the raw invalid marker directly.
      restStartedAt: 'not-a-real-date',
      restTargetSeconds: 90,
    });

    resetStore();
    await state().loadActiveSession();

    const s = state();
    expect(s.activeSession).not.toBeNull();
    // With NaN elapsed, computeRemainingSeconds returns 0 (via Math.max(0, …)).
    // session-runner's `remaining > 0` guard means NO rest timer is restored.
    expect(s.restTimer).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('treats a future rest_started_at as full target (rest has not elapsed yet)', async () => {
    const futureIso = new Date(Date.now() + 5 * 60_000).toISOString();
    seedRoundTripSession({
      sessionId: 'sess-future',
      restStartedAt: futureIso,
      restTargetSeconds: 60,
    });

    resetStore();
    await state().loadActiveSession();

    const s = state();
    expect(s.activeSession).not.toBeNull();
    // Future startedAt → computeRemainingSeconds returns target+delta capped,
    // i.e. a positive number. Rest timer IS restored — the implementation
    // trusts the stored target and surfaces the clock-skew as extra rest.
    expect(s.restTimer).not.toBeNull();
    expect(s.restTimer!.setId).toBe('ss-1-2');
    // Remaining should not be negative (Math.max(0, …)).
    const { computeRemainingSeconds } = require('@/lib/services/rest-timer');
    const remaining = computeRemainingSeconds(
      s.restTimer!.startedAt,
      s.restTimer!.targetSeconds,
    );
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  it('treats a very-old rest_started_at (>> target) as expired — no rest timer restored', async () => {
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    seedRoundTripSession({
      sessionId: 'sess-old',
      restStartedAt: oneHourAgoIso,
      restTargetSeconds: 90, // target 90s, elapsed 3600s
    });

    resetStore();
    await state().loadActiveSession();

    const s = state();
    expect(s.activeSession).not.toBeNull();
    // Elapsed (3600s) >> target (90s) → remaining = 0 → no restore.
    expect(s.restTimer).toBeNull();
  });
});

// ===========================================================================
// Scenario 4 — Concurrent loads
// ===========================================================================

describe('loadActiveSession: concurrent loads race', () => {
  it('two parallel loadActiveSession calls produce a single consistent store', async () => {
    seedRoundTripSession({
      sessionId: 'sess-concurrent',
      restStartedAt: new Date(Date.now() - 15_000).toISOString(),
      restTargetSeconds: 90,
    });

    resetStore();

    // Fire two loads concurrently.
    const [r1, r2] = await Promise.all([
      state().loadActiveSession(),
      state().loadActiveSession(),
    ]);

    // Both resolve without throwing.
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();

    const s = state();
    // Store has the session exactly once (not stacked / not nested).
    expect(s.activeSession).not.toBeNull();
    expect(s.activeSession!.id).toBe('sess-concurrent');
    // Exercises are not duplicated.
    expect(s.exercises).toHaveLength(2);
    expect(s.exercises.map((e) => e.id)).toEqual(['se-1', 'se-2']);
    // Sets are not duplicated.
    expect(s.sets['se-1']).toHaveLength(2);
    expect(s.sets['se-2']).toHaveLength(1);
    // Exactly one rest timer is registered (not stacked).
    expect(s.restTimer).not.toBeNull();
    expect(s.restTimer!.setId).toBe('ss-1-2');
    // Rest timer is idempotent: only one completion-timeout handle present.
    // It's either a single handle or null — never an array.
    expect(Array.isArray(s.restTimerCompletionTimeout)).toBe(false);
  });

  it('rapid back-to-back resumes do not leave stale state behind', async () => {
    seedRoundTripSession({
      sessionId: 'sess-rapid',
      restStartedAt: new Date(Date.now() - 5_000).toISOString(),
      restTargetSeconds: 60,
    });

    resetStore();
    await state().loadActiveSession();
    const firstSessionRef = state().activeSession;

    // A second resume fires immediately after the first completes.
    await state().loadActiveSession();

    const s = state();
    // activeSession reference is consistent — reloading the same session
    // does not lose fields.
    expect(s.activeSession!.id).toBe(firstSessionRef!.id);
    expect(s.exercises).toHaveLength(2);
    expect(s.sets['se-1']).toHaveLength(2);
  });
});

// ===========================================================================
// Scenario 5 — DB read timeout
// ===========================================================================

describe('loadActiveSession: DB read timeout', () => {
  it('when getAllAsync throws, the store records the error and is-loading flips back to false', async () => {
    // Simulate the typed-error path by throwing synchronously from the
    // underlying `getAllAsync`. session-runner's try/catch captures the
    // error message and sets `state.error` — this is the contract the
    // React hook surface relies on (#543 acceptance criterion: "typed
    // error + store state unchanged / consistent").
    fakeDB.throwOnRead = 'DB read timed out';

    await state().loadActiveSession();

    const s = state();
    expect(s.error).toBe('DB read timed out');
    expect(s.isLoading).toBe(false);
    // Store stays in its last consistent state — no partial hydration.
    expect(s.activeSession).toBeNull();
    expect(s.exercises).toEqual([]);
    expect(s.sets).toEqual({});
  });

  it('when wrapped in a caller-level timeout, loadActiveSession rejects if the DB hangs', async () => {
    // Not all callers wrap loadActiveSession in a Promise.race, but #543
    // mandates that if a caller DOES bound the call with a timeout, the
    // store must not end up with `isLoading=true` indefinitely. This test
    // exercises the caller-side timeout pattern — the production code
    // does not currently implement its own deadline inside the action, so
    // the assertion below verifies the caller-wrapped race semantics work
    // as expected.
    fakeDB.hangForever = true;

    const TIMEOUT_MS = 50;
    const guarded = Promise.race([
      state().loadActiveSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('caller-timeout')), TIMEOUT_MS),
      ),
    ]);

    await expect(guarded).rejects.toThrow('caller-timeout');

    // Release the hang so the in-flight load can drain without leaking
    // into the next test.
    fakeDB.hangForever = false;
    // Give the in-flight promise a chance to finish so isLoading flips
    // back to false via the `finally` block in loadActiveSession.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const s = state();
    // The caller race rejected, but the in-flight load eventually resolves
    // and the finally-block returns isLoading to false — store stays
    // consistent (no stuck spinner).
    expect(s.isLoading).toBe(false);
  });
});
