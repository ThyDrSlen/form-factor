/**
 * Unit tests for pause/resume semantics on the Session Runner Zustand store.
 *
 * Kept in a dedicated spec so we can iterate on Wave 15A without perturbing
 * the lifecycle coverage in session-runner.test.ts.
 */

// ---------------------------------------------------------------------------
// Mocks — hoisted, so factory functions must not reference outer `const`s.
// ---------------------------------------------------------------------------

let mockUuidCounter = 0;

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `uuid-${++mockUuidCounter}`),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  warnWithTs: jest.fn(),
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    db: {
      runAsync: jest.fn().mockResolvedValue(undefined),
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock('@/lib/services/database/generic-sync', () => ({
  genericLocalUpsert: jest.fn().mockResolvedValue(undefined),
  genericGetAll: jest.fn().mockResolvedValue([]),
  genericSoftDelete: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/services/rest-timer', () => ({
  computeRestSeconds: jest.fn().mockReturnValue(90),
  scheduleRestNotification: jest.fn().mockResolvedValue('notif-1'),
  cancelRestNotification: jest.fn().mockResolvedValue(undefined),
  computeRemainingSeconds: jest.fn().mockReturnValue(90),
}));

jest.mock('@/lib/services/tut-estimator', () => ({
  estimateTut: jest.fn().mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' }),
  timedSetTut: jest.fn().mockReturnValue({ tut_ms: 30000, tut_source: 'estimated' }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { useSessionRunner } from '@/lib/stores/session-runner';
import { localDB } from '@/lib/services/database/local-db';
import {
  genericLocalUpsert,
  genericSoftDelete,
} from '@/lib/services/database/generic-sync';
import {
  computeRestSeconds,
  scheduleRestNotification,
  cancelRestNotification,
  computeRemainingSeconds,
} from '@/lib/services/rest-timer';
import {
  estimateTut,
  timedSetTut,
} from '@/lib/services/tut-estimator';

const mockGenericLocalUpsert = genericLocalUpsert as jest.Mock;
const mockGenericSoftDelete = genericSoftDelete as jest.Mock;
const mockScheduleRestNotification = scheduleRestNotification as jest.Mock;
const mockCancelRestNotification = cancelRestNotification as jest.Mock;
const mockComputeRemainingSeconds = computeRemainingSeconds as jest.Mock;
const mockComputeRestSeconds = computeRestSeconds as jest.Mock;
const mockEstimateTut = estimateTut as jest.Mock;
const mockTimedSetTut = timedSetTut as jest.Mock;
const mockDb = localDB.db as unknown as {
  runAsync: jest.Mock;
  getAllAsync: jest.Mock;
  getFirstAsync: jest.Mock;
};

const state = () => useSessionRunner.getState();

function resetStore() {
  useSessionRunner.setState({
    activeSession: null,
    exercises: [],
    sets: {},
    restTimer: null,
    restTimerCompletionTimeout: null,
    isPaused: false,
    pausedAt: null,
    totalPausedMs: 0,
    pausedRestTimer: null,
    isLoading: false,
    isWorkoutInProgress: false,
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-04-16T12:00:00.000Z') });
  mockUuidCounter = 0;
  resetStore();

  // Restore default returns after clearAllMocks
  mockGenericLocalUpsert.mockResolvedValue(undefined);
  mockGenericSoftDelete.mockResolvedValue(undefined);
  mockScheduleRestNotification.mockResolvedValue('notif-1');
  mockCancelRestNotification.mockResolvedValue(undefined);
  mockComputeRestSeconds.mockReturnValue(90);
  mockComputeRemainingSeconds.mockReturnValue(90);
  mockEstimateTut.mockReturnValue({ tut_ms: 8000, tut_source: 'estimated' });
  mockTimedSetTut.mockReturnValue({ tut_ms: 30000, tut_source: 'estimated' });
  mockDb.runAsync.mockResolvedValue(undefined);
  mockDb.getAllAsync.mockResolvedValue([]);
  mockDb.getFirstAsync.mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

// ===========================================================================
// Initial state defaults
// ===========================================================================

describe('pause initial state', () => {
  it('starts with isPaused=false, pausedAt=null, totalPausedMs=0', () => {
    expect(state().isPaused).toBe(false);
    expect(state().pausedAt).toBeNull();
    expect(state().totalPausedMs).toBe(0);
    expect(state().pausedRestTimer).toBeNull();
  });

  it('startSession initializes pause state to defaults', async () => {
    // Dirty the pause state to make sure startSession resets it.
    useSessionRunner.setState({
      isPaused: true,
      pausedAt: 123,
      totalPausedMs: 999,
    });

    await state().startSession();

    expect(state().isPaused).toBe(false);
    expect(state().pausedAt).toBeNull();
    expect(state().totalPausedMs).toBe(0);
    expect(state().pausedRestTimer).toBeNull();
  });
});

// ===========================================================================
// pauseSession
// ===========================================================================

describe('pauseSession', () => {
  it('is a no-op when there is no active session', () => {
    expect(state().activeSession).toBeNull();

    state().pauseSession();

    expect(state().isPaused).toBe(false);
    expect(state().pausedAt).toBeNull();
  });

  it('flips isPaused and stamps pausedAt when active session exists', async () => {
    await state().startSession();

    const t0 = Date.now();
    state().pauseSession();

    expect(state().isPaused).toBe(true);
    expect(state().pausedAt).toBe(t0);
  });

  it('accepts a reason argument without changing state shape', async () => {
    await state().startSession();

    state().pauseSession('system');

    expect(state().isPaused).toBe(true);
  });

  it('is a no-op when already paused (does not reset pausedAt)', async () => {
    await state().startSession();

    state().pauseSession();
    const firstPausedAt = state().pausedAt;

    // Advance clock — a second pause must not stomp the original timestamp.
    jest.advanceTimersByTime(5_000);
    state().pauseSession();

    expect(state().pausedAt).toBe(firstPausedAt);
    expect(state().isPaused).toBe(true);
  });

  it('suspends the live rest timer and remembers remaining seconds', async () => {
    await state().startSession();

    // Seed an active rest timer directly so we don't depend on completeSet.
    useSessionRunner.setState({
      restTimer: {
        targetSeconds: 90,
        startedAt: new Date().toISOString(),
        setId: 'set-1',
      },
    });
    mockComputeRemainingSeconds.mockReturnValueOnce(42);

    state().pauseSession();

    expect(state().restTimer).toBeNull();
    expect(state().pausedRestTimer).toEqual({
      targetSeconds: 90,
      remainingSeconds: 42,
      setId: 'set-1',
    });
    expect(mockCancelRestNotification).toHaveBeenCalled();
  });

  it('does not set pausedRestTimer when no rest timer is running', async () => {
    await state().startSession();

    state().pauseSession();

    expect(state().pausedRestTimer).toBeNull();
  });
});

// ===========================================================================
// resumeSession
// ===========================================================================

describe('resumeSession', () => {
  it('is a no-op when not paused', async () => {
    await state().startSession();

    state().resumeSession();

    expect(state().isPaused).toBe(false);
    expect(state().totalPausedMs).toBe(0);
  });

  it('is a no-op when no active session', () => {
    state().resumeSession();

    expect(state().isPaused).toBe(false);
    expect(state().totalPausedMs).toBe(0);
  });

  it('clears pausedAt and accumulates pause duration into totalPausedMs', async () => {
    await state().startSession();

    state().pauseSession();
    jest.advanceTimersByTime(7_000);
    state().resumeSession();

    expect(state().isPaused).toBe(false);
    expect(state().pausedAt).toBeNull();
    expect(state().totalPausedMs).toBe(7_000);
  });

  it('accumulates across multiple pause/resume cycles', async () => {
    await state().startSession();

    state().pauseSession();
    jest.advanceTimersByTime(3_000);
    state().resumeSession();

    jest.advanceTimersByTime(10_000);

    state().pauseSession();
    jest.advanceTimersByTime(2_500);
    state().resumeSession();

    jest.advanceTimersByTime(1_000);

    state().pauseSession();
    jest.advanceTimersByTime(4_500);
    state().resumeSession();

    expect(state().totalPausedMs).toBe(3_000 + 2_500 + 4_500);
    expect(state().isPaused).toBe(false);
  });

  it('restores the rest timer from remembered remaining seconds', async () => {
    await state().startSession();

    useSessionRunner.setState({
      restTimer: {
        targetSeconds: 90,
        startedAt: new Date().toISOString(),
        setId: 'set-1',
      },
    });
    mockComputeRemainingSeconds.mockReturnValueOnce(42);

    state().pauseSession();
    jest.advanceTimersByTime(5_000);
    state().resumeSession();

    const resumed = state().restTimer;
    expect(resumed).not.toBeNull();
    expect(resumed!.setId).toBe('set-1');
    // Target seconds is the remaining-seconds snapshot, so the visible
    // countdown picks up where the user left it instead of restarting.
    expect(resumed!.targetSeconds).toBe(42);
    expect(state().pausedRestTimer).toBeNull();
  });

  it('does not restore a rest timer whose remaining time is zero', async () => {
    await state().startSession();

    useSessionRunner.setState({
      restTimer: {
        targetSeconds: 90,
        startedAt: new Date().toISOString(),
        setId: 'set-done',
      },
    });
    mockComputeRemainingSeconds.mockReturnValueOnce(0);

    state().pauseSession();
    state().resumeSession();

    expect(state().restTimer).toBeNull();
    expect(state().pausedRestTimer).toBeNull();
  });

  it('reschedules the rest notification when restoring the timer', async () => {
    await state().startSession();

    useSessionRunner.setState({
      restTimer: {
        targetSeconds: 90,
        startedAt: new Date().toISOString(),
        setId: 'set-1',
      },
    });
    mockComputeRemainingSeconds.mockReturnValueOnce(42);

    state().pauseSession();
    mockScheduleRestNotification.mockClear();

    state().resumeSession();

    expect(mockScheduleRestNotification).toHaveBeenCalledWith(42);
  });
});

// ===========================================================================
// finishSession interaction
// ===========================================================================

describe('finishSession + pause interaction', () => {
  it('flushes the in-flight pause segment into the completion event when finished while paused', async () => {
    await state().startSession();

    state().pauseSession();
    jest.advanceTimersByTime(12_500);

    mockGenericLocalUpsert.mockClear();
    await state().finishSession();

    const completionEvent = mockGenericLocalUpsert.mock.calls.find(
      (c: unknown[]) =>
        c[0] === 'workout_session_events' &&
        (c[2] as { type: string }).type === 'session_completed',
    );
    expect(completionEvent).toBeDefined();
    // Payload is stored as a JSON string — parse before asserting.
    const payload = JSON.parse((completionEvent![2] as { payload: string }).payload);
    expect(payload.paused_ms).toBe(12_500);
  });

  it('writes accumulated paused_ms into the session_completed event after resume', async () => {
    await state().startSession();

    state().pauseSession();
    jest.advanceTimersByTime(3_000);
    state().resumeSession();

    jest.advanceTimersByTime(1_000);

    state().pauseSession();
    jest.advanceTimersByTime(2_000);
    state().resumeSession();

    mockGenericLocalUpsert.mockClear();
    await state().finishSession();

    const completionEvent = mockGenericLocalUpsert.mock.calls.find(
      (c: unknown[]) =>
        c[0] === 'workout_session_events' &&
        (c[2] as { type: string }).type === 'session_completed',
    );
    const payload = JSON.parse((completionEvent![2] as { payload: string }).payload);
    expect(payload.paused_ms).toBe(5_000);
  });

  it('resets pause state after finishSession completes', async () => {
    await state().startSession();

    state().pauseSession();
    await state().finishSession();

    expect(state().isPaused).toBe(false);
    expect(state().pausedAt).toBeNull();
    expect(state().totalPausedMs).toBe(0);
    expect(state().pausedRestTimer).toBeNull();
  });
});

// Suppress "unused import" warning for soft-delete mock (shared boilerplate).
void mockGenericSoftDelete;
