/**
 * coach-injection-hardener
 *
 * Defense-in-depth escaper for any user-sourced string that ends up inside
 * the coach system prompt (exercise names, fault labels, rolling history
 * summaries, profile fields). This complements coach-safety.ts (PR #431):
 * where coach-safety filters harmful *output*, this module neutralises
 * adversarial *input* before it reaches the model.
 *
 * Threats addressed
 *   - Newline / CRLF splicing that tries to start a new prompt section
 *   - Backticks and angle brackets used to break out of code fences
 *   - Known prompt-break tokens (ChatML, Gemma, generic "ignore previous")
 *
 * Contract
 *   - Pure function. No I/O.
 *   - Idempotent: hardening a hardened string is a no-op.
 *   - Non-destructive for normal content: "3x8 @ 165lb" survives intact.
 */

export interface HardenOpts {
  /**
   * When true (default), rewrite known prompt-break tokens to a placeholder
   * so they can't fire even if quoted. When false, just escape structural
   * characters.
   */
  strictMode?: boolean;
  /**
   * Maximum length (characters) after hardening. Defaults to 400, enough
   * for exercise descriptions and short history summaries.
   */
  maxLength?: number;
}

export interface CoachContextLike {
  exerciseName?: string;
  faultLabel?: string;
  faultId?: string;
  historySummary?: string;
  profile?: {
    name?: string | null;
    email?: string | null;
    id?: string;
  };
  [key: string]: unknown;
}

const DEFAULT_MAX_LENGTH = 400;

/**
 * Known prompt-break tokens. Case-insensitive. We rewrite these wholesale
 * because even quoted occurrences have been observed to trip Gemma into
 * reopening its system prompt.
 */
const PROMPT_BREAK_PATTERNS: RegExp[] = [
  /\[\s*ignore\s+(?:all\s+)?(?:safety|previous|above|prior)[^\]]*\]/gi,
  /\[\s*system\s*\]/gi,
  /###\s*system\b/gi,
  /###\s*instruction\b/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|start_of_turn\|>/gi,
  /<\|end_of_turn\|>/gi,
  /<start_of_turn>/gi,
  /<end_of_turn>/gi,
  /\bBEGIN\s+SYSTEM\s+PROMPT\b/gi,
  /\bEND\s+SYSTEM\s+PROMPT\b/gi,
  /\bnow\s+ignore\s+all\s+rules\b/gi,
  /\bjailbreak\s*:/gi,
  /\bDAN\s+mode\b/gi,
];

const INJECTION_PLACEHOLDER = '[redacted]';

export function hardenAgainstInjection(
  value: string | null | undefined,
  opts: HardenOpts = {}
): string {
  if (value == null) return '';
  if (typeof value !== 'string') return '';
  const strict = opts.strictMode !== false;
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;

  let out = value;

  // 1. Normalise whitespace: CR / LF / tab → single space, collapse runs.
  out = out.replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, ' ');

  // 2. Redact known prompt-break patterns FIRST, while structural characters
  //    (backticks / angle brackets) are still present — many tokens (ChatML,
  //    Gemma, generic system markers) embed those characters and would no
  //    longer match after escaping.
  if (strict) {
    for (const pattern of PROMPT_BREAK_PATTERNS) {
      out = out.replace(pattern, INJECTION_PLACEHOLDER);
    }
  }

  // 3. Escape surviving structural characters.
  //    Backticks → curly quotes so they cannot open/close a code fence.
  //    Angle brackets → safe full-width equivalents.
  out = out
    .replace(/```/g, '\u201C\u201D\u201C') // triple backtick → three curly quotes
    .replace(/`/g, '\u2018') // single backtick → left single quote
    .replace(/</g, '\uFF1C') // < → fullwidth less-than
    .replace(/>/g, '\uFF1E'); // > → fullwidth greater-than

  // 4. Collapse repeated whitespace and trim.
  out = out.replace(/\s{2,}/g, ' ').trim();

  // 5. Cap length.
  if (out.length > maxLength) {
    out = out.slice(0, maxLength).trimEnd();
  }

  return out;
}

/**
 * Apply hardening to the fields of a coach context object that commonly get
 * interpolated into the system prompt. Unknown / non-string fields are passed
 * through unchanged.
 */
export function hardenContextFields<T extends CoachContextLike>(ctx: T): T {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const next: CoachContextLike = { ...ctx };

  if (typeof next.exerciseName === 'string') {
    next.exerciseName = hardenAgainstInjection(next.exerciseName, { maxLength: 80 });
  }
  if (typeof next.faultLabel === 'string') {
    next.faultLabel = hardenAgainstInjection(next.faultLabel, { maxLength: 80 });
  }
  if (typeof next.faultId === 'string') {
    // Fault ids are expected to be slug-ish; apply extra strict allowlist.
    next.faultId = hardenFaultId(next.faultId);
  }
  if (typeof next.historySummary === 'string') {
    next.historySummary = hardenAgainstInjection(next.historySummary, { maxLength: 400 });
  }
  if (next.profile && typeof next.profile === 'object') {
    const prof = { ...next.profile };
    if (typeof prof.name === 'string') {
      prof.name = hardenAgainstInjection(prof.name, { maxLength: 60 });
    }
    // Email: strict allowlist — drop anything non-email-ish so it cannot
    // carry prompt text.
    if (typeof prof.email === 'string') {
      prof.email = hardenEmail(prof.email);
    }
    next.profile = prof;
  }

  return next as T;
}

function hardenFaultId(raw: string): string {
  // Only letters, digits, underscore, hyphen. Anything else → drop.
  return raw.replace(/[^\w-]/g, '').slice(0, 64);
}

function hardenEmail(raw: string): string {
  const trimmed = raw.trim().slice(0, 254);
  const emailLike = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmed);
  return emailLike ? trimmed : '';
}
