/**
 * Unit tests for exercise-history service.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  logWithTs: jest.fn(),
}));

const mockDb = {
  getAllAsync: jest.fn(),
};

jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    get db() {
      return mockDb;
    },
  },
}));

const mockSupabaseLimit = jest.fn();
const mockSupabaseOrder = jest.fn(() => ({ limit: mockSupabaseLimit }));
const mockSupabaseNot = jest.fn(() => ({ order: mockSupabaseOrder }));
const mockSupabaseEq = jest.fn(() => ({ not: mockSupabaseNot, order: mockSupabaseOrder }));
const mockSupabaseSelect = jest.fn(() => ({ eq: mockSupabaseEq }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ select: mockSupabaseSelect })),
  },
}));

import { getExerciseHistorySummary, EMPTY_EXERCISE_HISTORY } from '@/lib/services/exercise-history';

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.getAllAsync.mockReset();
  mockSupabaseLimit.mockReset();
  mockSupabaseLimit.mockResolvedValue({ data: [], error: null });
});

describe('getExerciseHistorySummary', () => {
  it('returns EMPTY summary for blank exerciseId without touching db', async () => {
    const result = await getExerciseHistorySummary('');
    expect(result).toEqual(EMPTY_EXERCISE_HISTORY);
    expect(mockDb.getAllAsync).not.toHaveBeenCalled();
  });

  it('returns EMPTY summary when no sessions exist locally or remotely', async () => {
    mockDb.getAllAsync.mockResolvedValue([]);
    mockSupabaseLimit.mockResolvedValue({ data: [], error: null });

    const result = await getExerciseHistorySummary('ex-pullup');
    expect(result).toEqual(EMPTY_EXERCISE_HISTORY);
  });

  it('builds summary from a single session with one set', async () => {
    mockDb.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workout_session_exercises')) {
        return [
          {
            session_id: 'sess-1',
            ended_at: '2024-11-01T12:00:00.000Z',
            started_at: '2024-11-01T11:00:00.000Z',
            set_id: 'set-1',
            completed_at: '2024-11-01T11:05:00.000Z',
            actual_reps: 8,
            actual_weight: 185,
          },
        ];
      }
      if (sql.includes('FROM reps')) {
        return [];
      }
      return [];
    });

    const result = await getExerciseHistorySummary('ex-bench');
    expect(result.lastSession).not.toBeNull();
    expect(result.lastSession?.sessionId).toBe('sess-1');
    expect(result.lastSession?.sets).toBe(1);
    expect(result.lastSession?.totalReps).toBe(8);
    expect(result.lastSession?.topWeightLb).toBe(185);
    expect(result.lastSession?.avgFqi).toBeNull();
    expect(result.maxReps).toBe(8);
    expect(result.maxVolume).toBe(8 * 185);
    expect(result.last5SessionsAvgFqi).toBeNull();
  });

  it('averages FQI across up to the last 5 sessions and surfaces max reps/volume', async () => {
    // Build 6 sessions with different rep/weight combos to verify max + cap at 5.
    const base = 1700000000000;
    const sessionRows = Array.from({ length: 6 }, (_, i) => ({
      session_id: `sess-${i + 1}`,
      ended_at: new Date(base + i * 86_400_000).toISOString(), // newest-first emulation via ordering
      started_at: new Date(base + i * 86_400_000 - 3600_000).toISOString(),
      set_id: `set-${i + 1}`,
      completed_at: new Date(base + i * 86_400_000).toISOString(),
      actual_reps: 5 + i,
      actual_weight: 100 + i * 10,
    }));
    // Local query returns rows newest-first — simulate by reversing
    const newestFirst = [...sessionRows].reverse();

    const fqiRows = [
      { session_id: 'sess-6', fqi: 90 },
      { session_id: 'sess-5', fqi: 80 },
      { session_id: 'sess-4', fqi: 70 },
      { session_id: 'sess-3', fqi: 60 },
      { session_id: 'sess-2', fqi: 50 },
      { session_id: 'sess-1', fqi: 40 }, // should be excluded (outside 5-most-recent)
    ];

    mockDb.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM workout_session_exercises')) return newestFirst;
      if (sql.includes('FROM reps')) return fqiRows;
      return [];
    });

    const result = await getExerciseHistorySummary('ex-squat');
    expect(result.lastSession?.sessionId).toBe('sess-6');
    expect(result.maxReps).toBe(10); // 5+5
    expect(result.maxVolume).toBe(10 * 150); // reps*weight for sess-6
    // Avg of last 5 sessions' FQI = (90+80+70+60+50)/5 = 70
    expect(result.last5SessionsAvgFqi).toBeCloseTo(70, 5);
  });

  it('falls back to EMPTY on local query exception', async () => {
    mockDb.getAllAsync.mockRejectedValue(new Error('sqlite broken'));
    mockSupabaseLimit.mockResolvedValue({ data: [], error: null });

    const result = await getExerciseHistorySummary('ex-pullup');
    expect(result).toEqual(EMPTY_EXERCISE_HISTORY);
  });
});
