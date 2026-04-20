import {
  detectCompletedSets,
  flushCompletedSets,
  type BinderSnapshot,
} from '@/lib/services/session-telemetry-binder';
import type {
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionSet,
  Exercise,
} from '@/lib/types/workout-session';

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'session-1',
    user_id: 'user-1',
    template_id: null,
    name: null,
    goal_profile: 'mixed',
    started_at: '2026-04-17T00:00:00.000Z',
    ended_at: null,
    timezone_offset_minutes: 0,
    bodyweight_lb: null,
    notes: null,
    created_at: '2026-04-17T00:00:00.000Z',
    updated_at: '2026-04-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeExercise(overrides: Partial<WorkoutSessionExercise & { exercise?: Exercise }> = {}) {
  return {
    id: 'sx-1',
    session_id: 'session-1',
    exercise_id: 'squat',
    sort_order: 0,
    notes: null,
    created_at: '2026-04-17T00:00:00.000Z',
    updated_at: '2026-04-17T00:00:00.000Z',
    exercise: {
      id: 'squat',
      name: 'Back Squat',
      category: 'legs',
      muscle_group: null,
      is_compound: true,
      is_timed: false,
      is_system: true,
      created_by: null,
      created_at: '2026-04-17T00:00:00.000Z',
      updated_at: '2026-04-17T00:00:00.000Z',
    } as Exercise,
    ...overrides,
  };
}

function makeSet(overrides: Partial<WorkoutSessionSet> = {}): WorkoutSessionSet {
  return {
    id: 'set-1',
    session_exercise_id: 'sx-1',
    sort_order: 0,
    set_type: 'normal',
    planned_reps: 5,
    planned_seconds: null,
    planned_weight: 225,
    actual_reps: null,
    actual_seconds: null,
    actual_weight: null,
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
    created_at: '2026-04-17T00:00:00.000Z',
    updated_at: '2026-04-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('detectCompletedSets', () => {
  const session = makeSession();
  const exercise = makeExercise();

  it('returns an empty list when there is no active session', () => {
    const next: BinderSnapshot = {
      activeSession: null,
      exercises: [exercise],
      sets: {},
    };
    expect(detectCompletedSets(null, next)).toEqual([]);
  });

  it('returns no payloads when no sets have transitioned', () => {
    const set = makeSet({ completed_at: null });
    const snapshot: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: { 'sx-1': [set] },
    };
    expect(detectCompletedSets(snapshot, snapshot)).toEqual([]);
  });

  it('emits a payload for a set that transitions to completed', () => {
    const pending = makeSet({ actual_reps: null, completed_at: null });
    const completed = makeSet({
      actual_reps: 5,
      actual_weight: 225,
      completed_at: '2026-04-17T00:05:00.000Z',
    });
    const prev: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: { 'sx-1': [pending] },
    };
    const next: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: { 'sx-1': [completed] },
    };

    const payloads = detectCompletedSets(prev, next);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].sessionSetId).toBe('set-1');
    expect(payloads[0].summary).toMatchObject({
      sessionId: 'session-1',
      exercise: 'Back Squat',
      repsCount: 5,
      loadValue: 225,
      loadUnit: 'lbs',
    });
  });

  it('respects a custom default load unit', () => {
    const completed = makeSet({
      actual_reps: 6,
      actual_weight: 100,
      completed_at: '2026-04-17T00:05:00.000Z',
    });
    const next: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: { 'sx-1': [completed] },
    };
    const [payload] = detectCompletedSets(null, next, { defaultLoadUnit: 'kg' });
    expect(payload.summary.loadUnit).toBe('kg');
  });

  it('does not emit load unit when weight is unknown', () => {
    const completed = makeSet({
      actual_reps: 0,
      actual_weight: null,
      completed_at: '2026-04-17T00:05:00.000Z',
    });
    const next: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: { 'sx-1': [completed] },
    };
    const [payload] = detectCompletedSets(null, next);
    expect(payload.summary.loadValue).toBeUndefined();
    expect(payload.summary.loadUnit).toBeUndefined();
  });

  it('falls back to exercise_id when no exercise row is joined', () => {
    const orphanExercise = makeExercise({ exercise: undefined });
    const completed = makeSet({
      actual_reps: 3,
      completed_at: '2026-04-17T00:05:00.000Z',
    });
    const next: BinderSnapshot = {
      activeSession: session,
      exercises: [orphanExercise],
      sets: { 'sx-1': [completed] },
    };
    const [payload] = detectCompletedSets(null, next);
    expect(payload.summary.exercise).toBe('squat');
  });

  it('skips sets that were already completed in the previous snapshot', () => {
    const alreadyCompleted = makeSet({
      actual_reps: 5,
      completed_at: '2026-04-17T00:05:00.000Z',
    });
    const prev: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: { 'sx-1': [alreadyCompleted] },
    };
    const next: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: { 'sx-1': [alreadyCompleted] },
    };
    expect(detectCompletedSets(prev, next)).toEqual([]);
  });

  it('reports multiple completions in one diff', () => {
    const setA = makeSet({ id: 'set-a' });
    const setB = makeSet({ id: 'set-b' });
    const prev: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: { 'sx-1': [setA, setB] },
    };
    const next: BinderSnapshot = {
      activeSession: session,
      exercises: [exercise],
      sets: {
        'sx-1': [
          { ...setA, actual_reps: 5, completed_at: '2026-04-17T00:05:00.000Z' },
          { ...setB, actual_reps: 4, completed_at: '2026-04-17T00:08:00.000Z' },
        ],
      },
    };
    expect(detectCompletedSets(prev, next)).toHaveLength(2);
  });
});

describe('flushCompletedSets', () => {
  it('invokes the logger for each payload and returns generated ids', async () => {
    const logger = jest.fn().mockResolvedValueOnce('id-a').mockResolvedValueOnce('id-b');
    const ids = await flushCompletedSets(
      [
        {
          sessionSetId: 'set-a',
          summary: { sessionId: 's', exercise: 'x', repsCount: 1 },
        },
        {
          sessionSetId: 'set-b',
          summary: { sessionId: 's', exercise: 'x', repsCount: 1 },
        },
      ],
      logger,
    );
    expect(logger).toHaveBeenCalledTimes(2);
    expect(ids).toEqual(['id-a', 'id-b']);
  });

  it('swallows individual failures without blocking the remaining payloads', async () => {
    const logger = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('id-b');
    const ids = await flushCompletedSets(
      [
        { sessionSetId: 'set-a', summary: { sessionId: 's', exercise: 'x', repsCount: 1 } },
        { sessionSetId: 'set-b', summary: { sessionId: 's', exercise: 'x', repsCount: 1 } },
      ],
      logger,
    );
    expect(ids).toEqual(['id-b']);
  });
});
