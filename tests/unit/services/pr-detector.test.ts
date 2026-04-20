// ---------------------------------------------------------------------------
// Supabase mock — jest.mock is hoisted, so all values it needs must be
// resolved from inside the factory or the jest globalThis.
// We attach the "current result" on globalThis so tests can mutate it.
// ---------------------------------------------------------------------------

type QueryResult = { data: unknown; error: unknown };

declare global {
  // eslint-disable-next-line no-var
  var __prDetectorResult: QueryResult;
  // eslint-disable-next-line no-var
  var __prDetectorShouldThrow: unknown;
}

(globalThis as unknown as { __prDetectorResult: QueryResult }).__prDetectorResult = {
  data: [],
  error: null,
};

function setHistory(rows: Array<Record<string, unknown>>) {
  (globalThis as unknown as { __prDetectorResult: QueryResult }).__prDetectorResult = {
    data: rows,
    error: null,
  };
  (globalThis as unknown as { __prDetectorShouldThrow: unknown }).__prDetectorShouldThrow = undefined;
}
function setError(error: { code?: string; message: string }) {
  (globalThis as unknown as { __prDetectorResult: QueryResult }).__prDetectorResult = {
    data: null,
    error,
  };
  (globalThis as unknown as { __prDetectorShouldThrow: unknown }).__prDetectorShouldThrow = undefined;
}
function setThrows(err: unknown) {
  (globalThis as unknown as { __prDetectorShouldThrow: unknown }).__prDetectorShouldThrow = err;
}

jest.mock('@/lib/supabase', () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === 'then') {
        return (
          onFulfilled?: ((v: unknown) => unknown) | null,
          onRejected?: ((e: unknown) => unknown) | null,
        ) => {
          const thrown = (globalThis as { __prDetectorShouldThrow?: unknown }).__prDetectorShouldThrow;
          if (thrown !== undefined) {
            return Promise.reject(thrown).then(onFulfilled ?? undefined, onRejected ?? undefined);
          }
          const result = (globalThis as { __prDetectorResult: QueryResult }).__prDetectorResult;
          return Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined);
        };
      }
      if (prop === 'catch' || prop === 'finally') {
        return () => {
          const thrown = (globalThis as { __prDetectorShouldThrow?: unknown }).__prDetectorShouldThrow;
          if (thrown !== undefined) return Promise.reject(thrown);
          const result = (globalThis as { __prDetectorResult: QueryResult }).__prDetectorResult;
          return Promise.resolve(result);
        };
      }
      return () => new Proxy({}, handler);
    },
  };
  return {
    supabase: {
      from: () => new Proxy({}, handler),
    },
  };
});

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  infoWithTs: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { detectNewPR, formatPRMessage, type Set, type PRResult } from '@/lib/services/pr-detector';

describe('pr-detector', () => {
  beforeEach(() => {
    setHistory([]);
  });

  describe('detectNewPR', () => {
    it('returns null when user has no prior history (first set)', async () => {
      setHistory([]);
      const r = await detectNewPR('u1', 'pullup', { weight: 50, reps: 5 });
      expect(r).toBeNull();
    });

    it('detects a new weight PR', async () => {
      setHistory([
        { load_value: 40, reps_count: 5, avg_fqi: 80 },
        { load_value: 45, reps_count: 3, avg_fqi: 85 },
      ]);
      const r = await detectNewPR('u1', 'pullup', { weight: 50, reps: 2 });
      expect(r).toEqual<PRResult>({
        type: 'weight',
        value: 50,
        previousBest: 45,
        exerciseId: 'pullup',
      });
    });

    it('returns null when weight matches prior max (no weight PR)', async () => {
      setHistory([
        { load_value: 50, reps_count: 5, avg_fqi: 80 },
        { load_value: 50, reps_count: 4, avg_fqi: 75 },
      ]);
      // Same reps, same weight, no FQI provided → no PR
      const r = await detectNewPR('u1', 'pullup', { weight: 50, reps: 5 });
      expect(r).toBeNull();
    });

    it('detects a new reps-at-weight PR', async () => {
      setHistory([
        { load_value: 50, reps_count: 5, avg_fqi: 80 },
        { load_value: 60, reps_count: 3, avg_fqi: 82 }, // heavier, irrelevant
        { load_value: 50, reps_count: 6, avg_fqi: 78 },
      ]);
      const r = await detectNewPR('u1', 'pullup', { weight: 50, reps: 7 });
      expect(r).toEqual<PRResult>({
        type: 'reps_at_weight',
        value: 7,
        previousBest: 6,
        exerciseId: 'pullup',
      });
    });

    it('detects a new fqi-at-weight PR when weight+reps match a prior set', async () => {
      setHistory([
        { load_value: 50, reps_count: 5, avg_fqi: 75 },
        { load_value: 50, reps_count: 5, avg_fqi: 80 },
      ]);
      const r = await detectNewPR('u1', 'pullup', { weight: 50, reps: 5, avgFqi: 90 });
      expect(r).toEqual<PRResult>({
        type: 'fqi_at_weight',
        value: 90,
        previousBest: 80,
        exerciseId: 'pullup',
      });
    });

    it('returns null when Supabase returns an RLS / auth error', async () => {
      setError({ code: 'PGRST301', message: 'row-level security denied' });
      const r = await detectNewPR('u1', 'pullup', { weight: 50, reps: 5 });
      expect(r).toBeNull();
    });

    it('returns null when Supabase query throws unexpectedly', async () => {
      setThrows(new Error('boom'));
      const r = await detectNewPR('u1', 'pullup', { weight: 50, reps: 5 });
      expect(r).toBeNull();
    });

    it('returns null for NaN weight', async () => {
      setHistory([{ load_value: 40, reps_count: 5, avg_fqi: 80 }]);
      const r = await detectNewPR('u1', 'pullup', { weight: Number.NaN, reps: 5 });
      expect(r).toBeNull();
    });

    it('returns null for non-finite weight (Infinity)', async () => {
      setHistory([{ load_value: 40, reps_count: 5, avg_fqi: 80 }]);
      const r = await detectNewPR('u1', 'pullup', { weight: Number.POSITIVE_INFINITY, reps: 5 });
      expect(r).toBeNull();
    });

    it('returns null for empty / invalid userId', async () => {
      setHistory([{ load_value: 40, reps_count: 5, avg_fqi: 80 }]);
      expect(await detectNewPR('', 'pullup', { weight: 50, reps: 5 })).toBeNull();
    });

    it('returns null for empty / invalid exerciseId', async () => {
      setHistory([{ load_value: 40, reps_count: 5, avg_fqi: 80 }]);
      expect(await detectNewPR('u1', '', { weight: 50, reps: 5 })).toBeNull();
    });

    it('returns null for zero / negative reps', async () => {
      setHistory([{ load_value: 40, reps_count: 5, avg_fqi: 80 }]);
      expect(await detectNewPR('u1', 'pullup', { weight: 50, reps: 0 })).toBeNull();
      expect(await detectNewPR('u1', 'pullup', { weight: 50, reps: -3 })).toBeNull();
    });

    it('treats duplicate prior weight rows correctly', async () => {
      // Same weight appears many times — still take the max reps among them.
      setHistory([
        { load_value: 50, reps_count: 5, avg_fqi: 70 },
        { load_value: 50, reps_count: 5, avg_fqi: 80 },
        { load_value: 50, reps_count: 5, avg_fqi: 90 },
      ]);
      // Current matches weight+reps, no better FQI → no PR.
      expect(await detectNewPR('u1', 'pullup', { weight: 50, reps: 5, avgFqi: 85 })).toBeNull();
      // More reps at the same weight → reps_at_weight PR.
      expect(await detectNewPR('u1', 'pullup', { weight: 50, reps: 6 })).toEqual<PRResult>({
        type: 'reps_at_weight',
        value: 6,
        previousBest: 5,
        exerciseId: 'pullup',
      });
    });

    it('skips weight PR when new weight equals prior max (tie is not a PR)', async () => {
      setHistory([{ load_value: 50, reps_count: 3, avg_fqi: 80 }]);
      // Tie at weight, less reps → null (not a PR)
      expect(await detectNewPR('u1', 'pullup', { weight: 50, reps: 2 })).toBeNull();
    });
  });

  describe('formatPRMessage', () => {
    it('formats weight PR with unit', () => {
      const msg = formatPRMessage({ type: 'weight', value: 50, previousBest: 45, exerciseId: 'pullup' }, 'lb');
      expect(msg).toContain('50 lb');
      expect(msg).toContain('45');
    });

    it('formats reps_at_weight PR', () => {
      const msg = formatPRMessage({ type: 'reps_at_weight', value: 8, previousBest: 7, exerciseId: 'pullup' });
      expect(msg).toContain('reps');
      expect(msg).toContain('8');
    });

    it('formats fqi_at_weight PR with integer percent', () => {
      const msg = formatPRMessage({ type: 'fqi_at_weight', value: 92.7, previousBest: 85, exerciseId: 'pullup' });
      expect(msg).toContain('93%');
    });

    it('accepts kg unit', () => {
      const msg = formatPRMessage({ type: 'weight', value: 100, previousBest: 95, exerciseId: 'squat' }, 'kg');
      expect(msg).toContain('100 kg');
    });
  });

  it('round-trips a set object with avgFqi: null', async () => {
    setHistory([{ load_value: 50, reps_count: 5, avg_fqi: 80 }]);
    const set: Set = { weight: 60, reps: 5, avgFqi: null };
    const r = await detectNewPR('u1', 'pullup', set);
    expect(r?.type).toBe('weight');
  });
});
