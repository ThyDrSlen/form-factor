import {
  getFallbackCoachResponse,
  prioritizeFallbackReasons,
  type FallbackContext,
} from '@/lib/services/coach-fallback-responses';

function ctx(partial: Partial<FallbackContext>): FallbackContext {
  return { reason: 'offline', ...partial };
}

describe('getFallbackCoachResponse', () => {
  it('returns an offline message with an offline retry hint', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'offline' }));
    expect(resp.message).toContain('offline');
    expect(resp.message).toContain('sync up');
    expect(resp.severity).toBe('warning');
    expect(resp.retryable).toBe(false);
  });

  it('returns a rate-limited message at info severity', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'rate-limited' }));
    expect(resp.message.toLowerCase()).toContain('catching up');
    expect(resp.severity).toBe('info');
    expect(resp.retryable).toBe(true);
  });

  it('returns a server-error message at warning severity', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'server-error' }));
    expect(resp.message.toLowerCase()).toContain('hiccup');
    expect(resp.severity).toBe('warning');
    expect(resp.retryable).toBe(true);
  });

  it('returns a timeout message at warning severity', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'timeout' }));
    expect(resp.message.toLowerCase()).toContain('too long');
    expect(resp.severity).toBe('warning');
    expect(resp.retryable).toBe(true);
  });

  it('adds a high-FQI cue for clean reps', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'rate-limited', latestFqi: 92 }));
    expect(resp.message.toLowerCase()).toContain('clean');
  });

  it('adds a mid-FQI cue for middling reps', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'rate-limited', latestFqi: 72 }));
    expect(resp.message.toLowerCase()).toContain('tempo');
  });

  it('adds a low-FQI cue for rough reps', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'rate-limited', latestFqi: 40 }));
    expect(resp.message.toLowerCase()).toContain('reset');
  });

  it('skips fqi guidance when latestFqi is null or undefined', () => {
    const a = getFallbackCoachResponse(ctx({ reason: 'rate-limited' }));
    const b = getFallbackCoachResponse(ctx({ reason: 'rate-limited', latestFqi: null }));
    expect(a.message).not.toContain('tempo');
    expect(b.message).not.toContain('tempo');
  });

  it('skips fqi guidance when latestFqi is NaN', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'rate-limited', latestFqi: Number.NaN }));
    expect(resp.message).not.toContain('tempo');
  });

  it('surfaces a recent fault when present', () => {
    const resp = getFallbackCoachResponse(
      ctx({ reason: 'server-error', recentFaults: ['forward_knee'], exercise: 'squat' })
    );
    expect(resp.message).toContain('forward knee');
    expect(resp.message).toContain('squat');
  });

  it('humanizes camelCase fault names', () => {
    const resp = getFallbackCoachResponse(
      ctx({ reason: 'server-error', recentFaults: ['hipsRiseFirst'] })
    );
    expect(resp.message.toLowerCase()).toContain('hips rise first');
  });

  it('omits exercise reference when exercise is absent', () => {
    const resp = getFallbackCoachResponse(
      ctx({ reason: 'server-error', recentFaults: ['shallow_depth'] })
    );
    expect(resp.message.toLowerCase()).toContain('shallow depth');
    expect(resp.message.toLowerCase()).not.toContain('on undefined');
    expect(resp.message.toLowerCase()).not.toContain('on null');
  });

  it('combines fqi guidance and fault guidance when both are present', () => {
    const resp = getFallbackCoachResponse(
      ctx({ reason: 'timeout', latestFqi: 70, recentFaults: ['shallow_depth'], exercise: 'squat' })
    );
    expect(resp.message.toLowerCase()).toContain('tempo');
    expect(resp.message).toContain('shallow depth');
  });

  it('includes a retry hint for retryable reasons', () => {
    const resp = getFallbackCoachResponse(ctx({ reason: 'rate-limited' }));
    expect(resp.message).toContain('Tap the coach again');
  });
});

describe('prioritizeFallbackReasons', () => {
  it('returns null for an empty list', () => {
    expect(prioritizeFallbackReasons([])).toBeNull();
  });

  it('picks offline over all other reasons', () => {
    expect(prioritizeFallbackReasons(['rate-limited', 'offline', 'timeout'])).toBe('offline');
  });

  it('picks server-error over timeout and rate-limited', () => {
    expect(prioritizeFallbackReasons(['rate-limited', 'timeout', 'server-error'])).toBe('server-error');
  });

  it('picks timeout over rate-limited', () => {
    expect(prioritizeFallbackReasons(['rate-limited', 'timeout'])).toBe('timeout');
  });

  it('returns the only reason when just one is given', () => {
    expect(prioritizeFallbackReasons(['rate-limited'])).toBe('rate-limited');
  });
});
