import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno';

// =============================================================================
// Types
// =============================================================================

interface SetContext {
  repNumber?: number;
  setNumber?: number;
  rpe?: number;
}

interface FaultFrequencyHint {
  faultId: string;
  occurrencesInLastNSessions: number;
  sessionsSince: number;
}

interface GlossarySnippet {
  faultId: string;
  displayName: string;
  shortExplanation: string;
  whyItMatters: string;
  fixTips: string[];
  relatedFaults: string[];
}

interface RequestBody {
  exerciseId?: string;
  faultIds?: string[];
  setContext?: SetContext;
  recentHistory?: FaultFrequencyHint[];
  glossaryEntries?: GlossarySnippet[];
}

interface SynthesisResult {
  synthesizedExplanation: string;
  primaryFaultId: string | null;
  rootCauseHypothesis: string | null;
  confidence: number;
}

interface GeminiContent {
  parts?: { text?: string }[];
  role?: string;
}

interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  error?: { message?: string };
}

// =============================================================================
// Config
// =============================================================================

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_ID = (Deno.env.get('FAULT_SYNTHESIS_MODEL') || 'gemma-3-4b-it').trim();
const MAX_OUTPUT_TOKENS = Number(Deno.env.get('FAULT_SYNTHESIS_MAX_TOKENS') || 240);
const TEMPERATURE = Number(Deno.env.get('FAULT_SYNTHESIS_TEMPERATURE') || 0.4);
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_FAULTS = 8;
const MAX_HISTORY_ENTRIES = 12;
const MAX_FAULT_ID_LENGTH = 80;
const MAX_STRING_FIELD_LENGTH = 800;
const MAX_FIX_TIP_LENGTH = 320;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

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

if (!GEMINI_API_KEY) {
  console.warn(
    '[fault-synthesis] GEMINI_API_KEY is not set; requests will be rejected until configured.',
  );
}

// =============================================================================
// HTTP helpers
// =============================================================================

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: CORS_HEADERS,
  });
}

function okResponse(body: SynthesisResult): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });
}

// =============================================================================
// Sanitization — every user-supplied field is potentially prompt-injected.
// =============================================================================

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\w:-]/g, '').slice(0, MAX_FAULT_ID_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeString(value: unknown, maxLength = MAX_STRING_FIELD_LENGTH): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, maxLength).trim();
}

function sanitizeFaultIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_FAULTS) break;
    const id = sanitizeId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sanitizeSnippet(raw: unknown): GlossarySnippet | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const faultId = sanitizeId(obj.faultId);
  if (!faultId) return null;
  return {
    faultId,
    displayName: sanitizeString(obj.displayName, 120),
    shortExplanation: sanitizeString(obj.shortExplanation),
    whyItMatters: sanitizeString(obj.whyItMatters),
    fixTips: Array.isArray(obj.fixTips)
      ? obj.fixTips
          .slice(0, 4)
          .map((tip) => sanitizeString(tip, MAX_FIX_TIP_LENGTH))
          .filter((tip) => tip.length > 0)
      : [],
    relatedFaults: Array.isArray(obj.relatedFaults)
      ? (obj.relatedFaults
          .map((r) => sanitizeId(r))
          .filter((r): r is string => Boolean(r))
          .slice(0, 6))
      : [],
  };
}

function sanitizeHistory(raw: unknown): FaultFrequencyHint[] {
  if (!Array.isArray(raw)) return [];
  const out: FaultFrequencyHint[] = [];
  for (const item of raw) {
    if (out.length >= MAX_HISTORY_ENTRIES) break;
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const faultId = sanitizeId(obj.faultId);
    if (!faultId) continue;
    const occ = Number(obj.occurrencesInLastNSessions);
    const sessionsSince = Number(obj.sessionsSince);
    out.push({
      faultId,
      occurrencesInLastNSessions: Number.isFinite(occ) ? Math.max(0, Math.min(999, occ)) : 0,
      sessionsSince: Number.isFinite(sessionsSince)
        ? Math.max(0, Math.min(999, sessionsSince))
        : 0,
    });
  }
  return out;
}

function sanitizeSetContext(raw: unknown): SetContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const out: SetContext = {};
  const repNumber = Number(obj.repNumber);
  if (Number.isFinite(repNumber) && repNumber > 0) out.repNumber = Math.min(999, repNumber);
  const setNumber = Number(obj.setNumber);
  if (Number.isFinite(setNumber) && setNumber > 0) out.setNumber = Math.min(99, setNumber);
  const rpe = Number(obj.rpe);
  if (Number.isFinite(rpe) && rpe >= 1 && rpe <= 10) out.rpe = rpe;
  return Object.keys(out).length > 0 ? out : undefined;
}

// =============================================================================
// Prompt builder — imported from supabase/functions/_shared/.
// That file must remain byte-identical to lib/services/fault-synthesis-prompt.ts;
// `bun scripts/check-supabase-shared-in-sync.ts` (wired into `bun run ci:local`)
// enforces the invariant before push.
// =============================================================================

import {
  SYSTEM_INSTRUCTION,
  buildFaultSynthesisUserPrompt,
} from '../_shared/fault-synthesis-prompt.ts';

// =============================================================================
// Gemini (Gemma) call
// =============================================================================

interface GeminiRequest {
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
  };
}

async function callGemma(prompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    MODEL_ID,
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  // Gemma models on the public Gemini API reject the `systemInstruction`
  // field ("Developer instruction is not enabled for models/gemma-*").
  // Prepend it to the user prompt for portable behavior across
  // gemini-* and gemma-* targets.
  const fullUserText = `${SYSTEM_INSTRUCTION}\n\n${prompt}`;
  // Gemma models on the public API don't accept responseMimeType either
  // ("JSON mode is not enabled for models/gemma-*"). Rely on the prompt's
  // JSON-only contract and the lenient parseModelJson below.
  const body: GeminiRequest = {
    contents: [{ role: 'user', parts: [{ text: fullUserText }] }],
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    console.error('[fault-synthesis] fetch failed', { timeout: isTimeout, error: String(err) });
    return null;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const text = await response.text();
    console.error('[fault-synthesis] upstream error', response.status, text.slice(0, 500));
    return null;
  }

  let parsed: GeminiResponse;
  try {
    parsed = (await response.json()) as GeminiResponse;
  } catch {
    console.error('[fault-synthesis] invalid upstream JSON');
    return null;
  }

  if (parsed.error) {
    console.error('[fault-synthesis] model error', parsed.error.message ?? 'unknown');
    return null;
  }

  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' && text.trim().length > 0 ? text : null;
}

// =============================================================================
// Response parser + validator
// =============================================================================

function parseModelJson(raw: string): Partial<SynthesisResult> | null {
  // Strip markdown fences if the model ignores the JSON mime type hint.
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Some models prepend a conversational preamble ("Here is the JSON …")
  // before the object. Extract the outermost {…} span so JSON.parse lands.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      synthesizedExplanation:
        typeof parsed.synthesizedExplanation === 'string'
          ? parsed.synthesizedExplanation
          : undefined,
      primaryFaultId:
        typeof parsed.primaryFaultId === 'string'
          ? parsed.primaryFaultId
          : parsed.primaryFaultId === null
            ? null
            : undefined,
      rootCauseHypothesis:
        typeof parsed.rootCauseHypothesis === 'string'
          ? parsed.rootCauseHypothesis
          : parsed.rootCauseHypothesis === null
            ? null
            : undefined,
      confidence:
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? parsed.confidence
          : undefined,
    };
  } catch (err) {
    console.error('[fault-synthesis] could not parse model JSON', String(err).slice(0, 200));
    return null;
  }
}

function toValidResult(
  candidate: Partial<SynthesisResult> | null,
  allowedFaultIds: Set<string>,
): SynthesisResult | null {
  if (!candidate) return null;
  const explanation =
    typeof candidate.synthesizedExplanation === 'string'
      ? candidate.synthesizedExplanation.trim().slice(0, 320)
      : '';
  if (!explanation) return null;

  let primaryFaultId: string | null = null;
  if (typeof candidate.primaryFaultId === 'string' && allowedFaultIds.has(candidate.primaryFaultId)) {
    primaryFaultId = candidate.primaryFaultId;
  }

  const rootCauseHypothesis =
    typeof candidate.rootCauseHypothesis === 'string'
      ? candidate.rootCauseHypothesis.trim().slice(0, 80) || null
      : null;

  const rawConfidence = typeof candidate.confidence === 'number' ? candidate.confidence : 0.5;
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  return { synthesizedExplanation: explanation, primaryFaultId, rootCauseHypothesis, confidence };
}

// =============================================================================
// Entry point
// =============================================================================

async function handleSynthesis(body: RequestBody): Promise<Response> {
  const exerciseId = sanitizeId(body.exerciseId);
  if (!exerciseId) return errorResponse('exerciseId is required');

  const faultIds = sanitizeFaultIds(body.faultIds);
  if (faultIds.length === 0) return errorResponse('faultIds must be a non-empty array');

  const snippets = Array.isArray(body.glossaryEntries)
    ? (body.glossaryEntries
        .map(sanitizeSnippet)
        .filter((s): s is GlossarySnippet => Boolean(s))
        .slice(0, MAX_FAULTS))
    : [];

  const history = sanitizeHistory(body.recentHistory);
  const setContext = sanitizeSetContext(body.setContext);
  const allowedFaultIds = new Set(faultIds);

  if (!GEMINI_API_KEY) {
    return errorResponse('fault-synthesis is not configured (missing GEMINI_API_KEY)', 500);
  }

  const prompt = buildFaultSynthesisUserPrompt({
    exerciseId,
    faultIds,
    snippets,
    history,
    setContext,
  });
  const raw = await callGemma(prompt);
  if (!raw) return errorResponse('fault-synthesis upstream unavailable', 502);

  const result = toValidResult(parseModelJson(raw), allowedFaultIds);
  if (!result) return errorResponse('fault-synthesis produced an invalid response', 502);

  return okResponse(result);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Missing authorization header', 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[fault-synthesis] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return errorResponse('Server configuration error', 500);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) return errorResponse('Unauthorized', 401);

  if (isRateLimited(user.id)) {
    return errorResponse('Too many requests. Please slow down.', 429);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return errorResponse('Invalid JSON payload');
  }

  try {
    return await handleSynthesis(body);
  } catch (err) {
    console.error('[fault-synthesis] unhandled error', { userId: user.id, error: String(err) });
    return errorResponse('Internal error', 500);
  }
});
