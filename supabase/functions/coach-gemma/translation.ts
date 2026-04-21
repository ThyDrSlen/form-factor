/**
 * Pure helpers for translating between the OpenAI-style chat shape we use in
 * the app and the Gemini `generateContent` request/response shape.
 *
 * These are intentionally framework-free so they can be unit-tested with Bun
 * without pulling in Deno-only imports.
 *
 * Multimodal (#495): `ChatMessage.content` now accepts either a string (the
 * legacy text shape) or an array of content parts
 *   `[{ type:'text', text } | { type:'image', source:{type:'base64',
 *     media_type:'image/jpeg', data} }]`
 * matching the Anthropic/Gemma 4 vision format. Image parts are only honored
 * when the caller-requested model is in the `gemma-4-*` allowlist; every
 * other model path strips images and keeps just the text.
 */

export type Role = 'user' | 'assistant' | 'system';

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg';
    data: string;
  };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: Role;
  /** Legacy text shape, or Anthropic/Gemma-style content-parts array. */
  content: string | ContentPart[];
}

export interface CoachContextPayload {
  profile?: { id?: string; name?: string | null; email?: string | null };
  focus?: string;
}

export interface GeminiInlineData {
  mimeType: string;
  data: string;
}

export interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
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
/**
 * Models that accept multimodal image parts. Keep this strictly disjoint
 * from `ALLOWED_MODELS` until #485 extends the allowlist — today this
 * set is empty at the allowlist layer because gemma-4-* is still gated
 * on #485. The vision dispatcher (`coach-vision.ts`) already knows to
 * route `form_vision_check` to `gemma-4-31b-it`; this set exists so the
 * server-side guard is a simple `VISION_CAPABLE_MODELS.has(model)`
 * check once the allowlist opens up.
 */
export const VISION_CAPABLE_MODELS = new Set([
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
]);
export const FALLBACK_MODEL = 'gemma-3-4b-it';
export const MAX_MESSAGES = 12;
export const MAX_CONTENT_LENGTH = 1200;
/** Server-side cap: one image per request. More would blow the token budget. */
export const MAX_IMAGES_PER_REQUEST = 1;

const VALID_ROLES: Role[] = ['user', 'assistant', 'system'];

function isTextPart(part: unknown): part is TextContentPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

function isImagePart(part: unknown): part is ImageContentPart {
  if (typeof part !== 'object' || part === null) return false;
  if ((part as { type?: unknown }).type !== 'image') return false;
  const src = (part as { source?: unknown }).source;
  if (typeof src !== 'object' || src === null) return false;
  return (
    (src as { type?: unknown }).type === 'base64' &&
    (src as { media_type?: unknown }).media_type === 'image/jpeg' &&
    typeof (src as { data?: unknown }).data === 'string'
  );
}

function isContentPartArray(content: unknown): content is ContentPart[] {
  return (
    Array.isArray(content) &&
    content.every((p) => isTextPart(p) || isImagePart(p))
  );
}

function isValidRawMessage(m: unknown): m is ChatMessage {
  if (typeof m !== 'object' || m === null) return false;
  const role = (m as { role?: unknown }).role;
  const content = (m as { content?: unknown }).content;
  if (typeof role !== 'string') return false;
  return typeof content === 'string' || isContentPartArray(content);
}

function normalizeContent(
  content: string | ContentPart[],
  maxContentLength: number,
): string | ContentPart[] {
  if (typeof content === 'string') {
    return content.slice(0, maxContentLength);
  }
  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text.slice(0, maxContentLength) };
    }
    return part;
  });
}

export function sanitizeMessages(
  messages: ChatMessage[] = [],
  opts: { maxMessages?: number; maxContentLength?: number } = {},
): ChatMessage[] {
  const maxMessages = opts.maxMessages ?? MAX_MESSAGES;
  const maxContentLength = opts.maxContentLength ?? MAX_CONTENT_LENGTH;
  return messages
    .filter(isValidRawMessage)
    .map((m) => ({
      role: VALID_ROLES.includes(m.role as Role) ? (m.role as Role) : 'user',
      content: normalizeContent(m.content, maxContentLength),
    }))
    .slice(-maxMessages);
}

/**
 * Count the number of image parts across all messages. Used by the guard
 * that rejects requests carrying more than `MAX_IMAGES_PER_REQUEST`.
 */
export function countImageParts(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (isImagePart(part)) total += 1;
      }
    }
  }
  return total;
}

/**
 * Strip image parts from every message, preserving their text content.
 * Used when the target model is NOT in `VISION_CAPABLE_MODELS` so images
 * never reach a text-only backend. If a message had only image parts
 * it is dropped entirely.
 */
export function stripImageParts(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      result.push(m);
      continue;
    }
    const textParts = m.content.filter(isTextPart);
    if (textParts.length === 0) continue; // image-only message → drop
    if (textParts.length === 1) {
      result.push({ role: m.role, content: textParts[0].text });
    } else {
      result.push({ role: m.role, content: textParts });
    }
  }
  return result;
}

/** True when the resolved model can receive image parts. */
export function supportsVision(model: string): boolean {
  return VISION_CAPABLE_MODELS.has(model);
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
function collectTextFromContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter(isTextPart)
    .map((p) => p.text)
    .join('\n');
}

function collectImageParts(
  content: string | ContentPart[],
): ImageContentPart[] {
  if (typeof content === 'string') return [];
  return content.filter(isImagePart);
}

export function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const pendingSystem: string[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      const text = collectTextFromContent(m.content).trim();
      if (text) pendingSystem.push(text);
      continue;
    }

    const role = m.role === 'assistant' ? 'model' : 'user';
    let text = collectTextFromContent(m.content);
    if (role === 'user' && pendingSystem.length > 0) {
      text = `[System]: ${pendingSystem.join('\n')}\n\n${text}`;
      pendingSystem.length = 0;
    }
    const parts: GeminiPart[] = [];
    if (text.trim() || role === 'model') {
      // Always emit a text part for user/model turns so Gemini doesn't
      // reject a turn with only inlineData.
      parts.push({ text });
    }
    for (const img of collectImageParts(m.content)) {
      parts.push({
        inlineData: {
          mimeType: img.source.media_type,
          data: img.source.data,
        },
      });
    }
    if (parts.length === 0) {
      parts.push({ text: '' });
    }
    contents.push({ role, parts });
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
