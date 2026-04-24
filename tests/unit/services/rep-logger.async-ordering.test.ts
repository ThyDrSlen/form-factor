/**
 * Tests for lib/services/rep-logger.ts async ordering.
 *
 * The hot-path concern is that `emitPrHitIfRecord` fires the `pr.hit` haptic
 * synchronously the moment the caller knows a baseline + current pair, and
 * that `logRep` awaits its Supabase insert deterministically (so a milestone
 * detector that chains on the returned promise gets a consistent ordering
 * relative to the insert completing).
 *
 * We mock the Supabase insert chain, the auth helper, and the haptic bus to
 * capture ordering without touching the network.
 */

const mockHapticEmit = jest.fn();
const mockInsert = jest.fn();
// Using any here to keep jest.mock factory free of TS type references
// (Babel plugin-jest-hoist disallows out-of-scope identifiers, including types).
let mockInsertResolver: any = () => {};

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'rep-id-1234'),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: (...args) => {
        mockInsert(...args);
        return new Promise((resolve) => {
          mockInsertResolver = resolve;
        });
      },
    })),
  },
}));

jest.mock('@/lib/auth-utils', () => ({
  ensureUserId: jest.fn().mockResolvedValue('user-1'),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/haptics/haptic-bus', () => ({
  hapticBus: { emit: (...args) => mockHapticEmit(...args) },
  EVENT_TO_SEVERITY: {},
}));

jest.mock('@/lib/services/telemetry-context', () => ({
  getTelemetryContext: jest.fn(() => ({
    modelVersion: 'm1',
    cueConfigVersion: 'c1',
    experimentId: null,
    variant: null,
  })),
}));

import { emitPrHitIfRecord, logRep } from '@/lib/services/rep-logger';
import type { RepEvent } from '@/lib/types/telemetry';

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function baseRep(): RepEvent {
  return {
    sessionId: 'sess-1',
    setId: 'set-1',
    repIndex: 1,
    exercise: 'pullup',
    startTs: '2025-01-01T00:00:00Z',
    endTs: '2025-01-01T00:00:05Z',
    features: {},
    faultsDetected: [],
    cuesEmitted: [],
  };
}

describe('rep-logger: emitPrHitIfRecord ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fires pr.hit synchronously when current beats baseline (higherIsBetter)', () => {
    const ordering: string[] = [];
    mockHapticEmit.mockImplementation((event: string) => {
      ordering.push(`haptic:${event}`);
    });

    ordering.push('before-call');
    const isPr = emitPrHitIfRecord({ currentMetric: 105, baselineMetric: 100 });
    ordering.push('after-call');

    expect(isPr).toBe(true);
    expect(mockHapticEmit).toHaveBeenCalledTimes(1);
    expect(mockHapticEmit).toHaveBeenCalledWith('pr.hit');
    // Synchronous: haptic emission sits between before and after.
    expect(ordering).toEqual(['before-call', 'haptic:pr.hit', 'after-call']);
  });

  test('does NOT fire pr.hit when current does not beat baseline', () => {
    expect(emitPrHitIfRecord({ currentMetric: 95, baselineMetric: 100 })).toBe(false);
    expect(mockHapticEmit).not.toHaveBeenCalled();
  });

  test('treats null / NaN baseline as "no PR possible" (no haptic)', () => {
    expect(emitPrHitIfRecord({ currentMetric: 200, baselineMetric: null })).toBe(false);
    expect(emitPrHitIfRecord({ currentMetric: 200, baselineMetric: undefined })).toBe(false);
    expect(emitPrHitIfRecord({ currentMetric: 200, baselineMetric: Number.NaN })).toBe(false);
    expect(mockHapticEmit).not.toHaveBeenCalled();
  });

  test('higherIsBetter=false inverts the comparison (e.g. faster mile time)', () => {
    // Current (60s) is BETTER than baseline (70s) when lower is better.
    expect(
      emitPrHitIfRecord({ currentMetric: 60, baselineMetric: 70, higherIsBetter: false })
    ).toBe(true);
    expect(mockHapticEmit).toHaveBeenCalledWith('pr.hit');
    mockHapticEmit.mockClear();
    // 70 is NOT better than 60 under lower-is-better.
    expect(
      emitPrHitIfRecord({ currentMetric: 70, baselineMetric: 60, higherIsBetter: false })
    ).toBe(false);
    expect(mockHapticEmit).not.toHaveBeenCalled();
  });
});

describe('rep-logger: logRep ordering vs Supabase insert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockClear();
    mockInsertResolver = () => {};
  });

  test('logRep resolves AFTER the Supabase insert resolves (caller can chain milestone detection)', async () => {
    const ordering: string[] = [];
    const promise = logRep(baseRep()).then((id) => {
      ordering.push(`resolved:${id}`);
    });

    // Give the initial microtasks a chance to fire (ensureUserId + insert kickoff).
    await flushMicrotasks();

    // Supabase insert has been called but not yet resolved.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(ordering).toEqual([]);

    // Now resolve the Supabase insert.
    ordering.push('insert-about-to-resolve');
    mockInsertResolver({ error: null });

    await promise;

    // The caller's .then ran AFTER the insert resolved.
    expect(ordering).toEqual(['insert-about-to-resolve', 'resolved:rep-id-1234']);
  });

  test('logRep rejects if Supabase insert returns an error (milestone chain short-circuits)', async () => {
    const err = new Error('db down');
    const promise = logRep(baseRep());

    await flushMicrotasks();

    mockInsertResolver({ error: err });

    await expect(promise).rejects.toBe(err);
    // Even on error the insert was attempted exactly once — no retry in logRep itself.
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  test('emitPrHitIfRecord + logRep: haptic fires BEFORE the awaited insert completes', async () => {
    const ordering: string[] = [];
    mockHapticEmit.mockImplementation((event: string) => ordering.push(`haptic:${event}`));

    // Caller pattern: detect PR synchronously, THEN kick off the async insert.
    emitPrHitIfRecord({ currentMetric: 105, baselineMetric: 100 });
    const insertPromise = logRep(baseRep()).then(() => ordering.push('insert-resolved'));

    await flushMicrotasks();
    mockInsertResolver({ error: null });
    await insertPromise;

    // Ordering contract: haptic lands first (user feels PR), insert second.
    expect(ordering[0]).toBe('haptic:pr.hit');
    expect(ordering[ordering.length - 1]).toBe('insert-resolved');
  });
});
