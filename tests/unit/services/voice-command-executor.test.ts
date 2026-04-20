/**
 * Tests for lib/services/voice-command-executor.ts
 */

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

const mockAdvance = jest.fn();
const mockVoicePause = jest.fn();
const mockVoiceResume = jest.fn();

jest.mock('@/lib/stores/session-runner.voice', () => ({
  advanceToNextExercise: (...args: unknown[]) => mockAdvance(...args),
  voicePauseSession: (...args: unknown[]) => mockVoicePause(...args),
  voiceResumeSession: (...args: unknown[]) => mockVoiceResume(...args),
  VOICE_EVENT_TYPES: {
    exerciseAdvanced: 'voice.exercise_advanced',
    sessionPaused: 'voice.session_paused',
    sessionResumed: 'voice.session_resumed',
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  executeIntent,
  buildExecutableRunner,
  type ExecutableRunner,
} from '@/lib/services/voice-command-executor';
import type { ClassifiedIntent } from '@/lib/services/voice-intent-classifier';
import type { WorkoutSessionSet } from '@/lib/types/workout-session';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSet(overrides: Partial<WorkoutSessionSet> = {}): WorkoutSessionSet {
  return {
    id: 'set-1',
    session_exercise_id: 'ex-1',
    sort_order: 0,
    set_type: 'normal',
    planned_reps: null,
    planned_seconds: null,
    planned_weight: 20,
    actual_reps: null,
    actual_seconds: null,
    actual_weight: 20,
    started_at: null,
    completed_at: null,
    rest_target_seconds: null,
    rest_started_at: null,
    rest_completed_at: null,
    rest_skipped: false,
    tut_ms: null,
    tut_source: 'unknown',
    perceived_rpe: null,
    notes: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeRunner(overrides: Partial<ExecutableRunner> = {}): ExecutableRunner {
  return {
    skipRest: jest.fn().mockResolvedValue(undefined),
    updateSet: jest.fn().mockResolvedValue(undefined),
    voiceSlice: {
      activeSession: { id: 'session-1' },
      exercises: [],
      currentExerciseIndex: 0,
    },
    getCurrentSet: () => makeSet(),
    weightPreference: 'metric',
    ...overrides,
  };
}

function makeIntent(
  overrides: Partial<ClassifiedIntent> = {},
): ClassifiedIntent {
  return {
    intent: 'none',
    params: {},
    confidence: 0.9,
    normalized: '',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdvance.mockResolvedValue({ success: true, eventType: 'voice.exercise_advanced', nextExerciseId: 'ex-2' });
  mockVoicePause.mockResolvedValue({ success: true, eventType: 'voice.session_paused' });
  mockVoiceResume.mockResolvedValue({ success: true, eventType: 'voice.session_resumed' });
});

// ===========================================================================
// Guards
// ===========================================================================

describe('guards', () => {
  it('intent=none returns low_confidence noop', async () => {
    const r = await executeIntent(makeIntent({ intent: 'none' }), makeRunner());
    expect(r.success).toBe(false);
    expect(r.actionTaken).toBe('noop');
    expect(r.reason).toBe('low_confidence');
  });

  it('no active session returns noop with reason', async () => {
    const runner = makeRunner({
      voiceSlice: { activeSession: null, exercises: [] },
    });
    const r = await executeIntent(makeIntent({ intent: 'next' }), runner);
    expect(r.success).toBe(false);
    expect(r.actionTaken).toBe('noop');
    expect(r.reason).toBe('no_active_session');
  });
});

// ===========================================================================
// next
// ===========================================================================

describe('next', () => {
  it('routes to advanceToNextExercise and returns success', async () => {
    const runner = makeRunner();
    const r = await executeIntent(makeIntent({ intent: 'next' }), runner);
    expect(mockAdvance).toHaveBeenCalledTimes(1);
    expect(mockAdvance).toHaveBeenCalledWith(runner.voiceSlice);
    expect(r.success).toBe(true);
    expect(r.actionTaken).toBe('advance_exercise');
  });

  it('surfaces already_last_exercise with friendly copy', async () => {
    mockAdvance.mockResolvedValueOnce({ success: false, reason: 'already_last_exercise' });
    const r = await executeIntent(makeIntent({ intent: 'next' }), makeRunner());
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/last exercise/i);
  });
});

// ===========================================================================
// pause / resume
// ===========================================================================

describe('pause', () => {
  it('routes to voicePauseSession', async () => {
    const r = await executeIntent(makeIntent({ intent: 'pause' }), makeRunner());
    expect(mockVoicePause).toHaveBeenCalledTimes(1);
    expect(r.success).toBe(true);
    expect(r.actionTaken).toBe('pause_session');
  });

  it('returns noop when voicePauseSession fails', async () => {
    mockVoicePause.mockResolvedValueOnce({ success: false, reason: 'event_emit_failed' });
    const r = await executeIntent(makeIntent({ intent: 'pause' }), makeRunner());
    expect(r.success).toBe(false);
  });
});

describe('resume', () => {
  it('routes to voiceResumeSession', async () => {
    const r = await executeIntent(makeIntent({ intent: 'resume' }), makeRunner());
    expect(mockVoiceResume).toHaveBeenCalledTimes(1);
    expect(r.success).toBe(true);
    expect(r.actionTaken).toBe('resume_session');
  });
});

// ===========================================================================
// skip_rest
// ===========================================================================

describe('skip_rest', () => {
  it('invokes runner.skipRest', async () => {
    const runner = makeRunner();
    const r = await executeIntent(makeIntent({ intent: 'skip_rest' }), runner);
    expect(runner.skipRest).toHaveBeenCalledTimes(1);
    expect(r.actionTaken).toBe('skip_rest');
    expect(r.success).toBe(true);
  });

  it('catches exception thrown by skipRest', async () => {
    const runner = makeRunner({
      skipRest: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const r = await executeIntent(makeIntent({ intent: 'skip_rest' }), runner);
    expect(r.success).toBe(false);
    expect(r.reason).toBe('exception');
  });
});

// ===========================================================================
// add_weight
// ===========================================================================

describe('add_weight', () => {
  it('adds kg delta to current set', async () => {
    const runner = makeRunner({
      getCurrentSet: () => makeSet({ actual_weight: 20 }),
    });
    const r = await executeIntent(
      makeIntent({ intent: 'add_weight', params: { weight: 5, weightUnit: 'kg' } }),
      runner,
    );
    expect(runner.updateSet).toHaveBeenCalledWith('set-1', { actual_weight: 25 });
    expect(r.actionTaken).toBe('add_weight');
    expect(r.success).toBe(true);
  });

  it('converts lb → kg before adding', async () => {
    const runner = makeRunner({
      getCurrentSet: () => makeSet({ actual_weight: 0 }),
    });
    // 10 lb ≈ 4.5 kg (rounded to 0.1)
    await executeIntent(
      makeIntent({ intent: 'add_weight', params: { weight: 10, weightUnit: 'lb' } }),
      runner,
    );
    expect(runner.updateSet).toHaveBeenCalledWith('set-1', { actual_weight: 4.5 });
  });

  it('uses metric preference when user omits unit', async () => {
    const runner = makeRunner({
      weightPreference: 'metric',
      getCurrentSet: () => makeSet({ actual_weight: 10 }),
    });
    await executeIntent(
      makeIntent({ intent: 'add_weight', params: { weight: 2 } }),
      runner,
    );
    expect(runner.updateSet).toHaveBeenCalledWith('set-1', { actual_weight: 12 });
  });

  it('uses imperial preference (lb→kg) when user omits unit', async () => {
    const runner = makeRunner({
      weightPreference: 'imperial',
      getCurrentSet: () => makeSet({ actual_weight: 0 }),
    });
    await executeIntent(
      makeIntent({ intent: 'add_weight', params: { weight: 10 } }),
      runner,
    );
    expect(runner.updateSet).toHaveBeenCalledWith('set-1', { actual_weight: 4.5 });
  });

  it('returns noop when no current set', async () => {
    const runner = makeRunner({ getCurrentSet: () => null });
    const r = await executeIntent(
      makeIntent({ intent: 'add_weight', params: { weight: 5 } }),
      runner,
    );
    expect(r.success).toBe(false);
    expect(r.reason).toBe('no_current_set');
  });
});

// ===========================================================================
// log_rpe
// ===========================================================================

describe('log_rpe', () => {
  it('writes perceived_rpe to current set', async () => {
    const runner = makeRunner();
    const r = await executeIntent(
      makeIntent({ intent: 'log_rpe', params: { rpe: 8 } }),
      runner,
    );
    expect(runner.updateSet).toHaveBeenCalledWith('set-1', { perceived_rpe: 8 });
    expect(r.actionTaken).toBe('log_rpe');
  });

  it('returns noop when no current set', async () => {
    const runner = makeRunner({ getCurrentSet: () => null });
    const r = await executeIntent(
      makeIntent({ intent: 'log_rpe', params: { rpe: 7 } }),
      runner,
    );
    expect(r.success).toBe(false);
    expect(r.reason).toBe('no_current_set');
  });

  it('returns noop when rpe param is missing', async () => {
    const runner = makeRunner();
    const r = await executeIntent(
      makeIntent({ intent: 'log_rpe', params: {} }),
      runner,
    );
    expect(r.success).toBe(false);
    expect(r.reason).toBe('invalid_rpe');
  });
});

// ===========================================================================
// restart (deferred)
// ===========================================================================

describe('restart (deferred to #442)', () => {
  it('returns unsupported', async () => {
    const r = await executeIntent(makeIntent({ intent: 'restart' }), makeRunner());
    expect(r.success).toBe(false);
    expect(r.actionTaken).toBe('noop');
    expect(r.reason).toBe('unsupported');
    expect(r.message).toMatch(/not supported/i);
  });
});

// ===========================================================================
// buildExecutableRunner
// ===========================================================================

describe('buildExecutableRunner', () => {
  it('maps SessionRunnerState to ExecutableRunner shape', () => {
    const sessionState = {
      activeSession: { id: 'session-xyz' } as { id: string },
      exercises: [
        {
          id: 'ex-1',
          session_id: 'session-xyz',
          exercise_id: 'pullup',
          sort_order: 0,
          notes: null,
          created_at: '',
          updated_at: '',
        },
      ],
      sets: {
        'ex-1': [makeSet({ id: 'set-a' }), makeSet({ id: 'set-b' })],
      },
      skipRest: jest.fn(),
      updateSet: jest.fn(),
    } as unknown as Parameters<typeof buildExecutableRunner>[0];

    const runner = buildExecutableRunner(sessionState, 'imperial');
    expect(runner.weightPreference).toBe('imperial');
    expect(runner.voiceSlice.activeSession).toEqual({ id: 'session-xyz' });
    expect(runner.voiceSlice.exercises).toHaveLength(1);
    const currentSet = runner.getCurrentSet();
    expect(currentSet?.id).toBe('set-b');
  });

  it('getCurrentSet returns null when no exercises', () => {
    const sessionState = {
      activeSession: { id: 'session-xyz' } as { id: string },
      exercises: [],
      sets: {},
      skipRest: jest.fn(),
      updateSet: jest.fn(),
    } as unknown as Parameters<typeof buildExecutableRunner>[0];

    const runner = buildExecutableRunner(sessionState, 'metric');
    expect(runner.getCurrentSet()).toBeNull();
  });
});
