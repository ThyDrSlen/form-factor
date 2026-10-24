import { createError, logError, type AppError } from '@/lib/services/ErrorHandler';

// Exercise the actual timestamp logger, including its console destination.
describe('structured diagnostic severity', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['info', 'info'],
    ['warning', 'warn'],
    ['error', 'error'],
    ['critical', 'error'],
  ] as const)('routes %s to console.%s without losing context', (severity, method) => {
    const spies = {
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
    const context = { feature: 'form-tracking' as const, location: 'form-target-resolver' };
    logError(createError('form-tracking', 'FORM_TARGET_FALLBACK_GENERIC', 'Unknown target', {
      severity: severity as AppError['severity'],
      details: { exerciseId: 'custom-exercise' },
    }), context);

    expect(spies[method]).toHaveBeenCalledTimes(1);
    expect(spies[method]).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        severity,
        code: 'FORM_TARGET_FALLBACK_GENERIC',
        details: { exerciseId: 'custom-exercise' },
        ctx: context,
      }),
    );
    for (const other of ['info', 'warn', 'error'] as const) {
      if (other !== method) expect(spies[other]).not.toHaveBeenCalled();
    }
  });
});
