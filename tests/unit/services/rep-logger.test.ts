/**
 * Wave 30 C4 — supabase-backed rep-logger coverage.
 *
 * Complements the existing `rep-logger-helpers.test.ts` which covers the
 * pure aggregation helpers + RepBuilder. This file exercises the
 * side-effectful paths:
 *
 *   - `logRep` when `ensureUserId()` rejects (auth lost mid-session) —
 *     must surface the error to the caller without corrupting the log.
 *   - `logRep` when supabase.insert resolves with an error — logRep
 *     re-throws so the caller's `withErrorHandling` wrapper can classify
 *     it. (Note: there is no `FormTrackingError` code `REP_INSERT_FAILED`
 *     in source today; this spec asserts the actual re-throw behaviour
 *     and leaves a TODO pointer should the code paths ever diverge.)
 *   - `emitPrHitIfRecord` with higherIsBetter=false (lower-is-better
 *     metrics like bar speed loss, RPE, time) — emits on strictly lower
 *     currentMetric.
 *   - `emitPrHitIfRecord` with NaN inputs — does not emit, does not
 *     crash.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const insertCalls: Array<Record<string, unknown>> = [];
let nextInsertError: { message: string } | null = null;

const mockFrom = jest.fn((_table: string) => ({
  insert: jest.fn(async (payload: Record<string, unknown>) => {
    insertCalls.push(payload);
    return { data: null, error: nextInsertError };
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

const mockEnsureUserId = jest.fn();
jest.mock('@/lib/auth-utils', () => ({
  ensureUserId: () => mockEnsureUserId(),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  warnWithTs: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'rep-uuid-fixture'),
}));

jest.mock('@/lib/services/telemetry-context', () => ({
  getTelemetryContext: () => ({
    modelVersion: 'arkit@1.0.0',
    cueConfigVersion: 'v1',
    experimentId: null,
    variant: null,
  }),
}));

const emittedHaptics: string[] = [];
jest.mock('@/lib/haptics/haptic-bus', () => ({
  hapticBus: {
    emit: jest.fn((event: string) => {
      emittedHaptics.push(event);
    }),
  },
}));

import { emitPrHitIfRecord, logRep } from '@/lib/services/rep-logger';
import type { RepEvent } from '@/lib/types/telemetry';

function baseRep(overrides: Partial<RepEvent> = {}): RepEvent {
  return {
    sessionId: 'sess-1',
    repIndex: 1,
    exercise: 'pullup',
    startTs: '2026-04-21T00:00:00Z',
    endTs: '2026-04-21T00:00:02Z',
    features: { romDeg: 140 },
    faultsDetected: [],
    cuesEmitted: [],
    ...overrides,
  };
}

describe('rep-logger — supabase-backed paths (wave-30 C4)', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    emittedHaptics.length = 0;
    nextInsertError = null;
    mockFrom.mockClear();
    mockEnsureUserId.mockReset();
  });

  describe('logRep — error paths', () => {
    test('rejects and surfaces the error when ensureUserId() itself rejects', async () => {
      // Simulate auth dropping mid-session: ensureUserId throws.
      mockEnsureUserId.mockRejectedValueOnce(new Error('Not signed in'));

      await expect(logRep(baseRep())).rejects.toThrow(/not signed in/i);
      // No insert was attempted because the auth gate fired first.
      expect(insertCalls).toHaveLength(0);
    });

    test('re-throws when supabase insert resolves with an error object', async () => {
      // TODO(wave-30 C4): the task spec suggests emitting a
      // FormTrackingError with code REP_INSERT_FAILED. Source does not
      // wrap supabase errors that way today — it re-throws the raw
      // supabase error. Asserting actual behaviour; bump to the wrapper
      // codepath in a follow-up refactor if the error domain is added.
      mockEnsureUserId.mockResolvedValueOnce('user-42');
      nextInsertError = { message: 'row-level security violation' };

      await expect(logRep(baseRep())).rejects.toMatchObject({
        message: expect.stringMatching(/row-level security/i),
      });
      // Payload was attempted exactly once.
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]).toMatchObject({
        rep_id: 'rep-uuid-fixture',
        user_id: 'user-42',
        session_id: 'sess-1',
        exercise: 'pullup',
      });
    });

    test('happy path: insert succeeds with no error → returns rep_id and logs payload', async () => {
      mockEnsureUserId.mockResolvedValueOnce('user-99');

      const repId = await logRep(
        baseRep({ fqi: 85, faultsDetected: ['shallow_depth'] }),
      );

      expect(repId).toBe('rep-uuid-fixture');
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]).toMatchObject({
        rep_id: 'rep-uuid-fixture',
        user_id: 'user-99',
        session_id: 'sess-1',
        exercise: 'pullup',
        fqi: 85,
        faults_detected: ['shallow_depth'],
      });
    });
  });

  describe('emitPrHitIfRecord', () => {
    test('higherIsBetter=false + lower current than baseline → emits pr.hit', () => {
      // Classic lower-is-better metric (e.g. bar-path deviation, time to
      // complete a rep). currentMetric < baselineMetric should flip the
      // PR flag and emit the haptic exactly once.
      const isPr = emitPrHitIfRecord({
        currentMetric: 1.2,
        baselineMetric: 1.5,
        higherIsBetter: false,
      });
      expect(isPr).toBe(true);
      expect(emittedHaptics).toEqual(['pr.hit']);
    });

    test('higherIsBetter=false + current >= baseline → no emit', () => {
      const equal = emitPrHitIfRecord({
        currentMetric: 1.5,
        baselineMetric: 1.5,
        higherIsBetter: false,
      });
      const worse = emitPrHitIfRecord({
        currentMetric: 1.8,
        baselineMetric: 1.5,
        higherIsBetter: false,
      });
      expect(equal).toBe(false);
      expect(worse).toBe(false);
      expect(emittedHaptics).toEqual([]);
    });

    test('NaN currentMetric → returns false without emitting (no crash)', () => {
      const isPr = emitPrHitIfRecord({
        currentMetric: Number.NaN,
        baselineMetric: 100,
      });
      expect(isPr).toBe(false);
      expect(emittedHaptics).toEqual([]);
    });

    test('NaN baselineMetric → returns false without emitting (guarded)', () => {
      const isPr = emitPrHitIfRecord({
        currentMetric: 120,
        baselineMetric: Number.NaN,
      });
      expect(isPr).toBe(false);
      expect(emittedHaptics).toEqual([]);
    });

    test('null / undefined baselineMetric → returns false (no-baseline case)', () => {
      expect(
        emitPrHitIfRecord({ currentMetric: 120, baselineMetric: null }),
      ).toBe(false);
      expect(
        emitPrHitIfRecord({ currentMetric: 120, baselineMetric: undefined }),
      ).toBe(false);
      expect(emittedHaptics).toEqual([]);
    });

    test('default higherIsBetter=true + current > baseline → emits pr.hit', () => {
      const isPr = emitPrHitIfRecord({
        currentMetric: 150,
        baselineMetric: 130,
      });
      expect(isPr).toBe(true);
      expect(emittedHaptics).toEqual(['pr.hit']);
    });
  });
});
