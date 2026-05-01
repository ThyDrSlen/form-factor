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
export const TOKEN_ONLY_NOTIFY_RATE_LIMIT_KEY = '__token_only_request__';

export type NotifyRateLimitEntry = {
  count: number;
  windowStart: number;
};

type NotifyRateLimitMap = Map<string, NotifyRateLimitEntry>;

const allowedNotificationDataKeySet = new Set<string>(ALLOWED_NOTIFICATION_DATA_KEYS);

type NotifyRateLimitKeyInput = {
  userIds?: unknown;
  sanitizedData?: Record<string, string>;
  tokens?: unknown;
};

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

export function deriveNotifyRateLimitKeys({
  userIds,
  sanitizedData = {},
  tokens,
}: NotifyRateLimitKeyInput): string[] {
  const validUserIds = Array.isArray(userIds)
    ? Array.from(new Set(userIds.filter((userId): userId is string => typeof userId === 'string' && userId.length > 0)))
    : [];

  if (validUserIds.length > 0) {
    return validUserIds;
  }

  if (typeof sanitizedData.userId === 'string' && sanitizedData.userId.length > 0) {
    return [sanitizedData.userId];
  }

  const hasRawTokens = Array.isArray(tokens)
    && tokens.some((token): token is string => typeof token === 'string' && token.length > 0);

  return hasRawTokens ? [TOKEN_ONLY_NOTIFY_RATE_LIMIT_KEY] : [];
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
