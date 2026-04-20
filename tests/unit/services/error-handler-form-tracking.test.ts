/**
 * Coverage for the new `'form-tracking'` error domain and its structured
 * code → user-message mapping. Companion suites cover the auth/sync/etc
 * domains (none of which existed prior to this PR either, oddly enough).
 */

import {
  createError,
  mapToUserMessage,
  shouldRetry,
  withErrorHandling,
  FormTrackingErrorCode,
} from '@/lib/services/ErrorHandler';

describe('ErrorHandler — form-tracking domain', () => {
  test('createError accepts the new domain', () => {
    const err = createError(
      'form-tracking',
      FormTrackingErrorCode.SUBJECT_NOT_HUMAN,
      'Skeleton on yoga mat',
    );
    expect(err.domain).toBe('form-tracking');
    expect(err.code).toBe('SUBJECT_NOT_HUMAN');
    expect(err.severity).toBe('error');
    expect(err.retryable).toBe(false);
  });

  test('createError carries severity + retryable overrides', () => {
    const err = createError(
      'form-tracking',
      FormTrackingErrorCode.JOINT_OCCLUSION_TIMEOUT,
      'Joint hidden too long',
      { severity: 'warning', retryable: true },
    );
    expect(err.severity).toBe('warning');
    expect(err.retryable).toBe(true);
  });

  test('mapToUserMessage returns code-specific copy for each form-tracking code', () => {
    const codes = Object.values(FormTrackingErrorCode);
    for (const code of codes) {
      const msg = mapToUserMessage(
        createError('form-tracking', code, 'internal'),
      );
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      // Generic fallback should never leak when we have a known code.
      expect(msg).not.toBe('Something went wrong. Please try again.');
    }
  });

  test('mapToUserMessage falls back to a domain-default for unknown codes', () => {
    const msg = mapToUserMessage(
      createError('form-tracking', 'TOTALLY_UNKNOWN_CODE', 'internal'),
    );
    expect(msg).toContain('Form tracking');
  });

  test('SUBJECT_NOT_HUMAN message hints at camera adjustment', () => {
    const msg = mapToUserMessage(
      createError('form-tracking', FormTrackingErrorCode.SUBJECT_NOT_HUMAN, 'internal'),
    );
    expect(msg.toLowerCase()).toContain('camera');
  });

  test('SUBJECT_SWITCH_DETECTED message hints at multi-person + paused counting', () => {
    const msg = mapToUserMessage(
      createError(
        'form-tracking',
        FormTrackingErrorCode.SUBJECT_SWITCH_DETECTED,
        'internal',
      ),
    );
    expect(msg.toLowerCase()).toContain('paused');
  });

  test('CALIBRATION_FAILED message tells the user how to fix it', () => {
    const msg = mapToUserMessage(
      createError('form-tracking', FormTrackingErrorCode.CALIBRATION_FAILED, 'internal'),
    );
    expect(msg.toLowerCase()).toContain('calibrate');
  });

  test('REP_LOG_PERSIST_FAILED is retryable by default when set so', () => {
    const err = createError(
      'form-tracking',
      FormTrackingErrorCode.REP_LOG_PERSIST_FAILED,
      'Insert failed',
      { retryable: true },
    );
    expect(shouldRetry(err)).toBe(true);
  });

  test('shouldRetry honors the retryable override even for form-tracking domain', () => {
    const err = createError(
      'form-tracking',
      FormTrackingErrorCode.FQI_DEGENERATE_RANGE,
      'Bad config',
      { retryable: false },
    );
    expect(shouldRetry(err)).toBe(false);
  });
});

describe('ErrorHandler — withErrorHandling for form-tracking', () => {
  test('returns ok=true with data on success', async () => {
    const result = await withErrorHandling(
      async () => 42,
      () =>
        createError(
          'form-tracking',
          FormTrackingErrorCode.REP_LOG_PERSIST_FAILED,
          'should not be used',
        ),
      { feature: 'form-tracking', location: 'rep-logger' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(42);
  });

  test('returns ok=false with the built form-tracking error on throw', async () => {
    const result = await withErrorHandling(
      async () => {
        throw new Error('boom');
      },
      () =>
        createError(
          'form-tracking',
          FormTrackingErrorCode.SESSION_STATE_DESYNC,
          'session/rep-log mismatch',
        ),
      { feature: 'form-tracking', location: 'session-runner' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.domain).toBe('form-tracking');
      expect(result.error.code).toBe('SESSION_STATE_DESYNC');
    }
  });
});
