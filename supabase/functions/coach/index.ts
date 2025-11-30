// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type Role = 'user' | 'assistant' | 'system';

interface ChatMessage {
  role: Role;
  content: string;
}

interface CoachContext {
  profile?: { id?: string; name?: string | null; email?: string | null };
  focus?: string;
}

interface RequestBody {
  messages?: ChatMessage[];
  context?: CoachContext;
}
const DEFAULT_MODEL = Deno.env.get('COACH_MODEL') || 'gpt-4o-mini';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MAX_MESSAGES = 12;
const MAX_CONTENT_LENGTH = 1200;
const MAX_TOKENS = Number(Deno.env.get('COACH_MAX_TOKENS') || 320);
const TEMPERATURE = Number(Deno.env.get('COACH_TEMPERATURE') || 0.6);

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

function buildPrompt(context?: CoachContext) {
  const focus = context?.focus || 'fitness_coach';
  const userLine = context?.profile?.name
    ? `You are coaching ${context.profile.name}.`
    : 'You are coaching the user.';

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
    } satisfies ChatMessage,
  ];
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
    max_tokens: MAX_TOKENS,
    messages: [...buildPrompt(body.context), ...inputMessages],
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[coach] OpenAI error', response.status, errorText);
    return badRequest('Coach failed to respond. Please try again.', { status: 502 });
  }

  const data = (await response.json()) as any;
  const message = data?.choices?.[0]?.message?.content?.trim();

  if (!message) {
    return badRequest('Empty response from coach', { status: 502 });
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
