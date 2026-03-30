import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  FALLBACK_MODEL,
  type ChatMessage,
  type CoachContext,
  type OpenAIResponse,
  type RateLimitEntry,
  buildPrompt,
  checkRateLimit,
  isOpenAIResponse,
  sanitizeMessages,
  validateModel,
} from './validation';

interface RequestBody {
  messages?: ChatMessage[];
  context?: CoachContext;
}

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const configuredModel = Deno.env.get('COACH_MODEL') || FALLBACK_MODEL;
const DEFAULT_MODEL = validateModel(configuredModel);
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MAX_TOKENS = Number(Deno.env.get('COACH_MAX_TOKENS') || 320);
const TEMPERATURE = Number(Deno.env.get('COACH_TEMPERATURE') || 0.6);
const REQUEST_TIMEOUT_MS = 25_000;
const rateLimits = new Map<string, RateLimitEntry>();

if (!OPENAI_API_KEY) {
  console.warn(
    '[coach] OPENAI_API_KEY is not set; requests will be rejected until configured.'
  );
}

if (configuredModel !== DEFAULT_MODEL) {
  console.warn(
    `[coach] Invalid COACH_MODEL "${configuredModel}"; falling back to ${DEFAULT_MODEL}.`
  );
}

function badRequest(message: string, init?: ResponseInit) {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: init?.status ?? 400,
      headers: corsHeaders,
      ...init,
    },
  );
}

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: corsHeaders,
  });
}

async function generateReply(body: RequestBody) {
  if (!OPENAI_API_KEY) {
    return badRequest('Coach is not configured (missing OPENAI_API_KEY).', { status: 500 });
  }

  const userId = body.context?.profile?.id || 'anonymous';

  const rateLimit = checkRateLimit(userId, rateLimits);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }), {
      status: 429,
      headers: {
        ...corsHeaders,
        'Retry-After': String(rateLimit.retryAfter ?? 60),
      },
    });
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
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.error('[coach] OpenAI request timed out');
      return badRequest('Coach request timed out. Please try again.', { status: 504 });
    }

    console.error('[coach] OpenAI request failed', error);
    return badRequest('Coach failed to respond. Please try again.', { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[coach] OpenAI error', response.status, errorText);
    return badRequest('Coach failed to respond. Please try again.', { status: 502 });
  }

  let data: OpenAIResponse;
  try {
    const json = (await response.json()) as unknown;
    if (!isOpenAIResponse(json)) {
      console.error('[coach] Unexpected OpenAI response structure', JSON.stringify(json));
      return badRequest('Upstream returned an unexpected response format.', { status: 502 });
    }

    data = json;
  } catch (_parseErr) {
    console.error('[coach] Failed to parse OpenAI response as JSON');
    return badRequest('Upstream returned an invalid response.', { status: 502 });
  }

  const firstChoice = data.choices?.[0];

  if (!firstChoice || typeof firstChoice.message?.content !== 'string') {
    console.error('[coach] Unexpected OpenAI response structure', JSON.stringify(data));
    return badRequest('Upstream returned an unexpected response format.', { status: 502 });
  }

  const message = firstChoice.message.content.trim();

  if (!message) {
    return badRequest('Empty response from coach.', { status: 502 });
  }

  return ok({ message });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return ok({ ok: true });
  }

  try {
    const body = (await req.json()) as RequestBody;
    return await generateReply(body);
  } catch (err) {
    console.error('[coach] Request failed', err);
    return badRequest('Invalid request payload', { status: 400 });
  }
});
