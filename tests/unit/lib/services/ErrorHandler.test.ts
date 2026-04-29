/**
 * Unit tests for lib/services/ErrorHandler.ts — the form-tracking domain,
 * the per-code user-message mapping, coach domain + COACH_RATE_LIMITED
 * override, shouldRetry classification, logError context-tag enrichment,
 * and sanitization of Error instances in details.
 *
 * Complementary to the existing tests/unit/lib/services/error-handler.test.ts:
 * that file covers the core domains + withErrorHandling; this file closes the
 * gap on FormTrackingErrorCode + every mapped message including the unmapped-
 * code fallback.
 */

import {
  createError,
  mapToUserMessage,
  shouldRetry,
  logError,
  FormTrackingErrorCode,
  type AppError,
  type FormTrackingErrorCodeValue,
} from '@/lib/services/ErrorHandler';

// Silence logError's internal console writes so test output stays clean.
jest.mock('@/lib/logger', () => ({
  errorWithTs: jest.fn(),
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  infoWithTs: jest.fn(),
}));

import { errorWithTs } from '@/lib/logger';

// ---------------------------------------------------------------------------
// FormTrackingErrorCode: enum sanity
// ---------------------------------------------------------------------------

describe('FormTrackingErrorCode enum', () => {
  test('every member maps to its own string key (no reverse mappings)', () => {
    for (const [key, value] of Object.entries(FormTrackingErrorCode)) {
      expect(typeof value).toBe('string');
      expect(value).toBe(key);
    }
  });

  test('expected codes are present', () => {
    expect(FormTrackingErrorCode.FQI_DEGENERATE_RANGE).toBe('FQI_DEGENERATE_RANGE');
    expect(FormTrackingErrorCode.REP_LOG_PERSIST_FAILED).toBe('REP_LOG_PERSIST_FAILED');
    expect(FormTrackingErrorCode.SUBJECT_NOT_HUMAN).toBe('SUBJECT_NOT_HUMAN');
    expect(FormTrackingErrorCode.SUBJECT_SWITCH_DETECTED).toBe('SUBJECT_SWITCH_DETECTED');
    expect(FormTrackingErrorCode.CALIBRATION_FAILED).toBe('CALIBRATION_FAILED');
    expect(FormTrackingErrorCode.JOINT_OCCLUSION_TIMEOUT).toBe('JOINT_OCCLUSION_TIMEOUT');
    expect(FormTrackingErrorCode.CUE_PREEMPTION_FAILED).toBe('CUE_PREEMPTION_FAILED');
    expect(FormTrackingErrorCode.SESSION_STATE_DESYNC).toBe('SESSION_STATE_DESYNC');
    expect(FormTrackingErrorCode.EXPORT_FAILED).toBe('EXPORT_FAILED');
  });
});

// ---------------------------------------------------------------------------
// createError: form-tracking domain
// ---------------------------------------------------------------------------

describe('createError for FormTrackingErrorCode', () => {
  test('each code builds a valid AppError in the form-tracking domain', () => {
    const codes: FormTrackingErrorCodeValue[] = Object.values(FormTrackingErrorCode);

    for (const code of codes) {
      const err = createError('form-tracking', code, `test ${code}`);
      expect(err.domain).toBe('form-tracking');
      expect(err.code).toBe(code);
      expect(err.message).toBe(`test ${code}`);
      expect(err.severity).toBe('error'); // default
      expect(err.retryable).toBe(false); // default
    }
  });

  test('accepts details as Error instance (preserves for sanitize path)', () => {
    const cause = new Error('inner cause');
    const err = createError('form-tracking', FormTrackingErrorCode.CALIBRATION_FAILED, 'bad', { details: cause });
    expect(err.details).toBe(cause);
  });

  test('retryable can be overridden to true', () => {
    const err = createError('form-tracking', FormTrackingErrorCode.REP_LOG_PERSIST_FAILED, 'persist failed', {
      retryable: true,
      severity: 'warning',
    });
    expect(err.retryable).toBe(true);
    expect(err.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// mapToUserMessage: form-tracking per-code + fallback
// ---------------------------------------------------------------------------

describe('mapToUserMessage for form-tracking codes', () => {
  const cases: Array<[FormTrackingErrorCodeValue, RegExp]> = [
    [FormTrackingErrorCode.SUBJECT_NOT_HUMAN, /Tracking lost a clear view/i],
    [FormTrackingErrorCode.SUBJECT_SWITCH_DETECTED, /Another person stepped into the frame/i],
    [FormTrackingErrorCode.CALIBRATION_FAILED, /Could not calibrate/i],
    [FormTrackingErrorCode.JOINT_OCCLUSION_TIMEOUT, /Some joints were hidden/i],
    [FormTrackingErrorCode.FQI_DEGENERATE_RANGE, /Form scoring skipped a metric/i],
    [FormTrackingErrorCode.REP_LOG_PERSIST_FAILED, /rep was not saved/i],
    [FormTrackingErrorCode.CUE_PREEMPTION_FAILED, /coaching cue could not be played/i],
    [FormTrackingErrorCode.SESSION_STATE_DESYNC, /Session state got out of sync/i],
    [FormTrackingErrorCode.EXPORT_FAILED, /Export failed/i],
  ];

  test.each(cases)('maps %s to a user-facing message', (code, pattern) => {
    const err = createError('form-tracking', code, 'internal');
    expect(mapToUserMessage(err)).toMatch(pattern);
  });

  test('unmapped form-tracking code falls back to generic message', () => {
    const err = createError('form-tracking', 'SOMETHING_NOT_IN_ENUM', 'internal');
    expect(mapToUserMessage(err)).toMatch(/Form tracking ran into an issue/i);
  });

  test('every mapped code produces a non-empty distinct-from-fallback message', () => {
    const fallback = mapToUserMessage(
      createError('form-tracking', 'UNMAPPED_CODE_XYZ', 'internal')
    );
    for (const code of Object.values(FormTrackingErrorCode)) {
      const msg = mapToUserMessage(createError('form-tracking', code, 'internal'));
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toBe(fallback);
    }
  });
});

// ---------------------------------------------------------------------------
// mapToUserMessage: coach domain + rate-limit override
// ---------------------------------------------------------------------------

describe('mapToUserMessage coach + override', () => {
  test('coach domain default message', () => {
    const err = createError('coach', 'COACH_GENERIC', 'internal');
    expect(mapToUserMessage(err)).toMatch(/Coach service hit an issue/i);
  });

  test('COACH_RATE_LIMITED code overrides regardless of domain', () => {
    // Rate-limited is coded as specific regardless of domain — test both paths.
    const fromCoach = createError('coach', 'COACH_RATE_LIMITED', 'rate');
    expect(mapToUserMessage(fromCoach)).toMatch(/rate-limited/i);

    const fromUnknown = createError('unknown', 'COACH_RATE_LIMITED', 'rate');
    expect(mapToUserMessage(fromUnknown)).toMatch(/rate-limited/i);
  });
});

// ---------------------------------------------------------------------------
// shouldRetry: classification per domain
// ---------------------------------------------------------------------------

describe('shouldRetry classification', () => {
  test('explicit retryable wins over domain default (true -> true even on non-network)', () => {
    const err = createError('form-tracking', FormTrackingErrorCode.CALIBRATION_FAILED, 'x', { retryable: true });
    expect(shouldRetry(err)).toBe(true);
  });

  test('explicit retryable wins over domain default (false -> false even on network)', () => {
    const err = createError('network', 'NET', 'x', { retryable: false });
    expect(shouldRetry(err)).toBe(false);
  });

  test('when retryable is undefined, network domain retries by default', () => {
    const err: AppError = {
      domain: 'network',
      code: 'NET',
      message: 'x',
      retryable: undefined as unknown as boolean,
      severity: 'error',
    };
    expect(shouldRetry(err)).toBe(true);
  });

  test('when retryable is undefined, sync domain retries by default', () => {
    const err: AppError = {
      domain: 'sync',
      code: 'SYNC',
      message: 'x',
      retryable: undefined as unknown as boolean,
      severity: 'error',
    };
    expect(shouldRetry(err)).toBe(true);
  });

  test('non-retryable domains (form-tracking, validation, storage) do not retry by default', () => {
    for (const domain of ['form-tracking', 'validation', 'storage', 'oauth', 'session', 'camera', 'ml', 'coach', 'auth', 'unknown'] as const) {
      const err: AppError = {
        domain,
        code: 'X',
        message: 'x',
        retryable: undefined as unknown as boolean,
        severity: 'error',
      };
      expect(shouldRetry(err)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// logError: context enrichment + details sanitization
// ---------------------------------------------------------------------------

describe('logError context-tag enrichment', () => {
  beforeEach(() => {
    (errorWithTs as jest.Mock).mockClear();
  });

  test('passes context feature + location to the logger payload', () => {
    const err = createError('form-tracking', FormTrackingErrorCode.JOINT_OCCLUSION_TIMEOUT, 'x');
    logError(err, { feature: 'form-tracking', location: 'scan-arkit.tsx' });

    expect(errorWithTs).toHaveBeenCalledTimes(1);
    const [, payload] = (errorWithTs as jest.Mock).mock.calls[0];
    expect(payload.ctx).toEqual({ feature: 'form-tracking', location: 'scan-arkit.tsx' });
    expect(payload.domain).toBe('form-tracking');
    expect(payload.code).toBe(FormTrackingErrorCode.JOINT_OCCLUSION_TIMEOUT);
  });

  test('works without context (ctx undefined in payload)', () => {
    const err = createError('form-tracking', FormTrackingErrorCode.EXPORT_FAILED, 'x');
    logError(err);

    expect(errorWithTs).toHaveBeenCalledTimes(1);
    const [, payload] = (errorWithTs as jest.Mock).mock.calls[0];
    expect(payload.ctx).toBeUndefined();
  });

  test('sanitizes an Error instance in details to a plain object', () => {
    const cause = new Error('inner cause');
    const err = createError('form-tracking', FormTrackingErrorCode.CALIBRATION_FAILED, 'x', { details: cause });
    logError(err);

    expect(errorWithTs).toHaveBeenCalledTimes(1);
    const [, payload] = (errorWithTs as jest.Mock).mock.calls[0];
    expect(payload.details).toMatchObject({ name: 'Error', message: 'inner cause' });
    expect(typeof payload.details.stack).toBe('string');
  });

  test('passes through JSON-serialisable details untouched', () => {
    const details = { requestId: 'abc-123', attempts: 3 };
    const err = createError('sync', 'SYNC_RETRY', 'x', { details });
    logError(err);

    const [, payload] = (errorWithTs as jest.Mock).mock.calls[0];
    expect(payload.details).toEqual(details);
  });

  test('stringifies details that cannot be JSON-serialised (circular)', () => {
    const circular: any = { name: 'loop' };
    circular.self = circular;
    const err = createError('unknown', 'CIRC', 'x', { details: circular });
    logError(err);

    const [, payload] = (errorWithTs as jest.Mock).mock.calls[0];
    expect(typeof payload.details).toBe('string');
  });

  test('propagates severity + retryable flags to the logger', () => {
    const err = createError('form-tracking', FormTrackingErrorCode.SESSION_STATE_DESYNC, 'x', {
      severity: 'critical',
      retryable: true,
    });
    logError(err);

    const [, payload] = (errorWithTs as jest.Mock).mock.calls[0];
    expect(payload.severity).toBe('critical');
    expect(payload.retryable).toBe(true);
  });
});
