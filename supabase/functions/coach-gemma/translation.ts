/**
 * Pure helpers for translating between the OpenAI-style chat shape we use in
 * the app and the Gemini `generateContent` request/response shape.
 *
 * These are intentionally framework-free so they can be unit-tested with Bun
 * without pulling in Deno-only imports.
 */

export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface CoachContextPayload {
  profile?: { id?: string; name?: string | null; email?: string | null };
  focus?: string;
}

export interface GeminiPart {
  text?: string;
}

export interface GeminiContent {
  role?: 'user' | 'model';
  parts?: GeminiPart[];
}

export interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

export interface GeminiPayload {
  contents: GeminiContent[];
  systemInstruction: { parts: GeminiPart[] };
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
  };
}

export const ALLOWED_MODELS = new Set([
  'gemma-3-4b-it',
  'gemma-3-12b-it',
  'gemma-3-27b-it',
]);
export const FALLBACK_MODEL = 'gemma-3-4b-it';
export const MAX_MESSAGES = 12;
export const MAX_CONTENT_LENGTH = 1200;

const VALID_ROLES: Role[] = ['user', 'assistant', 'system'];

export function sanitizeMessages(
  messages: ChatMessage[] = [],
  opts: { maxMessages?: number; maxContentLength?: number } = {},
): ChatMessage[] {
  const maxMessages = opts.maxMessages ?? MAX_MESSAGES;
  const maxContentLength = opts.maxContentLength ?? MAX_CONTENT_LENGTH;
  return messages
    .filter(
      (m) =>
        m && typeof m.content === 'string' && typeof m.role === 'string',
    )
    .map((m) => ({
      role: VALID_ROLES.includes(m.role as Role) ? (m.role as Role) : 'user',
      content: m.content.slice(0, maxContentLength),
    }))
    .slice(-maxMessages);
}

/** Strip control chars, prompt delimiters, and cap length to prevent injection. */
export function sanitizeName(name: string): string {
  return name.replace(/[^\w\s'-]/g, '').slice(0, 100).trim();
}

export function buildSystemInstruction(context?: CoachContextPayload): string {
  const focus = context?.focus || 'fitness_coach';
  const rawName = context?.profile?.name;
  const safeName = rawName ? sanitizeName(rawName) : '';
  const userLine = safeName
    ? `You are coaching ${safeName}.`
    : 'You are coaching the user.';

  return [
    'You are Form Factor’s AI coach for strength, conditioning, mobility, and nutrition.',
    userLine,
    'Stay safe: avoid medical advice, do not invent injuries, and recommend seeing a physician for pain, dizziness, or medical issues.',
    'Do not mention that you are an AI or language model.',
    'Outputs must be concise (under ~180 words) and actionable with clear sets/reps, rest, tempo, or food swaps.',
    'Prefer simple movements with minimal equipment unless the user specifies otherwise.',
    'Offer 1-2 options max; avoid long lists.',
    'If user asks for calorie/protein guidance, give estimates and ranges, not exact prescriptions.',
    `Focus: ${focus}.`,
  ].join(' ');
}

/**
 * Translate OpenAI-style chat messages into Gemini's `contents` shape.
 *
 * Gemini uses `role: 'user' | 'model'`. We collapse `assistant` -> `model`, and
 * merge any `system` messages into the next user turn with a `[System]:`
 * prefix. This is the safe cross-model default — Gemma instruct via Gemini
 * does accept `systemInstruction`, but inlining is a resilient fallback if a
 * particular model variant rejects it.
 */
export function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const pendingSystem: string[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content.trim()) pendingSystem.push(m.content.trim());
      continue;
    }

    const role = m.role === 'assistant' ? 'model' : 'user';
    let text = m.content;
    if (role === 'user' && pendingSystem.length > 0) {
      text = `[System]: ${pendingSystem.join('\n')}\n\n${text}`;
      pendingSystem.length = 0;
    }
    contents.push({ role, parts: [{ text }] });
  }

  if (pendingSystem.length > 0) {
    contents.push({
      role: 'user',
      parts: [{ text: `[System]: ${pendingSystem.join('\n')}` }],
    });
  }

  return contents;
}

export function buildGeminiPayload(
  messages: ChatMessage[],
  context: CoachContextPayload | undefined,
  opts: { temperature: number; maxOutputTokens: number },
): GeminiPayload {
  return {
    contents: toGeminiContents(messages),
    systemInstruction: {
      parts: [{ text: buildSystemInstruction(context) }],
    },
    generationConfig: {
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
    },
  };
}

export function extractGeminiText(data: GeminiResponse): string | null {
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) return null;

  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  const joined = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();

  return joined || null;
}

export function resolveModel(raw: unknown, fallback: string = FALLBACK_MODEL): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return ALLOWED_MODELS.has(trimmed) ? trimmed : fallback;
}

export function isAllowedModel(raw: unknown): raw is string {
  return typeof raw === 'string' && ALLOWED_MODELS.has(raw.trim());
}

export function buildGeminiUrl(base: string, model: string, apiKey: string): string {
  return `${base}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}
