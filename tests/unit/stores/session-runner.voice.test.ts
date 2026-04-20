/**
 * Tests for lib/stores/session-runner.voice.ts
 *
 * We verify the voice extension module without touching the real
 * session-runner store — callers pass a stubbed slice that matches
 * VoiceSessionRunnerSlice. This keeps the test hermetic and confirms the
 * module's API surface is genuinely decoupled from the main runner.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `voice-uuid-${++mockUuidCounter}`),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/services/database/generic-sync', () => ({
  genericLocalUpsert: jest.fn().mockResolvedValue(undefined),
  genericGetAll: jest.fn().mockResolvedValue([]),
  genericSoftDelete: jest.fn().mockResolvedValue(undefined),
}));

// Minimal mock of the real session-runner so getVoiceRunnerSlice works.
jest.mock('@/lib/stores/session-runner', () => ({
  useSessionRunner: {
    getState: jest.fn(() => ({
      activeSession: null,
      exercises: [],
    })),
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  advanceToNextExercise,
  voicePauseSession,
  voiceResumeSession,
  getVoiceRunnerSlice,
  VOICE_EVENT_TYPES,
  type VoiceSessionRunnerSlice,
} from '@/lib/stores/session-runner.voice';
import { genericLocalUpsert } from '@/lib/services/database/generic-sync';
import { useSessionRunner } from '@/lib/stores/session-runner';

const mockUpsert = genericLocalUpsert as jest.Mock;
const mockGetState = (useSessionRunner as unknown as { getState: jest.Mock }).getState;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSlice(overrides: Partial<VoiceSessionRunnerSlice> = {}): VoiceSessionRunnerSlice {
  return {
    activeSession: { id: 'session-1' },
    exercises: [
      {
        id: 'ex-1',
        session_id: 'session-1',
        exercise_id: 'pullup',
        sort_order: 0,
        notes: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
      {
        id: 'ex-2',
        session_id: 'session-1',
        exercise_id: 'squat',
        sort_order: 1,
        notes: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
      {
        id: 'ex-3',
        session_id: 'session-1',
        exercise_id: 'bench',
        sort_order: 2,
        notes: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    ],
    currentExerciseIndex: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUuidCounter = 0;
  mockUpsert.mockResolvedValue(undefined);
});

// ===========================================================================
// advanceToNextExercise
// ===========================================================================

describe('advanceToNextExercise', () => {
  it('happy path — advances from index 0 to index 1, emits event', async () => {
    const result = await advanceToNextExercise(makeSlice());

    expect(result.success).toBe(true);
    expect(result.nextExerciseId).toBe('ex-2');
    expect(result.eventType).toBe(VOICE_EVENT_TYPES.exerciseAdvanced);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [table, , row] = mockUpsert.mock.calls[0];
    expect(table).toBe('workout_session_events');
    expect(row.type).toBe(VOICE_EVENT_TYPES.exerciseAdvanced);
    expect(row.session_id).toBe('session-1');
    expect(row.session_exercise_id).toBe('ex-2');
  });

  it('advances from middle index 1 to 2', async () => {
    const result = await advanceToNextExercise(makeSlice({ currentExerciseIndex: 1 }));
    expect(result.success).toBe(true);
    expect(result.nextExerciseId).toBe('ex-3');
  });

  it('returns already_last_exercise when on final exercise', async () => {
    const result = await advanceToNextExercise(makeSlice({ currentExerciseIndex: 2 }));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('already_last_exercise');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns no_active_session when session is null', async () => {
    const result = await advanceToNextExercise(makeSlice({ activeSession: null }));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_active_session');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns no_exercises when exercises array is empty', async () => {
    const result = await advanceToNextExercise(makeSlice({ exercises: [] }));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_exercises');
  });

  it('defaults currentExerciseIndex to 0 when undefined', async () => {
    const result = await advanceToNextExercise(makeSlice({ currentExerciseIndex: undefined }));
    expect(result.success).toBe(true);
    expect(result.nextExerciseId).toBe('ex-2');
  });

  it('handles DB failure gracefully — returns event_emit_failed', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('db down'));
    const result = await advanceToNextExercise(makeSlice());
    expect(result.success).toBe(false);
    expect(result.reason).toBe('event_emit_failed');
  });
});

// ===========================================================================
// voicePauseSession
// ===========================================================================

describe('voicePauseSession', () => {
  it('emits session_paused event', async () => {
    const result = await voicePauseSession(makeSlice());
    expect(result.success).toBe(true);
    expect(result.eventType).toBe(VOICE_EVENT_TYPES.sessionPaused);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const row = mockUpsert.mock.calls[0][2];
    expect(row.type).toBe(VOICE_EVENT_TYPES.sessionPaused);
  });

  it('returns no_active_session when session is null', async () => {
    const result = await voicePauseSession(makeSlice({ activeSession: null }));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_active_session');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('handles DB failure gracefully', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('db down'));
    const result = await voicePauseSession(makeSlice());
    expect(result.success).toBe(false);
    expect(result.reason).toBe('event_emit_failed');
  });
});

// ===========================================================================
// voiceResumeSession
// ===========================================================================

describe('voiceResumeSession', () => {
  it('emits session_resumed event', async () => {
    const result = await voiceResumeSession(makeSlice());
    expect(result.success).toBe(true);
    expect(result.eventType).toBe(VOICE_EVENT_TYPES.sessionResumed);
    const row = mockUpsert.mock.calls[0][2];
    expect(row.type).toBe(VOICE_EVENT_TYPES.sessionResumed);
  });

  it('returns no_active_session when session is null', async () => {
    const result = await voiceResumeSession(makeSlice({ activeSession: null }));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_active_session');
  });
});

// ===========================================================================
// getVoiceRunnerSlice
// ===========================================================================

describe('getVoiceRunnerSlice', () => {
  it('returns null session and empty exercises when store is empty', () => {
    const slice = getVoiceRunnerSlice();
    expect(slice.activeSession).toBeNull();
    expect(slice.exercises).toEqual([]);
    expect(slice.currentExerciseIndex).toBeUndefined();
  });

  it('reads activeSession and exercises from the real store', () => {
    mockGetState.mockReturnValueOnce({
      activeSession: { id: 'session-42' },
      exercises: [
        {
          id: 'ex-a',
          session_id: 'session-42',
          exercise_id: 'deadlift',
          sort_order: 0,
          notes: null,
          created_at: '',
          updated_at: '',
        },
      ],
    });

    const slice = getVoiceRunnerSlice();
    expect(slice.activeSession).toEqual({ id: 'session-42' });
    expect(slice.exercises).toHaveLength(1);
    expect(slice.exercises[0].id).toBe('ex-a');
  });
});
