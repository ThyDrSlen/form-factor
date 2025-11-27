import {
  createError,
  mapToUserMessage,
  shouldRetry,
  withErrorHandling,
  type AppError,
} from '@/lib/services/ErrorHandler';

describe('ErrorHandler', () => {
  describe('createError', () => {
    it('should create an error with required fields', () => {
      const err = createError('network', 'NET_001', 'Connection failed');

      expect(err.domain).toBe('network');
      expect(err.code).toBe('NET_001');
      expect(err.message).toBe('Connection failed');
      expect(err.retryable).toBe(false); // default
      expect(err.severity).toBe('error'); // default
    });

    it('should allow overriding retryable and severity', () => {
      const err = createError('sync', 'SYNC_FAIL', 'Sync failed', {
        retryable: true,
        severity: 'warning',
      });

      expect(err.retryable).toBe(true);
      expect(err.severity).toBe('warning');
    });

    it('should attach optional details', () => {
      const details = { originalError: 'timeout' };
      const err = createError('network', 'TIMEOUT', 'Request timed out', {
        details,
      });

      expect(err.details).toEqual(details);
    });
  });

  describe('mapToUserMessage', () => {
    it('should return user-friendly message for network errors', () => {
      const err = createError('network', 'NET_001', 'internal msg');
      expect(mapToUserMessage(err)).toBe(
        'Connection issue. Please check your internet and try again.'
      );
    });

    it('should return specific message for OAUTH_CANCELLED', () => {
      const err = createError('oauth', 'OAUTH_CANCELLED', 'internal');
      expect(mapToUserMessage(err)).toBe('Sign-in was cancelled.');
    });

    it('should return specific message for OAUTH_DISMISSED', () => {
      const err = createError('oauth', 'OAUTH_DISMISSED', 'internal');
      expect(mapToUserMessage(err)).toBe('Sign-in was dismissed.');
    });

    it('should return generic oauth message for other oauth codes', () => {
      const err = createError('oauth', 'OAUTH_OTHER', 'internal');
      expect(mapToUserMessage(err)).toBe(
        'Authentication failed while contacting the provider.'
      );
    });

    it('should return fallback for unknown domain', () => {
      const err = createError('unknown', 'UNK', 'internal');
      expect(mapToUserMessage(err)).toBe('Something went wrong. Please try again.');
    });

    const domainMessages: Array<[AppError['domain'], string]> = [
      ['session', 'Your session could not be validated. Please try signing in again.'],
      ['validation', 'App configuration is incomplete. Please contact support.'],
      ['camera', 'Camera is unavailable or permission was denied.'],
      ['ml', 'Processing issue. Try again or adjust your position.'],
      ['storage', 'We had trouble saving your data. Please try again.'],
      ['sync', 'Sync issue. We will retry automatically when online.'],
      ['auth', 'Authentication error. Please try again.'],
    ];

    it.each(domainMessages)('should map %s domain correctly', (domain, expected) => {
      const err = createError(domain, 'CODE', 'internal');
      expect(mapToUserMessage(err)).toBe(expected);
    });
  });

  describe('shouldRetry', () => {
    it('should return true when retryable is explicitly true', () => {
      const err = createError('validation', 'VAL', 'msg', { retryable: true });
      expect(shouldRetry(err)).toBe(true);
    });

    it('should return false when retryable is explicitly false', () => {
      const err = createError('network', 'NET', 'msg', { retryable: false });
      expect(shouldRetry(err)).toBe(false);
    });

    it('should default to true for network domain', () => {
      const err: AppError = {
        domain: 'network',
        code: 'NET',
        message: 'msg',
        retryable: undefined as any, // simulate missing
        severity: 'error',
      };
      // Force undefined to test fallback logic
      delete (err as any).retryable;
      
      // The function checks typeof === 'boolean' first
      // If retryable is undefined, it falls back to domain check
      expect(shouldRetry({ ...err, retryable: undefined as any })).toBe(true);
    });

    it('should default to true for sync domain', () => {
      const err: AppError = {
        domain: 'sync',
        code: 'SYNC',
        message: 'msg',
        retryable: undefined as any,
        severity: 'error',
      };
      expect(shouldRetry({ ...err, retryable: undefined as any })).toBe(true);
    });
  });

  describe('withErrorHandling', () => {
    it('should return ok: true with data on success', async () => {
      const result = await withErrorHandling(
        async () => 'success',
        () => createError('unknown', 'ERR', 'Should not reach')
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('success');
      }
    });

    it('should return ok: false with error on failure', async () => {
      const result = await withErrorHandling(
        async () => {
          throw new Error('boom');
        },
        (e) =>
          createError('network', 'BOOM', (e as Error).message, {
            retryable: true,
          })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.domain).toBe('network');
        expect(result.error.code).toBe('BOOM');
        expect(result.error.message).toBe('boom');
        expect(result.error.retryable).toBe(true);
      }
    });

    it('should call buildError with the thrown exception', async () => {
      const thrownError = new Error('specific error');
      const buildError = jest.fn(() => createError('unknown', 'ERR', 'mapped'));

      await withErrorHandling(async () => {
        throw thrownError;
      }, buildError);

      expect(buildError).toHaveBeenCalledWith(thrownError);
    });
  });
});
