/**
 * Tests for the session-runner pause extension module.
 */

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `uuid-${++mockUuidCounter}`),
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    db: {
      getAllAsync: jest.fn().mockResolvedValue([]),
      runAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest.fn().mockResolvedValue(null),
    },
  },
}));

const mockLocalUpsert = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/database/generic-sync', () => ({
  genericLocalUpsert: (...args: unknown[]) => mockLocalUpsert(...args),
  genericSoftDelete: jest.fn().mockResolvedValue(undefined),
  genericGetAll: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  warnWithTs: jest.fn(),
}));

const mockSessionGetState: { current: { activeSession: { id: string } | null } } = {
  current: { activeSession: { id: 'sess-1' } },
};
jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: {
    getState: () => mockSessionGetState.current,
  },
}));

import {
  pauseActiveSession,
  resumeActiveSession,
  toggleActiveSessionPause,
  __resetSessionPauseState,
} from '@/lib/stores/session-runner.pause';

beforeEach(() => {
  jest.clearAllMocks();
  __resetSessionPauseState();
  mockUuidCounter = 0;
  mockSessionGetState.current = { activeSession: { id: 'sess-1' } };
  mockLocalUpsert.mockResolvedValue(undefined);
});

describe('session-runner.pause', () => {
  it('pauseActiveSession is a no-op when no session is active', async () => {
    mockSessionGetState.current = { activeSession: null };
    await pauseActiveSession('manual');
    expect(mockLocalUpsert).not.toHaveBeenCalled();
  });

  it('records a pause event when pausing', async () => {
    await pauseActiveSession('background');
    expect(mockLocalUpsert).toHaveBeenCalledWith(
      'workout_session_events',
      'id',
      expect.objectContaining({
        session_id: 'sess-1',
        type: 'rest_started',
      }),
      0,
    );
    const payload = JSON.parse(
      (mockLocalUpsert.mock.calls[0][2] as { payload: string }).payload,
    );
    expect(payload.subtype).toBe('session_paused');
    expect(payload.reason).toBe('background');
  });

  it('resumeActiveSession returns the paused duration and logs a resume event', async () => {
    await pauseActiveSession('background');
    const dur = await resumeActiveSession();
    expect(dur).toBeGreaterThanOrEqual(0);
    // second call (the resume) logs a completion event
    expect(mockLocalUpsert).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(
      (mockLocalUpsert.mock.calls[1][2] as { payload: string }).payload,
    );
    expect(payload.subtype).toBe('session_resumed');
    expect(payload.paused_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('toggleActiveSessionPause pauses when running and resumes when paused', async () => {
    const first = await toggleActiveSessionPause('manual');
    expect(first).toBe(true); // paused
    const second = await toggleActiveSessionPause();
    expect(second).toBe(false); // resumed
  });

  it('duplicate pauses are ignored', async () => {
    await pauseActiveSession('background');
    await pauseActiveSession('background');
    expect(mockLocalUpsert).toHaveBeenCalledTimes(1);
  });

  it('resume when never paused returns 0 without writing events', async () => {
    const result = await resumeActiveSession();
    expect(result).toBe(0);
    expect(mockLocalUpsert).not.toHaveBeenCalled();
  });
});
