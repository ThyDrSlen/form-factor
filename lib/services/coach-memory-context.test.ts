/**
 * Tests for coach-memory-context — phase inference + clause synthesis.
 *
 * Supabase is mocked globally in tests/setup.ts. Where a test also needs
 * `.from()` we augment the mock via the exposed `__mockSupabaseAuth` pattern.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// -- Supabase mock with .from() support --------------------------------------
// The global setup only mocks auth; add from() here.
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    auth: (global as unknown as { __mockSupabaseAuth: unknown }).__mockSupabaseAuth,
  },
}));

import {
  buildWeekSummary,
  computeVolumeTrend,
  inferPhase,
  synthesizeMemoryClause,
} from './coach-memory-context';
import {
  cacheSessionBrief,
  cacheWeekSummary,
  type SessionBrief,
  type TrainingWeekSummary,
} from './coach-memory';

function makeBrief(overrides: Partial<SessionBrief> = {}): SessionBrief {
  return {
    sessionId: 'sess-1',
    startedAt: '2026-04-16T10:00:00.000Z',
    endedAt: '2026-04-16T11:00:00.000Z',
    durationMinutes: 60,
    goalProfile: 'hypertrophy',
    topExerciseName: 'Back Squat',
    totalSets: 10,
    totalReps: 70,
    avgRpe: 7.2,
    avgFqi: 0.8,
    notablePositive: null,
    notableNegative: null,
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSummary(overrides: Partial<TrainingWeekSummary> = {}): TrainingWeekSummary {
  return {
    windowStartedAt: '2026-04-09T00:00:00.000Z',
    sessionCount: 4,
    totalSets: 30,
    avgRpe: 7.4,
    avgFqi: null,
    volumeTrend: 'rising',
    phase: 'building',
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('coach-memory-context', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockFrom.mockReset();
  });

  // --------------------------------------------------------------------
  // inferPhase
  // --------------------------------------------------------------------
  describe('inferPhase', () => {
    it('returns "unknown" when there are no sessions', () => {
      expect(inferPhase({ avgRpe: 8, volumeTrend: 'rising', sessionCount: 0 })).toBe('unknown');
    });

    it('returns "recovery" on low avg RPE', () => {
      expect(inferPhase({ avgRpe: 5, volumeTrend: 'flat', sessionCount: 3 })).toBe('recovery');
    });

    it('returns "recovery" on a falling volume trend', () => {
      expect(inferPhase({ avgRpe: 7, volumeTrend: 'falling', sessionCount: 4 })).toBe('recovery');
    });

    it('returns "peaking" when RPE is high and volume is not rising', () => {
      expect(inferPhase({ avgRpe: 9, volumeTrend: 'flat', sessionCount: 3 })).toBe('peaking');
    });

    it('returns "building" when RPE is moderate and volume is not falling', () => {
      expect(inferPhase({ avgRpe: 7.5, volumeTrend: 'rising', sessionCount: 5 })).toBe('building');
      expect(inferPhase({ avgRpe: 6.5, volumeTrend: 'flat', sessionCount: 3 })).toBe('building');
    });

    it('returns "unknown" when rpe is null', () => {
      expect(inferPhase({ avgRpe: null, volumeTrend: 'flat', sessionCount: 3 })).toBe('unknown');
    });
  });

  // --------------------------------------------------------------------
  // computeVolumeTrend
  // --------------------------------------------------------------------
  describe('computeVolumeTrend', () => {
    it('flat when both zero', () => {
      expect(computeVolumeTrend(0, 0)).toBe('flat');
    });

    it('rising when prior is zero and current is positive', () => {
      expect(computeVolumeTrend(10, 0)).toBe('rising');
    });

    it('rising when >=15% growth', () => {
      expect(computeVolumeTrend(120, 100)).toBe('rising');
    });

    it('falling when <=15% shrink', () => {
      expect(computeVolumeTrend(80, 100)).toBe('falling');
    });

    it('flat within the 15% band', () => {
      expect(computeVolumeTrend(95, 100)).toBe('flat');
      expect(computeVolumeTrend(110, 100)).toBe('flat');
    });
  });

  // --------------------------------------------------------------------
  // synthesizeMemoryClause
  // --------------------------------------------------------------------
  describe('synthesizeMemoryClause', () => {
    it('returns null text when there is no cached memory', async () => {
      const clause = await synthesizeMemoryClause();
      expect(clause.text).toBeNull();
      expect(clause.lastBrief).toBeNull();
      expect(clause.weekSummary).toBeNull();
    });

    it('builds a clause from a cached brief alone', async () => {
      await cacheSessionBrief(
        makeBrief({
          topExerciseName: 'Deadlift',
          totalSets: 8,
          totalReps: 40,
          avgRpe: 8.1,
          notablePositive: 'smooth tempo',
        }),
      );

      const clause = await synthesizeMemoryClause();
      expect(clause.text).toMatch(/Deadlift/);
      expect(clause.text).toMatch(/8 sets/);
      expect(clause.text).toMatch(/RPE 8.1/);
      expect(clause.text).toMatch(/Positive: smooth tempo/);
    });

    it('includes watch-outs when present', async () => {
      await cacheSessionBrief(
        makeBrief({
          notableNegative: 'left-right asymmetry >10%',
        }),
      );

      const clause = await synthesizeMemoryClause();
      expect(clause.text).toMatch(/Watch-out: left-right asymmetry/);
    });

    it('adds a week summary line when available', async () => {
      await cacheSessionBrief(makeBrief());
      await cacheWeekSummary(
        makeSummary({ sessionCount: 3, totalSets: 25, volumeTrend: 'flat', phase: 'building' }),
      );

      const clause = await synthesizeMemoryClause();
      expect(clause.text).toMatch(/last 7 days: 3 session\(s\)/);
      expect(clause.text).toMatch(/volume flat/);
      expect(clause.text).toMatch(/phase: building/);
    });

    it('falls back to "mixed" when phase is unknown in the summary', async () => {
      await cacheWeekSummary(makeSummary({ phase: 'unknown' }));
      const clause = await synthesizeMemoryClause();
      expect(clause.text).toMatch(/phase: mixed/);
    });

    it('caps the clause at 5 sentences', async () => {
      await cacheSessionBrief(
        makeBrief({
          notablePositive: 'A',
          notableNegative: 'B',
        }),
      );
      await cacheWeekSummary(makeSummary());
      const clause = await synthesizeMemoryClause();
      const sentences = (clause.text ?? '').split(/\. +/).filter(Boolean);
      expect(sentences.length).toBeLessThanOrEqual(5);
    });

    it('uses explicit inputs when provided (no AsyncStorage round-trip)', async () => {
      const clause = await synthesizeMemoryClause({
        lastBrief: makeBrief({ topExerciseName: 'Bench Press' }),
        weekSummary: null,
      });
      expect(clause.text).toMatch(/Bench Press/);
      expect(clause.weekSummary).toBeNull();
    });
  });

  // --------------------------------------------------------------------
  // buildWeekSummary
  // --------------------------------------------------------------------
  describe('buildWeekSummary', () => {
    it('returns null on supabase error and does not throw', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockFrom.mockReturnValue({
        select: () => ({
          eq: () => ({
            gte: () => ({
              order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }),
            }),
          }),
        }),
      });

      const summary = await buildWeekSummary('user-1');
      expect(summary).toBeNull();
    });

    it('builds an empty summary when the user has no sessions', async () => {
      mockFrom.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            gte: (_col: string, _val: string) => ({
              order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
              lt: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }));

      const summary = await buildWeekSummary('user-1', Date.now());
      expect(summary).not.toBeNull();
      expect(summary?.sessionCount).toBe(0);
      expect(summary?.phase).toBe('unknown');
    });
  });
});
