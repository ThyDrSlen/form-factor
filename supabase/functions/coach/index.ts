import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno';

type Role = 'user' | 'assistant' | 'system';

interface ChatMessage {
  role: Role;
  content: string;
}

interface LiveFQI {
  rom?: number;
  symmetry?: number;
  tempo?: number;
  stability?: number;
}

interface LiveFault {
  id: string;
  count: number;
  lastRepNumber?: number;
}

interface LiveSessionSnapshot {
  exerciseId?: string;
  exerciseName?: string;
  currentFQI?: LiveFQI;
  recentFaults?: LiveFault[];
}

interface CoachContext {
  profile?: { id?: string; name?: string | null; email?: string | null };
  focus?: string;
  liveSession?: LiveSessionSnapshot;
  /**
   * Optional cross-session memory clause assembled by the client
   * (`synthesizeMemoryClause`) and re-injected here so the model sees the
   * same text whether the client prepended it to `messages` or not. The
   * value is sanitized before being embedded.
   */
  memoryClause?: string | null;
}

interface RequestBody {
  messages?: ChatMessage[];
  context?: CoachContext;
}

interface OpenAIResponse {
  choices?: { message?: { content?: string } }[];
}

const ALLOWED_MODELS = new Set([
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-5.4-mini', 'gpt-4-turbo', 'o3-mini', 'o4-mini',
]);
const RAW_MODEL = (Deno.env.get('COACH_MODEL') || 'gpt-5.4-mini').trim();
const DEFAULT_MODEL = ALLOWED_MODELS.has(RAW_MODEL) ? RAW_MODEL : 'gpt-5.4-mini';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MAX_MESSAGES = 12;
const MAX_CONTENT_LENGTH = 1200;
const MAX_TOKENS = Number(Deno.env.get('COACH_MAX_TOKENS') || 320);
const TEMPERATURE = Number(Deno.env.get('COACH_TEMPERATURE') || 0.6);
const REQUEST_TIMEOUT_MS = 30_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

// Bounded rate-limiter memory (#417 finding #6).
//
// Previously rateLimitMap grew indefinitely — entries were only evicted on
// a per-user hit after their window expired, so one-off users who never
// came back left permanent residue in memory. On a long-running Deno
// edge worker that's an unbounded leak.
//
// Policy:
//   - Run a cleanup pass every CLEANUP_EVERY_N requests.
//   - Evict entries whose windowStart is older than 2 × the limiter window
//     (guaranteed stale — `isRateLimited` would have reset them on next hit).
//   - Hard cap the map at MAX_RATE_LIMIT_ENTRIES; when reached, drop the
//     oldest entries regardless of staleness so the worker can't OOM.
const CLEANUP_EVERY_N = 500;
const STALE_AGE_MS = RATE_LIMIT_WINDOW_MS * 2;
const MAX_RATE_LIMIT_ENTRIES = 10_000;
let rateLimitCheckCount = 0;

function cleanupRateLimitMap(now: number): void {
  // Pass 1: drop stale entries.
  for (const [userId, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > STALE_AGE_MS) {
      rateLimitMap.delete(userId);
    }
  }

  // Pass 2: if still over the hard cap, evict oldest by windowStart.
  if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
    const overBy = rateLimitMap.size - MAX_RATE_LIMIT_ENTRIES;
    const sorted = Array.from(rateLimitMap.entries()).sort(
      (a, b) => a[1].windowStart - b[1].windowStart,
    );
    for (let i = 0; i < overBy && i < sorted.length; i += 1) {
      rateLimitMap.delete(sorted[i][0]);
    }
  }
}

function isRateLimited(userId: string): boolean {
  const now = Date.now();

  rateLimitCheckCount += 1;
  if (rateLimitCheckCount >= CLEANUP_EVERY_N) {
    rateLimitCheckCount = 0;
    cleanupRateLimitMap(now);
  }

  const entry = rateLimitMap.get(userId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Exported for unit tests — Deno edge entry point doesn't tree-shake named
// exports so this is safe.
export const __rateLimitInternals = {
  rateLimitMap,
  cleanupRateLimitMap,
  isRateLimited,
  MAX_RATE_LIMIT_ENTRIES,
  CLEANUP_EVERY_N,
  STALE_AGE_MS,
  resetForTests(): void {
    rateLimitMap.clear();
    rateLimitCheckCount = 0;
  },
};

if (RAW_MODEL !== DEFAULT_MODEL) {
  console.warn(`[coach] COACH_MODEL "${RAW_MODEL}" is not in allowed list, falling back to "${DEFAULT_MODEL}"`);
}

if (!OPENAI_API_KEY) {
  console.warn(
    '[coach] OPENAI_API_KEY is not set; requests will be rejected until configured.'
  );
}

function badRequest(message: string, init?: ResponseInit) {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: init?.status ?? 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
      ...init,
    },
  );
}

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function sanitizeMessages(messages: ChatMessage[] = []): ChatMessage[] {
  return messages
    .filter((m) => m && typeof m.content === 'string' && typeof m.role === 'string')
    .map((m) => ({
      role: (['user', 'assistant', 'system'] as Role[]).includes(m.role as Role) ? (m.role as Role) : 'user',
      content: m.content.slice(0, MAX_CONTENT_LENGTH),
    }))
    .slice(-MAX_MESSAGES);
}

/** Strip control chars, prompt delimiters, and cap length to prevent injection. */
function sanitizeName(name: string): string {
  return name.replace(/[^\w\s'-]/g, '').slice(0, 100).trim();
}

/** Cap memory clause length — the client already synthesizes <= 5 sentences. */
const MAX_MEMORY_CLAUSE_LEN = 600;

function sanitizeMemoryClause(clause: string): string {
  // Reuse the `sanitizeName` character whitelist but widen punctuation to
  // cover normal prose (commas, periods, slashes, digits, colons, parens).
  const permissive = clause.replace(/[^\w\s'.,:;/()\-+%]/g, '');
  return permissive.slice(0, MAX_MEMORY_CLAUSE_LEN).trim();
}

function formatFQIScore(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

/** Mirror of lib/services/coach-live-snapshot.ts#summarizeForPrompt for edge use. */
function summarizeLiveSession(snap?: LiveSessionSnapshot): string {
  if (!snap) return '';

  const parts: string[] = [];
  const rawName = snap.exerciseName || snap.exerciseId;
  if (rawName) {
    // Reuse sanitizeName to strip any prompt-injection characters from exercise label.
    parts.push(`exercise=${sanitizeName(rawName)}`);
  }

  if (snap.currentFQI) {
    const fqiParts: string[] = [];
    const rom = formatFQIScore(snap.currentFQI.rom);
    const sym = formatFQIScore(snap.currentFQI.symmetry);
    const tempo = formatFQIScore(snap.currentFQI.tempo);
    const stab = formatFQIScore(snap.currentFQI.stability);
    if (rom !== null) fqiParts.push(`rom=${rom}`);
    if (sym !== null) fqiParts.push(`symmetry=${sym}`);
    if (tempo !== null) fqiParts.push(`tempo=${tempo}`);
    if (stab !== null) fqiParts.push(`stability=${stab}`);
    if (fqiParts.length > 0) parts.push(`FQI(${fqiParts.join(', ')})`);
  }

  if (Array.isArray(snap.recentFaults) && snap.recentFaults.length > 0) {
    const capped = snap.recentFaults
      .filter((f) => f && typeof f.id === 'string' && typeof f.count === 'number' && f.count > 0)
      .slice(0, 3);
    if (capped.length > 0) {
      const faultStr = capped
        .map((f) =>
          typeof f.lastRepNumber === 'number'
            ? `${sanitizeName(f.id)}×${f.count}@rep${f.lastRepNumber}`
            : `${sanitizeName(f.id)}×${f.count}`,
        )
        .join(', ');
      parts.push(`recent faults: ${faultStr}`);
    }
  }

  return parts.join('; ');
}

function buildPrompt(context?: CoachContext) {
  const focus = context?.focus || 'fitness_coach';
  const rawName = context?.profile?.name;
  const safeName = rawName ? sanitizeName(rawName) : '';
  const userLine = safeName
    ? `You are coaching ${safeName}.`
    : 'You are coaching the user.';

  const systemLines: string[] = [
    'You are Form Factor’s AI coach for strength, conditioning, mobility, and nutrition.',
    userLine,
    'Stay safe: avoid medical advice, do not invent injuries, and recommend seeing a physician for pain, dizziness, or medical issues.',
    'Do not mention that you are an AI or language model.',
    'Outputs must be concise (under ~180 words) and actionable with clear sets/reps, rest, tempo, or food swaps.',
    'Prefer simple movements with minimal equipment unless the user specifies otherwise.',
    'Offer 1-2 options max; avoid long lists.',
    'If user asks for calorie/protein guidance, give estimates and ranges, not exact prescriptions.',
    `Focus: ${focus}.`,
  ];

  if (context?.liveSession) {
    const liveSummary = summarizeLiveSession(context.liveSession);
    if (liveSummary) {
      systemLines.push(`Live session context: ${liveSummary}.`);
    }
  }

  const baseSystem: ChatMessage = {
    role: 'system',
    content: systemLines.join(' '),
  };

  // Additive memory-clause injection: when the client supplies a prior-session
  // memory clause, surface it as a separate system message AFTER the base
  // prompt (and after any liveSession summary already embedded above). The
  // clause is sanitized to prevent prompt injection. Keeping it in a second
  // message means the model sees it as background rather than mixed in with
  // safety rules.
  const rawMemory = typeof context?.memoryClause === 'string' ? context.memoryClause : '';
  if (rawMemory) {
    const safeMemory = sanitizeMemoryClause(rawMemory);
    if (safeMemory.length > 0) {
      const memorySystem: ChatMessage = {
        role: 'system',
        content: `Prior-session memory (use as background only, do not quote verbatim): ${safeMemory}`,
      };
      return [baseSystem, memorySystem];
    }
  }

  return [baseSystem];
}

async function generateReply(body: RequestBody) {
  if (!OPENAI_API_KEY) {
    return badRequest('Coach is not configured (missing OPENAI_API_KEY).', { status: 500 });
  }

  const inputMessages = sanitizeMessages(body.messages || []);
  if (inputMessages.length === 0) {
    return badRequest('messages array is required');
  }

  const payload = {
    model: DEFAULT_MODEL,
    temperature: TEMPERATURE,
    max_completion_tokens: MAX_TOKENS,
    messages: [...buildPrompt(body.context), ...inputMessages],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    const isTimeout = fetchErr instanceof DOMException && fetchErr.name === 'AbortError';
    console.error('[coach] OpenAI fetch failed', { timeout: isTimeout, error: fetchErr });
    return badRequest(
      isTimeout ? 'Coach took too long to respond. Please try again.' : 'Failed to reach coach service.',
      { status: 504 },
    );
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[coach] OpenAI error', response.status, errorText);
    return badRequest('Coach failed to respond. Please try again.', { status: 502 });
  }

  let data: OpenAIResponse;
  try {
    data = (await response.json()) as OpenAIResponse;
  } catch (_parseErr) {
    console.error('[coach] Failed to parse OpenAI response as JSON');
    return badRequest('Upstream returned an invalid response.', { status: 502 });
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string') {
    console.error('[coach] Unexpected OpenAI response structure', JSON.stringify(data));
    return badRequest('Upstream returned an unexpected response format.', { status: 502 });
  }

  const message = rawContent.trim();

  if (!message) {
    return badRequest('Empty response from coach.', { status: 502 });
  }

  return ok({ message });
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
    console.error('[coach] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return badRequest('Server configuration error', { status: 500 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
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
    console.error('[coach] Request failed', { userId: user.id, error: err });
    return badRequest('Invalid request payload', { status: 400 });
  }
});
