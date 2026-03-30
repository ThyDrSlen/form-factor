type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface CoachContext {
  profile?: { id?: string; name?: string | null; email?: string | null };
  focus?: string;
}

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export const MAX_MESSAGES = 12;
export const MAX_CONTENT_LENGTH = 1200;
export const RATE_LIMIT_MAX_REQUESTS = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const ALLOWED_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'] as const;
export const FALLBACK_MODEL = 'gpt-4o-mini';

export function sanitizeMessages(messages: ChatMessage[] = []): ChatMessage[] {
  return messages
    .filter((message) => message && typeof message.content === 'string' && typeof message.role === 'string')
    .map((message) => ({
      role: (['user', 'assistant', 'system'] as Role[]).includes(message.role as Role)
        ? (message.role as Role)
        : 'user',
      content: message.content.slice(0, MAX_CONTENT_LENGTH),
    }))
    .slice(-MAX_MESSAGES);
}

export function sanitizeName(name: string): string {
  return name.replace(/[^\w\s'-]/g, '').slice(0, 100).trim();
}

export function buildPrompt(context?: CoachContext): ChatMessage[] {
  const focus = context?.focus || 'fitness_coach';
  const rawName = context?.profile?.name;
  const safeName = rawName ? sanitizeName(rawName) : '';
  const userLine = safeName ? `You are coaching ${safeName}.` : 'You are coaching the user.';

  return [
    {
      role: 'system',
      content: [
        'You are Form Factor’s AI coach for strength, conditioning, mobility, and nutrition.',
        userLine,
        'Stay safe: avoid medical advice, do not invent injuries, and recommend seeing a physician for pain, dizziness, or medical issues.',
        'Outputs must be concise (under ~180 words) and actionable with clear sets/reps, rest, tempo, or food swaps.',
        'Prefer simple movements with minimal equipment unless the user specifies otherwise.',
        'Offer 1-2 options max; avoid long lists.',
        'If user asks for calorie/protein guidance, give estimates and ranges, not exact prescriptions.',
        `Focus: ${focus}.`,
      ].join(' '),
    },
  ];
}

export function checkRateLimit(
  userId: string,
  limits: Map<string, RateLimitEntry>,
  now = Date.now(),
): { allowed: boolean; retryAfter?: number } {
  const entry = limits.get(userId);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    limits.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000)),
    };
  }

  limits.set(userId, { ...entry, count: entry.count + 1 });
  return { allowed: true };
}

export function validateModel(model: string): string {
  return ALLOWED_MODELS.includes(model as (typeof ALLOWED_MODELS)[number])
    ? model
    : FALLBACK_MODEL;
}

export function isOpenAIResponse(value: unknown): value is OpenAIResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const response = value as OpenAIResponse;
  return Array.isArray(response.choices);
}
