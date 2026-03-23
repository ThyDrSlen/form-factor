/**
 * Promptfoo custom provider — Form Factor AI Coach
 *
 * Replicates supabase/functions/coach/index.ts logic but calls OpenAI
 * directly (no Supabase dependency) so evals run in CI without Edge
 * Function credentials.
 *
 * Env vars (all optional):
 *   OPENAI_API_KEY   — required at runtime
 *   COACH_MODEL      — default "gpt-4o-mini"
 *   COACH_TEMPERATURE — default 0.6
 *   COACH_MAX_TOKENS — default 320
 */

const MAX_MESSAGES = 12;
const MAX_CONTENT_LENGTH = 1200;

// ---------------------------------------------------------------------------
// Sanitisation helpers (mirror supabase/functions/coach/index.ts:59-72)
// ---------------------------------------------------------------------------

/**
 * Filter, normalise roles, truncate content, and limit message count.
 * Replicates supabase/functions/coach/index.ts:59-67 exactly.
 */
export function sanitizeMessages(messages = []) {
  return messages
    .filter(
      (m) => m && typeof m.content === 'string' && typeof m.role === 'string',
    )
    .map((m) => ({
      role: ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'user',
      content: m.content.slice(0, MAX_CONTENT_LENGTH),
    }))
    .slice(-MAX_MESSAGES);
}

/**
 * Strip control chars, prompt delimiters, and cap length to prevent injection.
 * Replicates supabase/functions/coach/index.ts:70-72 exactly.
 */
export function sanitizeName(name) {
  return name.replace(/[^\w\s'-]/g, '').slice(0, 100).trim();
}

// ---------------------------------------------------------------------------
// System prompt builder (mirror supabase/functions/coach/index.ts:74-97)
// ---------------------------------------------------------------------------

/**
 * Build the system-prompt messages array.
 * `vars` comes from Promptfoo context.vars — expects `user_name` and `focus`.
 */
export function buildPrompt(vars = {}) {
  const focus = vars.focus || 'fitness_coach';
  const rawName = vars.user_name;
  const safeName = rawName ? sanitizeName(rawName) : '';
  const userLine = safeName
    ? `You are coaching ${safeName}.`
    : 'You are coaching the user.';

  return [
    {
      role: 'system',
      content: [
        'You are Form Factor\u2019s AI coach for strength, conditioning, mobility, and nutrition.',
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

// ---------------------------------------------------------------------------
// Promptfoo custom provider
// ---------------------------------------------------------------------------

export default class CoachProvider {
  /** Unique provider identifier for Promptfoo. */
  id() {
    return 'form-factor-coach';
  }

  /**
   * Called by Promptfoo for each test case.
   *
   * @param {string} prompt  — The rendered user message.
   * @param {object} context — Promptfoo context; `context.vars` carries
   *                           `user_name` and `focus`.
   * @returns {{ output: string, tokenUsage: { total: number, prompt: number, completion: number } }
   *          | { error: string }}
   */
  async callApi(prompt, context) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { error: 'OPENAI_API_KEY is not set' };
    }

    const model = process.env.COACH_MODEL || 'gpt-4o-mini';
    const temperature = Number(process.env.COACH_TEMPERATURE || 0.6);
    const maxTokens = Number(process.env.COACH_MAX_TOKENS || 320);

    const vars = context?.vars || {};
    const systemMessages = buildPrompt(vars);
    const allMessages = [...systemMessages, { role: 'user', content: prompt }];
    const messages = sanitizeMessages(allMessages);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        error: `OpenAI API error ${response.status}: ${errorText}`,
      };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { error: 'Failed to parse OpenAI response as JSON' };
    }

    if (
      !data ||
      !Array.isArray(data.choices) ||
      data.choices.length === 0 ||
      typeof data.choices[0]?.message?.content !== 'string'
    ) {
      return {
        error: `Unexpected OpenAI response structure: ${JSON.stringify(data)}`,
      };
    }

    const output = data.choices[0].message.content.trim();
    if (!output) {
      return { error: 'Empty response from coach' };
    }

    const usage = data.usage || {};
    return {
      output,
      tokenUsage: {
        total: usage.total_tokens || 0,
        prompt: usage.prompt_tokens || 0,
        completion: usage.completion_tokens || 0,
      },
    };
  }
}
