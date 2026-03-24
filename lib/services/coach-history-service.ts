import { supabase } from '@/lib/supabase';
import type { CoachMessage } from '@/lib/services/coach-service';

export interface CoachSessionSummary {
  sessionId: string;
  firstMessage: string;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CoachSessionDetail {
  sessionId: string;
  messages: CoachMessage[];
  context: { focus?: string };
  createdAt: string;
}

const DEFAULT_PAGE_SIZE = 20;
const TAG = '[coach-history]';

// Queries turn_index=0 rows as session-start proxies; turnCount is approximate (v1).
export async function fetchCoachSessions(
  userId: string,
  cursor?: string,
  limit: number = DEFAULT_PAGE_SIZE,
): Promise<{ sessions: CoachSessionSummary[]; nextCursor: string | null }> {
  try {
    let query = supabase
      .from('coach_conversations')
      .select('session_id, user_message, created_at')
      .eq('user_id', userId)
      .eq('turn_index', 0)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data, error } = await query;

    if (error) {
      console.warn(TAG, 'fetchCoachSessions error:', error.message);
      return { sessions: [], nextCursor: null };
    }

    if (!data || data.length === 0) {
      return { sessions: [], nextCursor: null };
    }

    const hasMore = data.length > limit;
    const page = hasMore ? data.slice(0, limit) : data;

    const sessions: CoachSessionSummary[] = page.map((row) => ({
      sessionId: row.session_id as string,
      firstMessage: row.user_message as string,
      turnCount: 1, // v1: exact count needs GROUP BY
      createdAt: row.created_at as string,
      updatedAt: row.created_at as string, // v1: no updated_at column
    }));

    const nextCursor = hasMore ? (page[page.length - 1].created_at as string) : null;

    return { sessions, nextCursor };
  } catch (err) {
    console.warn(TAG, 'fetchCoachSessions unexpected error:', err);
    return { sessions: [], nextCursor: null };
  }
}

export async function fetchCoachSessionMessages(
  sessionId: string,
): Promise<CoachSessionDetail | null> {
  try {
    const { data, error } = await supabase
      .from('coach_conversations')
      .select('turn_index, user_message, assistant_message, context, created_at')
      .eq('session_id', sessionId)
      .order('turn_index', { ascending: true });

    if (error) {
      console.warn(TAG, 'fetchCoachSessionMessages error:', error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const messages: CoachMessage[] = [];
    for (const row of data) {
      messages.push({ role: 'user', content: row.user_message as string });
      messages.push({ role: 'assistant', content: row.assistant_message as string });
    }

    const firstRow = data[0];
    const ctx = (firstRow.context as Record<string, unknown> | null) ?? {};

    return {
      sessionId,
      messages,
      context: { focus: typeof ctx.focus === 'string' ? ctx.focus : undefined },
      createdAt: firstRow.created_at as string,
    };
  } catch (err) {
    console.warn(TAG, 'fetchCoachSessionMessages unexpected error:', err);
    return null;
  }
}

export async function fetchTodaySession(
  userId: string,
): Promise<CoachSessionDetail | null> {
  try {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('coach_conversations')
      .select('session_id')
      .eq('user_id', userId)
      .gte('created_at', todayMidnight.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn(TAG, 'fetchTodaySession error:', error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return fetchCoachSessionMessages(data[0].session_id as string);
  } catch (err) {
    console.warn(TAG, 'fetchTodaySession unexpected error:', err);
    return null;
  }
}
