import {
  bindSessionIdToMetrics,
  extractSessionIdFromMetrics,
} from '@/lib/services/video-service';

describe('bindSessionIdToMetrics', () => {
  it('returns null when there are no metrics and no session id', () => {
    expect(bindSessionIdToMetrics(undefined, undefined)).toBeNull();
    expect(bindSessionIdToMetrics(null, null)).toBeNull();
  });

  it('returns the original metrics unchanged when no session id is provided', () => {
    const metrics = { foo: 1, bar: 'two' };
    expect(bindSessionIdToMetrics(metrics, undefined)).toBe(metrics);
  });

  it('embeds the session id without mutating the original metrics ref', () => {
    const metrics = { foo: 1 };
    const result = bindSessionIdToMetrics(metrics, 'session-42');
    expect(result).toEqual({ foo: 1, sessionId: 'session-42' });
    expect(metrics).toEqual({ foo: 1 });
  });

  it('creates a fresh metrics bag when only the session id is provided', () => {
    expect(bindSessionIdToMetrics(undefined, 'session-7')).toEqual({
      sessionId: 'session-7',
    });
  });

  it('overwrites any existing sessionId field on the metrics blob', () => {
    const metrics = { sessionId: 'stale' };
    expect(bindSessionIdToMetrics(metrics, 'fresh')).toEqual({
      sessionId: 'fresh',
    });
  });

  it('treats an empty string as no session id', () => {
    const metrics = { foo: 1 };
    expect(bindSessionIdToMetrics(metrics, '')).toBe(metrics);
  });
});

describe('extractSessionIdFromMetrics', () => {
  it('returns null when metrics are absent', () => {
    expect(extractSessionIdFromMetrics(undefined)).toBeNull();
    expect(extractSessionIdFromMetrics(null)).toBeNull();
  });

  it('returns null when the sessionId field is missing', () => {
    expect(extractSessionIdFromMetrics({ other: 1 })).toBeNull();
  });

  it('returns the stored session id when present', () => {
    expect(
      extractSessionIdFromMetrics({ sessionId: 'session-9', other: 1 }),
    ).toBe('session-9');
  });

  it('returns null when sessionId is an empty string', () => {
    expect(extractSessionIdFromMetrics({ sessionId: '' })).toBeNull();
  });

  it('returns null when sessionId is not a string', () => {
    expect(extractSessionIdFromMetrics({ sessionId: 123 as unknown })).toBeNull();
  });
});
