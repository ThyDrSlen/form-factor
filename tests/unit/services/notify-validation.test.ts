import {
  checkNotifyRateLimit,
  deriveNotifyRateLimitKeys,
  MAX_NOTIFICATION_DATA_LENGTH,
  NOTIFY_RATE_LIMIT_MAX_REQUESTS,
  sanitizeNotificationData,
  TOKEN_ONLY_NOTIFY_RATE_LIMIT_KEY,
} from '@/supabase/functions/notify/validation';

describe('sanitizeNotificationData', () => {
  it('keeps only whitelisted string keys', () => {
    expect(
      sanitizeNotificationData({
        type: 'rest_timer',
        userId: 'user-123',
        unknown: 'drop-me',
        workoutId: 'workout-456',
      }),
    ).toEqual({
      type: 'rest_timer',
      userId: 'user-123',
      workoutId: 'workout-456',
    });
  });

  it('strips non-string values', () => {
    expect(
      sanitizeNotificationData({
        type: 'comment',
        postId: 123,
        exerciseId: false,
        screen: null,
      }),
    ).toEqual({ type: 'comment' });
  });

  it('truncates long string values to the maximum length', () => {
    const longValue = 'x'.repeat(MAX_NOTIFICATION_DATA_LENGTH + 10);

    expect(sanitizeNotificationData({ screen: longValue })).toEqual({
      screen: 'x'.repeat(MAX_NOTIFICATION_DATA_LENGTH),
    });
  });

  it('returns an empty object for empty input', () => {
    expect(sanitizeNotificationData({})).toEqual({});
  });
});

describe('checkNotifyRateLimit', () => {
  it('allows the first fifty requests in a minute', () => {
    const limits = new Map();
    const now = 1_000;

    for (let attempt = 1; attempt <= NOTIFY_RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
      expect(checkNotifyRateLimit('user-123', limits, now)).toEqual({ allowed: true });
    }
  });

  it('blocks the fifty-first request and returns retryAfter', () => {
    const limits = new Map();
    const windowStart = 10_000;

    for (let attempt = 1; attempt <= NOTIFY_RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
      checkNotifyRateLimit('user-123', limits, windowStart);
    }

    expect(checkNotifyRateLimit('user-123', limits, windowStart + 5_000)).toEqual({
      allowed: false,
      retryAfter: 55,
    });
  });

  it('resets the window after one minute', () => {
    const limits = new Map();
    const windowStart = 20_000;

    for (let attempt = 1; attempt <= NOTIFY_RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
      checkNotifyRateLimit('user-123', limits, windowStart);
    }

    expect(checkNotifyRateLimit('user-123', limits, windowStart + 60_000)).toEqual({
      allowed: true,
    });
  });
});

describe('deriveNotifyRateLimitKeys', () => {
  it('prefers deduped explicit userIds', () => {
    expect(
      deriveNotifyRateLimitKeys({
        userIds: ['user-123', '', 'user-123', 'user-456'],
        sanitizedData: { userId: 'fallback-user' },
        tokens: ['ExponentPushToken[token-1]'],
      }),
    ).toEqual(['user-123', 'user-456']);
  });

  it('falls back to sanitized data userId when userIds are absent', () => {
    expect(
      deriveNotifyRateLimitKeys({
        sanitizedData: { userId: 'user-789' },
        tokens: ['ExponentPushToken[token-1]'],
      }),
    ).toEqual(['user-789']);
  });

  it('returns a token-only fallback key when only raw tokens are present', () => {
    expect(
      deriveNotifyRateLimitKeys({
        userIds: [],
        sanitizedData: {},
        tokens: ['', 'ExponentPushToken[token-1]'],
      }),
    ).toEqual([TOKEN_ONLY_NOTIFY_RATE_LIMIT_KEY]);
  });
});
