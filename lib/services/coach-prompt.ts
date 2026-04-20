/**
 * Shared system prompt and chat-template helpers for the AI coach.
 *
 * SOURCE OF TRUTH: `supabase/functions/coach/index.ts` (the cloud Edge
 * Function). The 7 clauses below are copied verbatim from `buildPrompt()`
 * there. Any drift is caught by `tests/unit/services/coach-prompt.test.ts`.
 *
 * Why duplicate instead of importing? The Edge Function runs under Deno
 * and cannot be imported by Metro/Jest; the cloud path is in a hard-banned
 * directory for on-device changes (see issue #429). The duplication is the
 * price of shipping safely — test-locked to prevent drift.
 */

export type CoachRole = 'user' | 'assistant' | 'system';

export interface CoachMessage {
  role: CoachRole;
  content: string;
}

export interface CoachPromptContext {
  profile?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  };
  focus?: string;
  /**
   * Optional free-text summary prepended to the system prompt (e.g. the
   * workout-history context enricher output). Kept as a single opaque string
   * so callers control the token budget.
   */
  historySummary?: string;
}

const MAX_MESSAGES = 12;
const MAX_CONTENT_LENGTH = 1200;

/**
 * The 7 system-prompt clauses that make up the coach's "persona + safety
 * rails". Order matters — Gemma's chat template concatenates in list order.
 *
 * IMPORTANT: If you change any of these strings, you MUST also update the
 * cloud Edge Function (`supabase/functions/coach/index.ts`) and re-run
 * `bun run eval:coach` to re-validate cloud behaviour. The test
 * `tests/unit/services/coach-prompt.test.ts` asserts this array matches
 * the cloud implementation byte-for-byte.
 */
export const SYSTEM_PROMPT_CLAUSES: readonly string[] = Object.freeze([
  'You are Form Factor\u2019s AI coach for strength, conditioning, mobility, and nutrition.',
  // Clause 2 is filled in per-call (coaching "Alice" vs "the user")
  '__USER_LINE__',
  'Stay safe: avoid medical advice, do not invent injuries, and recommend seeing a physician for pain, dizziness, or medical issues.',
  'Do not mention that you are an AI or language model.',
  'Outputs must be concise (under ~180 words) and actionable with clear sets/reps, rest, tempo, or food swaps.',
  'Prefer simple movements with minimal equipment unless the user specifies otherwise.',
  'Offer 1-2 options max; avoid long lists.',
  'If user asks for calorie/protein guidance, give estimates and ranges, not exact prescriptions.',
]);

/**
 * Strip control chars, prompt delimiters, and cap length to prevent
 * injection. Mirrors `supabase/functions/coach/index.ts sanitizeName`.
 */
export function sanitizeName(name: string): string {
  return name.replace(/[^\w\s'-]/g, '').slice(0, 100).trim();
}

/**
 * Filter, normalise roles, truncate content, and limit message count.
 * Mirrors `supabase/functions/coach/index.ts sanitizeMessages`.
 */
export function sanitizeMessages(messages: CoachMessage[] = []): CoachMessage[] {
  return messages
    .filter((m) => m && typeof m.content === 'string' && typeof m.role === 'string')
    .map((m) => ({
      role: (['user', 'assistant', 'system'] as CoachRole[]).includes(m.role as CoachRole)
        ? (m.role as CoachRole)
        : ('user' as CoachRole),
      content: m.content.slice(0, MAX_CONTENT_LENGTH),
    }))
    .slice(-MAX_MESSAGES);
}

function buildUserLine(context?: CoachPromptContext): string {
  const rawName = context?.profile?.name ?? '';
  const safeName = rawName ? sanitizeName(rawName) : '';
  return safeName
    ? `You are coaching ${safeName}.`
    : 'You are coaching the user.';
}

/**
 * Build the system-prompt messages array in cloud-identical form. Returns
 * exactly one system-role message.
 */
export function buildSystemMessages(context?: CoachPromptContext): CoachMessage[] {
  const focus = context?.focus || 'fitness_coach';
  const userLine = buildUserLine(context);

  const parts: string[] = [
    SYSTEM_PROMPT_CLAUSES[0],
    userLine,
    ...SYSTEM_PROMPT_CLAUSES.slice(2),
    `Focus: ${focus}.`,
  ];

  if (context?.historySummary) {
    // Prepend a light header so the model can see it as distinct context.
    parts.unshift(`Recent training context: ${context.historySummary}`);
  }

  return [
    {
      role: 'system',
      content: parts.join(' '),
    },
  ];
}

/**
 * Render a prompt in Gemma's chat-template format.
 *
 * Gemma IT models use the following turn-based template:
 *
 *   <start_of_turn>user\n{content}<end_of_turn>\n
 *   <start_of_turn>model\n{content}<end_of_turn>\n
 *
 * System messages are prepended to the first user turn (Gemma has no
 * dedicated system role). We keep the assistant-role turn labelled `model`
 * since that's Gemma's convention.
 */
export function renderGemmaChat(
  messages: CoachMessage[],
  context?: CoachPromptContext
): string {
  const systemMessages = buildSystemMessages(context);
  const systemBlob = systemMessages.map((m) => m.content).join('\n\n');

  const sanitized = sanitizeMessages(messages);
  if (sanitized.length === 0) {
    return `<start_of_turn>user\n${systemBlob}<end_of_turn>\n<start_of_turn>model\n`;
  }

  const out: string[] = [];
  let systemInjected = false;

  for (let i = 0; i < sanitized.length; i++) {
    const m = sanitized[i];
    const role = m.role === 'assistant' ? 'model' : m.role === 'system' ? 'user' : m.role;
    let content = m.content;

    // Prepend system context to the first user turn.
    if (!systemInjected && role === 'user') {
      content = `${systemBlob}\n\n${content}`;
      systemInjected = true;
    }

    out.push(`<start_of_turn>${role}\n${content}<end_of_turn>\n`);
  }

  // If no user turn was present (e.g. only a stray system message), inject
  // the system blob as a standalone user turn so the model has context.
  if (!systemInjected) {
    out.unshift(`<start_of_turn>user\n${systemBlob}<end_of_turn>\n`);
  }

  // End with an open `model` turn so the runtime knows to generate.
  out.push('<start_of_turn>model\n');

  return out.join('');
}
