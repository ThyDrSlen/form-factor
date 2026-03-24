import { supabase } from '@/lib/supabase';
import {
  fetchCoachSessions,
  fetchCoachSessionMessages,
  fetchTodaySession,
} from '@/lib/services/coach-history-service';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const mockFrom = supabase.from as jest.Mock;

function createMockQuery(data: any, error: any = null) {
  const resolved = { data, error };
  const query: Record<string, any> = {};
  ['select', 'eq', 'lt', 'gte', 'order', 'limit'].forEach((method) => {
    query[method] = jest.fn().mockReturnValue(query);
  });
  Object.defineProperty(query, 'then', {
    value: (onFulfilled: any, onRejected?: any) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
  });
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// fetchCoachSessions
// ===========================================================================

describe('fetchCoachSessions', () => {
  const userId = 'user-abc';

  it('returns sessions mapped to CoachSessionSummary shape', async () => {
    const rows = [
      {
        session_id: 'sess-1',
        user_message: 'How do I improve my squat?',
        created_at: '2026-03-24T10:00:00.000Z',
      },
      {
        session_id: 'sess-2',
        user_message: 'What should I eat post-workout?',
        created_at: '2026-03-23T08:00:00.000Z',
      },
    ];
    const mockQuery = createMockQuery(rows);
    mockFrom.mockReturnValue(mockQuery);

    const result = await fetchCoachSessions(userId);

    expect(mockFrom).toHaveBeenCalledWith('coach_conversations');
    expect(mockQuery.select).toHaveBeenCalledWith('session_id, user_message, created_at');
    expect(mockQuery.eq).toHaveBeenCalledWith('user_id', userId);
    expect(mockQuery.eq).toHaveBeenCalledWith('turn_index', 0);
    expect(mockQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockQuery.limit).toHaveBeenCalledWith(21);

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]).toEqual({
      sessionId: 'sess-1',
      firstMessage: 'How do I improve my squat?',
      turnCount: 1,
      createdAt: '2026-03-24T10:00:00.000Z',
      updatedAt: '2026-03-24T10:00:00.000Z',
    });
    expect(result.nextCursor).toBeNull();
  });

  it('returns empty when data is null', async () => {
    mockFrom.mockReturnValue(createMockQuery(null));

    const result = await fetchCoachSessions(userId);

    expect(result).toEqual({ sessions: [], nextCursor: null });
  });

  it('returns empty when data is empty array', async () => {
    mockFrom.mockReturnValue(createMockQuery([]));

    const result = await fetchCoachSessions(userId);

    expect(result).toEqual({ sessions: [], nextCursor: null });
  });

  it('sets nextCursor when results exceed pageSize', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      session_id: `sess-${i}`,
      user_message: `Message ${i}`,
      created_at: `2026-03-${String(24 - i).padStart(2, '0')}T10:00:00.000Z`,
    }));
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await fetchCoachSessions(userId);

    expect(result.sessions).toHaveLength(20);
    expect(result.nextCursor).toBe(rows[19].created_at);
  });

  it('applies cursor filter via .lt() when cursor provided', async () => {
    const mockQuery = createMockQuery([]);
    mockFrom.mockReturnValue(mockQuery);

    await fetchCoachSessions(userId, '2026-03-20T00:00:00.000Z');

    expect(mockQuery.lt).toHaveBeenCalledWith('created_at', '2026-03-20T00:00:00.000Z');
  });

  it('does not call .lt() when no cursor', async () => {
    const mockQuery = createMockQuery([]);
    mockFrom.mockReturnValue(mockQuery);

    await fetchCoachSessions(userId);

    expect(mockQuery.lt).not.toHaveBeenCalled();
  });

  it('returns empty on Supabase error', async () => {
    mockFrom.mockReturnValue(createMockQuery(null, { message: 'db connection failed' }));

    const result = await fetchCoachSessions(userId);

    expect(result).toEqual({ sessions: [], nextCursor: null });
  });
});

// ===========================================================================
// fetchCoachSessionMessages
// ===========================================================================

describe('fetchCoachSessionMessages', () => {
  const sessionId = 'sess-123';

  it('reconstructs CoachMessage[] — each row yields user then assistant', async () => {
    const rows = [
      {
        turn_index: 0,
        user_message: 'How do I improve my squat?',
        assistant_message: 'Focus on depth and knee tracking.',
        context: { focus: 'strength_training' },
        created_at: '2026-03-24T10:00:00.000Z',
      },
      {
        turn_index: 1,
        user_message: 'What about mobility?',
        assistant_message: 'Try hip flexor stretches before squatting.',
        context: { focus: 'strength_training' },
        created_at: '2026-03-24T10:01:00.000Z',
      },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await fetchCoachSessionMessages(sessionId);

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(sessionId);
    expect(result!.messages).toHaveLength(4);
    expect(result!.messages[0]).toEqual({ role: 'user', content: 'How do I improve my squat?' });
    expect(result!.messages[1]).toEqual({
      role: 'assistant',
      content: 'Focus on depth and knee tracking.',
    });
    expect(result!.messages[2]).toEqual({ role: 'user', content: 'What about mobility?' });
    expect(result!.messages[3]).toEqual({
      role: 'assistant',
      content: 'Try hip flexor stretches before squatting.',
    });
    expect(result!.createdAt).toBe('2026-03-24T10:00:00.000Z');
  });

  it('extracts context.focus from first row JSONB', async () => {
    const rows = [
      {
        turn_index: 0,
        user_message: 'Nutrition advice',
        assistant_message: 'Eat more protein.',
        context: { focus: 'nutrition' },
        created_at: '2026-03-24T10:00:00.000Z',
      },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await fetchCoachSessionMessages(sessionId);

    expect(result!.context).toEqual({ focus: 'nutrition' });
  });

  it('sets context.focus to undefined when context is null', async () => {
    const rows = [
      {
        turn_index: 0,
        user_message: 'Hi',
        assistant_message: 'Hello',
        context: null,
        created_at: '2026-03-24T10:00:00.000Z',
      },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await fetchCoachSessionMessages(sessionId);

    expect(result!.context).toEqual({ focus: undefined });
  });

  it('sets context.focus to undefined when focus is non-string', async () => {
    const rows = [
      {
        turn_index: 0,
        user_message: 'Hi',
        assistant_message: 'Hello',
        context: { focus: 42 },
        created_at: '2026-03-24T10:00:00.000Z',
      },
    ];
    mockFrom.mockReturnValue(createMockQuery(rows));

    const result = await fetchCoachSessionMessages(sessionId);

    expect(result!.context).toEqual({ focus: undefined });
  });

  it('returns null when no data found (empty array)', async () => {
    mockFrom.mockReturnValue(createMockQuery([]));

    const result = await fetchCoachSessionMessages(sessionId);

    expect(result).toBeNull();
  });

  it('returns null when data is null', async () => {
    mockFrom.mockReturnValue(createMockQuery(null));

    const result = await fetchCoachSessionMessages(sessionId);

    expect(result).toBeNull();
  });

  it('returns null on Supabase error', async () => {
    mockFrom.mockReturnValue(createMockQuery(null, { message: 'db error' }));

    const result = await fetchCoachSessionMessages(sessionId);

    expect(result).toBeNull();
  });

  it('queries with correct select, eq, and ordering', async () => {
    const mockQuery = createMockQuery([]);
    mockFrom.mockReturnValue(mockQuery);

    await fetchCoachSessionMessages(sessionId);

    expect(mockFrom).toHaveBeenCalledWith('coach_conversations');
    expect(mockQuery.select).toHaveBeenCalledWith(
      'turn_index, user_message, assistant_message, context, created_at',
    );
    expect(mockQuery.eq).toHaveBeenCalledWith('session_id', sessionId);
    expect(mockQuery.order).toHaveBeenCalledWith('turn_index', { ascending: true });
  });
});

// ===========================================================================
// fetchTodaySession
// ===========================================================================

describe('fetchTodaySession', () => {
  const userId = 'user-abc';

  it('returns null when no session found today', async () => {
    mockFrom.mockReturnValue(createMockQuery([]));

    const result = await fetchTodaySession(userId);

    expect(result).toBeNull();
  });

  it('delegates to fetchCoachSessionMessages with session_id from first result', async () => {
    const todayQuery = createMockQuery([{ session_id: 'sess-today' }]);
    const messagesQuery = createMockQuery([
      {
        turn_index: 0,
        user_message: 'Morning question',
        assistant_message: 'Morning answer',
        context: { focus: 'general' },
        created_at: '2026-03-24T08:00:00.000Z',
      },
    ]);
    mockFrom.mockReturnValueOnce(todayQuery).mockReturnValueOnce(messagesQuery);

    const result = await fetchTodaySession(userId);

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('sess-today');
    expect(result!.messages).toHaveLength(2);
    expect(result!.messages[0]).toEqual({ role: 'user', content: 'Morning question' });
    expect(result!.messages[1]).toEqual({ role: 'assistant', content: 'Morning answer' });
    expect(result!.context).toEqual({ focus: 'general' });
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('applies gte filter with today midnight ISO string', async () => {
    const mockQuery = createMockQuery([]);
    mockFrom.mockReturnValue(mockQuery);

    await fetchTodaySession(userId);

    expect(mockQuery.gte).toHaveBeenCalledWith(
      'created_at',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    );
  });

  it('queries with correct filters and ordering', async () => {
    const mockQuery = createMockQuery([]);
    mockFrom.mockReturnValue(mockQuery);

    await fetchTodaySession(userId);

    expect(mockFrom).toHaveBeenCalledWith('coach_conversations');
    expect(mockQuery.select).toHaveBeenCalledWith('session_id');
    expect(mockQuery.eq).toHaveBeenCalledWith('user_id', userId);
    expect(mockQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockQuery.limit).toHaveBeenCalledWith(1);
  });

  it('returns null on Supabase error', async () => {
    mockFrom.mockReturnValue(createMockQuery(null, { message: 'timeout' }));

    const result = await fetchTodaySession(userId);

    expect(result).toBeNull();
  });

  it('returns null when data is null', async () => {
    mockFrom.mockReturnValue(createMockQuery(null));

    const result = await fetchTodaySession(userId);

    expect(result).toBeNull();
  });
});
