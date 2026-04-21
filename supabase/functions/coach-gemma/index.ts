import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno';

// -----------------------------------------------------------------------------
// NOTE on duplication: these helpers are intentionally kept in sync with the
// pure module at `./translation.ts` (imported by `bun test`). Deno edge
// functions resolve imports strictly and without an import map we cannot
// share a relative `.ts` module cleanly between Deno runtime and the Bun test
// runner. Any change here should be mirrored in `translation.ts`.
// -----------------------------------------------------------------------------

type Role = 'user' | 'assistant' | 'system';

interface TextContentPart {
  type: 'text';
  text: string;
}

interface ImageContentPart {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg';
    data: string;
  };
}

type ContentPart = TextContentPart | ImageContentPart;

interface ChatMessage {
  role: Role;
  /** Legacy text shape, or Anthropic/Gemma-style content-parts array (#495). */
  content: string | ContentPart[];
}

interface CoachContext {
  profile?: { id?: string; name?: string | null; email?: string | null };
  focus?: string;
}

interface RequestBody {
  messages?: ChatMessage[];
  context?: CoachContext;
  model?: string;
}

interface GeminiInlineData {
  mimeType: string;
  data: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
}

interface GeminiContent {
  role?: 'user' | 'model';
  parts?: GeminiPart[];
}

interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

const ALLOWED_MODELS = new Set([
  'gemma-3-4b-it',
  'gemma-3-12b-it',
  'gemma-3-27b-it',
]);
/**
 * Multimodal-capable models (#495). The vision dispatcher in
 * `lib/services/coach-vision.ts` targets `gemma-4-31b-it`. Until #485
 * extends `ALLOWED_MODELS` to include gemma-4-*, requests carrying
 * image parts against a gemma-3-* model will have the images stripped
 * server-side before they reach Gemini.
 */
const VISION_CAPABLE_MODELS = new Set([
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
]);
const MAX_IMAGES_PER_REQUEST = 1;
const FALLBACK_MODEL = 'gemma-3-4b-it';
const RAW_MODEL = (Deno.env.get('COACH_GEMMA_MODEL') || FALLBACK_MODEL).trim();
const DEFAULT_MODEL = ALLOWED_MODELS.has(RAW_MODEL) ? RAW_MODEL : FALLBACK_MODEL;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_BASE =
  Deno.env.get('GEMINI_API_BASE') ||
  'https://generativelanguage.googleapis.com/v1beta/models';

const MAX_MESSAGES = 12;
const MAX_CONTENT_LENGTH = 1200;
const MAX_TOKENS = Number(Deno.env.get('COACH_GEMMA_MAX_TOKENS') || 320);
const TEMPERATURE = Number(Deno.env.get('COACH_GEMMA_TEMPERATURE') || 0.6);
const REQUEST_TIMEOUT_MS = 30_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

if (RAW_MODEL !== DEFAULT_MODEL) {
  console.warn(
    `[coach-gemma] COACH_GEMMA_MODEL "${RAW_MODEL}" is not in allowed list, falling back to "${DEFAULT_MODEL}"`,
  );
}

if (!GEMINI_API_KEY) {
  console.warn(
    '[coach-gemma] GEMINI_API_KEY is not set; requests will be rejected until configured.',
  );
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
  };
}

function badRequest(message: string, init?: ResponseInit) {
  return new Response(JSON.stringify({ error: message }), {
    status: init?.status ?? 400,
    headers: corsHeaders(),
    ...init,
  });
}

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: corsHeaders(),
  });
}

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

function normalizeContent(content: string | ContentPart[]): string | ContentPart[] {
  if (typeof content === 'string') {
    return content.slice(0, MAX_CONTENT_LENGTH);
  }
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text.slice(0, MAX_CONTENT_LENGTH) }
      : part,
  );
}

function sanitizeMessages(messages: ChatMessage[] = []): ChatMessage[] {
  return messages
    .filter(isValidRawMessage)
    .map((m) => ({
      role: (['user', 'assistant', 'system'] as Role[]).includes(m.role as Role)
        ? (m.role as Role)
        : 'user',
      content: normalizeContent(m.content),
    }))
    .slice(-MAX_MESSAGES);
}

function countImageParts(messages: ChatMessage[]): number {
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

function stripImageParts(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      result.push(m);
      continue;
    }
    const textParts = m.content.filter(isTextPart);
    if (textParts.length === 0) continue;
    if (textParts.length === 1) {
      result.push({ role: m.role, content: textParts[0].text });
    } else {
      result.push({ role: m.role, content: textParts });
    }
  }
  return result;
}

function supportsVision(model: string): boolean {
  return VISION_CAPABLE_MODELS.has(model);
}

/** Strip control chars, prompt delimiters, and cap length to prevent injection. */
function sanitizeName(name: string): string {
  return name.replace(/[^\w\s'-]/g, '').slice(0, 100).trim();
}

function buildSystemInstruction(context?: CoachContext): string {
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

function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
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

function buildGeminiPayload(
  messages: ChatMessage[],
  context: CoachContext | undefined,
  opts: { temperature: number; maxOutputTokens: number },
) {
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

function extractGeminiText(data: GeminiResponse): string | null {
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

function resolveRequestedModel(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_MODEL;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_MODEL;
  return ALLOWED_MODELS.has(trimmed) ? trimmed : DEFAULT_MODEL;
}

async function generateReply(body: RequestBody) {
  if (!GEMINI_API_KEY) {
    return badRequest('Coach is not configured (missing GEMINI_API_KEY).', {
      status: 500,
    });
  }

  const inputMessages = sanitizeMessages(body.messages || []);
  if (inputMessages.length === 0) {
    return badRequest('messages array is required');
  }

  // #495 multimodal guard: cap image parts regardless of model. Even if the
  // eventual model is vision-capable, more than one image explodes token
  // cost without a clear coaching win.
  const imageCount = countImageParts(inputMessages);
  if (imageCount > MAX_IMAGES_PER_REQUEST) {
    return badRequest(
      `Too many images (${imageCount}). Max ${MAX_IMAGES_PER_REQUEST} per request.`,
      { status: 400 },
    );
  }

  const rawRequestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  if (rawRequestedModel && !ALLOWED_MODELS.has(rawRequestedModel)) {
    return badRequest(
      `Unsupported model "${rawRequestedModel}". Allowed: ${Array.from(ALLOWED_MODELS).join(', ')}.`,
      { status: 400 },
    );
  }

  const model = resolveRequestedModel(body.model);
  // #495 multimodal guard: strip images when the resolved model does not
  // support vision so the payload we send to Gemini is text-only. This is
  // a server-side safety net — `coach-vision.ts` already won't dispatch to
  // a non-vision model, but an older client might.
  const payloadMessages = supportsVision(model)
    ? inputMessages
    : stripImageParts(inputMessages);
  const payload = buildGeminiPayload(payloadMessages, body.context, {
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_TOKENS,
  });

  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    const isTimeout =
      fetchErr instanceof DOMException && fetchErr.name === 'AbortError';
    console.error('[coach-gemma] Gemini fetch failed', {
      timeout: isTimeout,
      error: fetchErr,
    });
    return badRequest(
      isTimeout
        ? 'Coach took too long to respond. Please try again.'
        : 'Failed to reach coach service.',
      { status: 504 },
    );
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[coach-gemma] Gemini error', response.status, errorText);
    return badRequest('Coach failed to respond. Please try again.', {
      status: 502,
    });
  }

  let data: GeminiResponse;
  try {
    data = (await response.json()) as GeminiResponse;
  } catch (_parseErr) {
    console.error('[coach-gemma] Failed to parse Gemini response as JSON');
    return badRequest('Upstream returned an invalid response.', { status: 502 });
  }

  const message = extractGeminiText(data);
  if (!message) {
    console.error(
      '[coach-gemma] Unexpected Gemini response structure',
      JSON.stringify(data).slice(0, 800),
    );
    return badRequest('Upstream returned an unexpected response format.', {
      status: 502,
    });
  }

  return ok({ message, model });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return ok({ ok: true });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return badRequest('Missing authorization header', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[coach-gemma] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return badRequest('Server configuration error', { status: 500 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return badRequest('Unauthorized', { status: 401 });
  }

  if (isRateLimited(user.id)) {
    return badRequest('Too many requests. Please wait a moment.', { status: 429 });
  }

  try {
    const body = (await req.json()) as RequestBody;
    return await generateReply(body);
  } catch (err) {
    console.error('[coach-gemma] Request failed', { userId: user.id, error: err });
    return badRequest('Invalid request payload', { status: 400 });
  }
});
