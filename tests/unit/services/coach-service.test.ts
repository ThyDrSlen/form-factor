const mockInvoke = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({
  insert: mockInsert,
}));
const mockGetAllWorkouts = jest.fn();
const mockLogError = jest.fn();
const mockCreateError = jest.fn(
  (
    domain: string,
    code: string,
    message: string,
    opts?: { details?: unknown; retryable?: boolean; severity?: string }
  ) => ({
    domain,
    code,
    message,
    retryable: opts?.retryable ?? false,
    severity: opts?.severity ?? 'error',
    details: opts?.details,
  })
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
    from: mockFrom,
  },
}));

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    getAllWorkouts: mockGetAllWorkouts,
  },
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: mockLogError,
}));

jest.mock('../../../lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: mockLogError,
}));

let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];

describe('coach-service', () => {
  const baseMessages = [{ role: 'user' as const, content: 'How should I squat?' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({ data: { message: 'Keep your chest up.' }, error: null });
    mockInsert.mockResolvedValue({ error: null });
    mockGetAllWorkouts.mockResolvedValue([]);
  });

  it('classifies a 404 invoke failure as COACH_NOT_DEPLOYED', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: '404 Not Found', status: 404 } });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_NOT_DEPLOYED',
      retryable: false,
    });
  });

  it('classifies missing API key failures as COACH_NOT_CONFIGURED', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'OPENAI_API_KEY is missing' } });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('maps response error payloads to COACH_ERROR', async () => {
    mockInvoke.mockResolvedValue({ data: { error: 'Inference failed' }, error: null });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'network',
      code: 'COACH_ERROR',
      message: 'Inference failed',
      retryable: true,
    });
  });

  it('rejects empty coach responses as COACH_EMPTY_RESPONSE', async () => {
    mockInvoke.mockResolvedValue({ data: { message: '   ' }, error: null });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      domain: 'validation',
      code: 'COACH_EMPTY_RESPONSE',
    });
  });

  it('persists conversations when profile and session context are present', async () => {
    const messages = [
      { role: 'system' as const, content: 'You are a coach.' },
      { role: 'user' as const, content: 'How should I brace?' },
      { role: 'assistant' as const, content: 'Breathe into your belly.' },
      { role: 'user' as const, content: 'What about my knees?' },
    ];

    const result = await sendCoachPrompt(messages, {
      profile: { id: 'user-123', name: 'Pat' },
      focus: 'squat',
      sessionId: 'session-9',
    });
    await Promise.resolve();

    expect(result).toEqual({ role: 'assistant', content: 'Keep your chest up.' });
    expect(mockFrom).toHaveBeenCalledWith('coach_conversations');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        session_id: 'session-9',
        turn_index: 1,
        user_message: 'What about my knees?',
        assistant_message: 'Keep your chest up.',
        input_messages: messages,
        context: { focus: 'squat' },
        metadata: expect.objectContaining({
          model: 'gpt-5.4-mini',
          timestamp: expect.any(String),
        }),
      })
    );
  });

  it('includes up to five recent workouts and best-performance context when local history exists', async () => {
    mockGetAllWorkouts.mockResolvedValue([
      {
        id: 'w-1',
        exercise: 'Back Squat',
        sets: 5,
        reps: 5,
        weight: 225,
        duration: null,
        date: '2026-04-29T10:00:00.000Z',
        synced: 1,
        deleted: 0,
        updated_at: '2026-04-29T10:05:00.000Z',
      },
      {
        id: 'w-2',
        exercise: 'Bench Press',
        sets: 4,
        reps: 8,
        weight: 155,
        duration: null,
        date: '2026-04-27T10:00:00.000Z',
        synced: 1,
        deleted: 0,
        updated_at: '2026-04-27T10:05:00.000Z',
      },
      {
        id: 'w-3',
        exercise: 'Pull Up',
        sets: 4,
        reps: 12,
        weight: 0,
        duration: null,
        date: '2026-04-25T10:00:00.000Z',
        synced: 1,
        deleted: 0,
        updated_at: '2026-04-25T10:05:00.000Z',
      },
      {
        id: 'w-4',
        exercise: 'Romanian Deadlift',
        sets: 3,
        reps: 8,
        weight: 245,
        duration: null,
        date: '2026-04-23T10:00:00.000Z',
        synced: 1,
        deleted: 0,
        updated_at: '2026-04-23T10:05:00.000Z',
      },
      {
        id: 'w-5',
        exercise: 'Bike Intervals',
        sets: 6,
        reps: null,
        weight: null,
        duration: 18,
        date: '2026-04-21T10:00:00.000Z',
        synced: 1,
        deleted: 0,
        updated_at: '2026-04-21T10:05:00.000Z',
      },
      {
        id: 'w-6',
        exercise: 'Old Session',
        sets: 2,
        reps: 20,
        weight: null,
        duration: null,
        date: '2026-04-18T10:00:00.000Z',
        synced: 1,
        deleted: 0,
        updated_at: '2026-04-18T10:05:00.000Z',
      },
    ]);

    await sendCoachPrompt(baseMessages, {
      profile: { id: 'user-123', name: 'Pat' },
      focus: 'strength_training',
      sessionId: 'session-9',
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'coach',
      expect.objectContaining({
        body: expect.objectContaining({
          messages: baseMessages,
          context: expect.objectContaining({
            focus: 'strength_training',
            workoutSummary:
              'Recent workouts: 2026-04-29: Back Squat (5x5, weight 225); 2026-04-27: Bench Press (4x8, weight 155); 2026-04-25: Pull Up (4x12); 2026-04-23: Romanian Deadlift (3x8, weight 245); 2026-04-21: Bike Intervals (6 sets, 18 min). Best performance: Romanian Deadlift 245 x 8; Old Session 20 reps',
          }),
        }),
      })
    );
  });

  it('logs and skips workout context when local workout history fails', async () => {
    mockGetAllWorkouts.mockRejectedValue(new Error('db offline'));

    await expect(sendCoachPrompt(baseMessages, { focus: 'recovery' })).resolves.toEqual({
      role: 'assistant',
      content: 'Keep your chest up.',
    });

    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'storage',
        code: 'COACH_WORKOUT_CONTEXT_FAILED',
      }),
      expect.objectContaining({
        feature: 'workouts',
        location: 'sendCoachPrompt.buildCoachContext',
      })
    );
    expect(mockInvoke).toHaveBeenCalledWith(
      'coach',
      expect.objectContaining({
        body: expect.objectContaining({
          context: { focus: 'recovery' },
        }),
      })
    );
  });

  it('logs persistence failures without failing the coach response', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'insert failed' } });

    await expect(
      sendCoachPrompt(baseMessages, {
        profile: { id: 'user-123' },
        focus: 'squat',
        sessionId: 'session-9',
      })
    ).resolves.toEqual({
      role: 'assistant',
      content: 'Keep your chest up.',
    });
    await Promise.resolve();

    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'storage',
        code: 'COACH_CONVERSATION_PERSIST_FAILED',
      }),
      expect.objectContaining({
        feature: 'app',
        location: 'sendCoachPrompt.persistCoachConversation',
        meta: expect.objectContaining({
          sessionId: 'session-9',
          userId: 'user-123',
        }),
      })
    );
  });
});

export {};
