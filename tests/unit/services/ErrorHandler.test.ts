/**
 * ErrorHandler domain-to-user-message + sanitizeDetails coverage
 * (wave-31, Pack C / C3).
 *
 * Complements `error-handler-form-tracking.test.ts` (which deep-dives the
 * form-tracking codes) with table-driven coverage over every other
 * domain, the `default`/`unknown` fallback, `sanitizeDetails` branches
 * (Error instance, JSON-cyclic, null/undefined, primitives), and both
 * `withErrorHandling` success + failure paths.
 *
 * Ships under a different filename to avoid overlap with the existing
 * form-tracking suite and in-flight test PRs.
 */

const mockErrorWithTs = jest.fn();
jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  infoWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: (...args: unknown[]) => mockErrorWithTs(...args),
}));

import {
  AppError,
  createError,
  mapToUserMessage,
  logError,
  shouldRetry,
  withErrorHandling,
} from '@/lib/services/ErrorHandler';

describe('ErrorHandler — createError defaults', () => {
  test('retryable defaults to false and severity to error', () => {
    const err = createError('network', 'UNREACHABLE', 'no route to host');
    expect(err.domain).toBe('network');
    expect(err.code).toBe('UNREACHABLE');
    expect(err.message).toBe('no route to host');
    expect(err.retryable).toBe(false);
    expect(err.severity).toBe('error');
    expect(err.details).toBeUndefined();
  });

  test('severity + retryable overrides plumb through', () => {
    const err = createError('sync', 'QUEUE_DRAIN_FAILED', 'retry later', {
      retryable: true,
      severity: 'warning',
      details: { attempts: 3 },
    });
    expect(err.retryable).toBe(true);
    expect(err.severity).toBe('warning');
    expect(err.details).toEqual({ attempts: 3 });
  });
});

describe('ErrorHandler — mapToUserMessage domain coverage', () => {
  // Table covers every non-form-tracking domain. The form-tracking domain
  // has its own dedicated suite in error-handler-form-tracking.test.ts.
  type DomainCase = {
    domain: AppError['domain'];
    code?: string;
    expectedContains: string;
  };

  const cases: DomainCase[] = [
    { domain: 'network', expectedContains: 'Connection issue' },
    { domain: 'session', expectedContains: 'session could not be validated' },
    { domain: 'validation', expectedContains: 'configuration is incomplete' },
    { domain: 'camera', expectedContains: 'Camera is unavailable' },
    { domain: 'ml', expectedContains: 'Processing issue' },
    { domain: 'storage', expectedContains: 'trouble saving your data' },
    { domain: 'sync', expectedContains: 'Sync issue' },
    { domain: 'auth', expectedContains: 'Authentication error' },
    { domain: 'coach', expectedContains: 'Coach service hit an issue' },
  ];

  test.each(cases)('maps domain=$domain to user-facing copy', ({ domain, expectedContains }) => {
    const msg = mapToUserMessage(createError(domain, 'SOME_CODE', 'internal'));
    expect(msg).toContain(expectedContains);
    // Generic fallback must never leak when the domain is known.
    expect(msg).not.toBe('Something went wrong. Please try again.');
  });

  test('unknown domain (via the `default` branch) falls back to generic copy', () => {
    // Cast because the union rejects arbitrary strings; the default branch
    // is only reachable from non-exhaustive inputs in practice.
    const err = createError('unknown' as AppError['domain'], 'X', 'internal');
    const msg = mapToUserMessage(err);
    expect(msg).toBe('Something went wrong. Please try again.');
  });

  test('oauth: base domain copy vs OAUTH_CANCELLED vs OAUTH_DISMISSED are distinct', () => {
    const cancelled = mapToUserMessage(createError('oauth', 'OAUTH_CANCELLED', 'user back'));
    const dismissed = mapToUserMessage(createError('oauth', 'OAUTH_DISMISSED', 'user swiped'));
    const generic = mapToUserMessage(createError('oauth', 'OAUTH_UNKNOWN', 'other'));

    expect(cancelled.toLowerCase()).toContain('cancelled');
    expect(dismissed.toLowerCase()).toContain('dismissed');
    expect(generic.toLowerCase()).toContain('authentication failed');
    expect(new Set([cancelled, dismissed, generic]).size).toBe(3);
  });

  test('coach: COACH_RATE_LIMITED overrides the domain-default copy', () => {
    const rate = mapToUserMessage(createError('coach', 'COACH_RATE_LIMITED', 'too many'));
    const generic = mapToUserMessage(createError('coach', 'COACH_OTHER', 'other'));

    expect(rate.toLowerCase()).toContain('rate-limited');
    expect(generic.toLowerCase()).toContain('coach service');
    expect(rate).not.toBe(generic);
  });
});

describe('ErrorHandler — shouldRetry', () => {
  test('honors explicit retryable=true', () => {
    const err = createError('validation', 'X', 'y', { retryable: true });
    expect(shouldRetry(err)).toBe(true);
  });

  test('honors explicit retryable=false on a domain that would default-true', () => {
    // NB: the implementation returns `err.retryable` when it's a boolean.
    // That means retryable:false on a network error short-circuits the
    // domain-default true; lock that in.
    const err = createError('network', 'X', 'y', { retryable: false });
    expect(shouldRetry(err)).toBe(false);
  });

  test('network + sync domains are retryable even without explicit override when not set', () => {
    // createError always sets a boolean (defaults false), so to reach the
    // "typeof err.retryable !== 'boolean'" branch we have to build the
    // object by hand.
    const network = { ...createError('network', 'X', 'y'), retryable: undefined as any };
    const sync = { ...createError('sync', 'X', 'y'), retryable: undefined as any };
    const auth = { ...createError('auth', 'X', 'y'), retryable: undefined as any };

    expect(shouldRetry(network)).toBe(true);
    expect(shouldRetry(sync)).toBe(true);
    expect(shouldRetry(auth)).toBe(false);
  });
});

describe('ErrorHandler — logError + sanitizeDetails branches', () => {
  beforeEach(() => {
    mockErrorWithTs.mockClear();
  });

  // errorWithTs is called as (tag, payload) — our mock records args as-is,
  // so the structured payload lives at mock.calls[0][1].
  test('Error instance details are captured as { name, message, stack }', () => {
    const cause = new TypeError('bad thing');
    logError(createError('ml', 'BOOM', 'explode', { details: cause }), { feature: 'ui' });
    expect(mockErrorWithTs).toHaveBeenCalled();
    const payload = mockErrorWithTs.mock.calls[0][1];
    expect(payload.details).toEqual(
      expect.objectContaining({
        name: 'TypeError',
        message: 'bad thing',
        stack: expect.any(String),
      }),
    );
    // Stack is preserved (not swallowed), so ops can triage post-mortem.
    expect(String(payload.details.stack)).toContain('bad thing');
  });

  test('plain JSON-safe details pass through untouched', () => {
    logError(createError('storage', 'SAVE_FAIL', 'disk', { details: { size: 42 } }));
    const payload = mockErrorWithTs.mock.calls[0][1];
    expect(payload.details).toEqual({ size: 42 });
  });

  test('undefined details resolve to undefined in the payload', () => {
    logError(createError('network', 'N', 'oops'));
    const payload = mockErrorWithTs.mock.calls[0][1];
    expect(payload.details).toBeUndefined();
  });

  test('cyclic details are coerced to their String() representation', () => {
    const cyclic: any = { name: 'cyclic' };
    cyclic.self = cyclic;
    logError(createError('sync', 'CYCLIC', 'boom', { details: cyclic }));
    const payload = mockErrorWithTs.mock.calls[0][1];
    // JSON.stringify throws for cycles → catch-branch returns String(details).
    expect(typeof payload.details).toBe('string');
    expect(payload.details).toMatch(/object/);
  });

  test('payload includes structured fields for downstream dashboards', () => {
    logError(
      createError('coach', 'C1', 'hi', { severity: 'warning', retryable: true }),
      { feature: 'coach', location: 'coach-service', meta: { traceId: 'abc' } },
    );
    const payload = mockErrorWithTs.mock.calls[0][1];
    expect(payload).toEqual(
      expect.objectContaining({
        domain: 'coach',
        code: 'C1',
        message: 'hi',
        severity: 'warning',
        retryable: true,
        ctx: expect.objectContaining({ feature: 'coach', location: 'coach-service' }),
        platform: expect.any(String),
      }),
    );
  });
});

describe('ErrorHandler — withErrorHandling', () => {
  test('returns ok=true with data on successful promise', async () => {
    const result = await withErrorHandling(
      async () => ({ greeting: 'hi' }),
      () => createError('unknown', 'UNUSED', 'never'),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ greeting: 'hi' });
  });

  test('returns ok=false with the built AppError on throw', async () => {
    mockErrorWithTs.mockClear();
    const result = await withErrorHandling(
      async () => {
        throw new Error('boom');
      },
      (cause) =>
        createError('network', 'REQUEST_FAILED', 'failed to fetch', { details: cause }),
      { feature: 'app', location: 'withErrorHandling.test' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.domain).toBe('network');
      expect(result.error.code).toBe('REQUEST_FAILED');
      // Original Error is captured in the sanitized payload via logError.
      const payload = mockErrorWithTs.mock.calls[0][1];
      expect(payload.details).toEqual(
        expect.objectContaining({ name: 'Error', message: 'boom' }),
      );
    }
  });

  test('builder can inspect thrown value to classify the error', async () => {
    const result = await withErrorHandling(
      async () => {
        throw new Error('rate limited');
      },
      (cause) =>
        createError(
          'coach',
          (cause as Error).message.includes('rate') ? 'COACH_RATE_LIMITED' : 'COACH_OTHER',
          'service',
        ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COACH_RATE_LIMITED');
      // Maps to the dedicated rate-limit copy, not the generic coach fallback.
      expect(mapToUserMessage(result.error).toLowerCase()).toContain('rate-limited');
    }
  });
});
