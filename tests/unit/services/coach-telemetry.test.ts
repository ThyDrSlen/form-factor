const mockLogWithTs = jest.fn();
const mockWarnWithTs = jest.fn();
const mockErrorWithTs = jest.fn();

jest.mock('@/lib/logger', () => ({
  logWithTs: (...args: unknown[]) => mockLogWithTs(...args),
  warnWithTs: (...args: unknown[]) => mockWarnWithTs(...args),
  errorWithTs: (...args: unknown[]) => mockErrorWithTs(...args),
  infoWithTs: jest.fn(),
  logger: {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  createLogger: jest.fn(),
}));

import {
  recordCacheHit,
  recordContextTokens,
  recordFallback,
  recordInit,
  recordOOM,
  recordRolloutBucket,
  recordSafetyReject,
  recordTTFT,
  recordThermalSkip,
  recordTokPerS,
} from '@/lib/services/coach-telemetry';

function payloadFromCall(call: unknown[]): Record<string, unknown> {
  // Telemetry calls logger.logWithTs('[coach-telemetry]', payload)
  // so arg index 1 is the payload object.
  return call[1] as Record<string, unknown>;
}

describe('coach-telemetry / structured counter emission', () => {
  beforeEach(() => {
    mockLogWithTs.mockReset();
    mockWarnWithTs.mockReset();
    mockErrorWithTs.mockReset();
  });

  function expectEmit(spy: jest.Mock, event: string, value?: unknown) {
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = payloadFromCall(spy.mock.calls[0] as unknown[]);
    expect(payload.event).toBe(event);
    if (typeof value !== 'undefined') {
      expect(payload.value).toBe(value);
    }
    expect(typeof payload.ts).toBe('string');
  }

  it('recordInit emits coach.local.init.ms', () => {
    recordInit(123);
    expectEmit(mockLogWithTs, 'coach.local.init.ms', 123);
  });

  it('recordTTFT emits coach.local.ttft.ms', () => {
    recordTTFT(45);
    expectEmit(mockLogWithTs, 'coach.local.ttft.ms', 45);
  });

  it('recordTokPerS emits coach.local.tok_per_s', () => {
    recordTokPerS(18.5);
    expectEmit(mockLogWithTs, 'coach.local.tok_per_s', 18.5);
  });

  it('recordOOM emits coach.local.oom at error level', () => {
    recordOOM({ free_mb: 40 });
    expectEmit(mockErrorWithTs, 'coach.local.oom', 1);
    const payload = payloadFromCall(mockErrorWithTs.mock.calls[0] as unknown[]);
    expect(payload.free_mb).toBe(40);
  });

  it('recordThermalSkip emits coach.local.thermal_skip at warn level', () => {
    recordThermalSkip({ temp_c: 42 });
    expectEmit(mockWarnWithTs, 'coach.local.thermal_skip', 1);
  });

  it('recordCacheHit emits coach.local.cache_hit', () => {
    recordCacheHit();
    expectEmit(mockLogWithTs, 'coach.local.cache_hit', 1);
  });

  it('recordFallback emits coach.local.fallback_reason with a string value', () => {
    recordFallback('runtime_unavailable');
    expectEmit(mockLogWithTs, 'coach.local.fallback_reason', 'runtime_unavailable');
  });

  it('recordSafetyReject emits coach.local.safety_reject at warn level', () => {
    recordSafetyReject('Safety/NoPainDismissal', 'Pain dismissal');
    expectEmit(mockWarnWithTs, 'coach.local.safety_reject', 'Safety/NoPainDismissal');
    const payload = payloadFromCall(mockWarnWithTs.mock.calls[0] as unknown[]);
    expect(payload.reason).toBe('Pain dismissal');
  });

  it('recordContextTokens emits coach.local.context_tokens', () => {
    recordContextTokens(320);
    expectEmit(mockLogWithTs, 'coach.local.context_tokens', 320);
  });

  it('recordRolloutBucket emits coach.local.rollout_bucket', () => {
    recordRolloutBucket(17);
    expectEmit(mockLogWithTs, 'coach.local.rollout_bucket', 17);
  });
});
