export const ALLOWED_NOTIFICATION_DATA_KEYS = [
  'type',
  'postId',
  'userId',
  'workoutId',
  'exerciseId',
  'screen',
] as const;

export const MAX_NOTIFICATION_DATA_LENGTH = 255;
export const NOTIFY_RATE_LIMIT_MAX_REQUESTS = 50;
export const NOTIFY_RATE_LIMIT_WINDOW_MS = 60_000;

export type NotifyRateLimitEntry = {
  count: number;
  windowStart: number;
};

type NotifyRateLimitMap = Map<string, NotifyRateLimitEntry>;

const allowedNotificationDataKeySet = new Set<string>(ALLOWED_NOTIFICATION_DATA_KEYS);

export function sanitizeNotificationData(
  data: Record<string, unknown> = {},
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedNotificationDataKeySet.has(key) || typeof value !== 'string') {
      continue;
    }

    sanitized[key] = value.slice(0, MAX_NOTIFICATION_DATA_LENGTH);
  }

  return sanitized;
}

export function checkNotifyRateLimit(
  userId: string,
  limits: NotifyRateLimitMap,
  now = Date.now(),
): { allowed: boolean; retryAfter?: number } {
  const existingLimit = limits.get(userId);

  if (!existingLimit || now - existingLimit.windowStart >= NOTIFY_RATE_LIMIT_WINDOW_MS) {
    limits.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (existingLimit.count >= NOTIFY_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterMs = existingLimit.windowStart + NOTIFY_RATE_LIMIT_WINDOW_MS - now;
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  limits.set(userId, {
    count: existingLimit.count + 1,
    windowStart: existingLimit.windowStart,
  });

  return { allowed: true };
}
