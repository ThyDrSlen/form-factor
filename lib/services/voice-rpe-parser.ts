/**
 * Voice RPE Parser — deterministic regex/heuristic layer for spoken RPE input.
 *
 * This is the integration surface for an on-device LLM (Gemma) runner without
 * committing to a specific runtime. Callers talk to `parseRpeUtterance()`; the
 * source field will be `'llm'` once a model runner is installed. The pluggable
 * pattern mirrors fault-explainer.ts — swap the runner at app init, keep the
 * interface stable.
 *
 * Behaviours (regex path only):
 *  - Digit and word-form numbers: "8", "eight", "rpe 7", "rpe seven"
 *  - Ambiguous range ("maybe"/"or"): pick the higher value
 *  - Out-of-range (< 1 or > 10): rpe null
 *  - Flag detection by keyword (case-insensitive)
 *  - Notes: raw text with RPE token(s) stripped and trimmed
 *  - Confidence: 0.9 clear digit | 0.7 word form | 0.5 flags only | 0.2 nothing
 *  - Source: always 'regex' from this module
 */

// =============================================================================
// Types
// =============================================================================

export type RpeFlag =
  | 'grindy'
  | 'hard'
  | 'easy'
  | 'failed'
  | 'breakdown'
  | 'quick'
  | 'paused';

export interface ParsedRpe {
  /** Extracted RPE value 1–10, or null when none could be determined. */
  rpe: number | null;
  /** Original utterance with RPE token(s) removed, trimmed. */
  notes: string;
  /** Detected quality/effort flags. */
  flags: RpeFlag[];
  /** 0–1 confidence in the parsed result. */
  confidence: number;
  /** Which runner produced this result. This module always emits 'regex'. */
  source: 'regex' | 'llm';
}

// =============================================================================
// Internals
// =============================================================================

const WORD_TO_DIGIT: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const NUMBER_WORDS = Object.keys(WORD_TO_DIGIT).join('|');

/**
 * Flag detection rules. Each entry maps one or more keyword patterns to a
 * single `RpeFlag`. Patterns are case-insensitive.
 */
const FLAG_RULES: Array<{ pattern: RegExp; flag: RpeFlag }> = [
  { pattern: /\bgrindy\b/i, flag: 'grindy' },
  { pattern: /\b(really\s+hard|brutal)\b/i, flag: 'hard' },
  { pattern: /\b(easy|cake)\b/i, flag: 'easy' },
  { pattern: /\b(failed|missed)\b/i, flag: 'failed' },
  { pattern: /\b(form\s+broke|breakdown)\b/i, flag: 'breakdown' },
  { pattern: /\b(fast|quick|snappy)\b/i, flag: 'quick' },
  { pattern: /\b(paused|stopped\s+mid)\b/i, flag: 'paused' },
];

function isInRange(n: number): boolean {
  return n >= 1 && n <= 10;
}

/**
 * Try to extract an RPE value from the utterance.
 *
 * Returns `{ rpe, confidence, stripped }` where `stripped` is the utterance
 * with the matched RPE token(s) removed so it can become `notes`.
 */
function extractRpe(text: string): {
  rpe: number | null;
  confidence: number;
  stripped: string;
} {
  // -------------------------------------------------------------------------
  // 1. "rpe <number|word>" prefix — check first so we don't accidentally
  //    treat a leftover "rpe" keyword as part of notes.
  // -------------------------------------------------------------------------
  const rpeWordPrefix = new RegExp(
    `\\brpe\\s+(${NUMBER_WORDS}|\\d+)\\b`,
    'i',
  );
  const rpeWordMatch = rpeWordPrefix.exec(text);
  if (rpeWordMatch) {
    const raw = rpeWordMatch[1]!.toLowerCase();
    const value = WORD_TO_DIGIT[raw] ?? parseInt(raw, 10);
    const stripped = text.replace(rpeWordMatch[0], '').replace(/^\s*,?\s*/, '');
    if (!isInRange(value)) {
      return { rpe: null, confidence: 0.2, stripped };
    }
    const confidence = /\d/.test(rpeWordMatch[1]!) ? 0.9 : 0.7;
    return { rpe: value, confidence, stripped };
  }

  // -------------------------------------------------------------------------
  // 2. Ambiguous range: "X maybe Y", "X or Y" — pick the higher.
  //    Supports digits and word forms.
  // -------------------------------------------------------------------------
  const numPat = `(?:\\d+|${NUMBER_WORDS})`;
  const rangeRegex = new RegExp(
    `\\b(${numPat})\\s+(?:maybe|or)\\s+(${numPat})\\b`,
    'i',
  );
  const rangeMatch = rangeRegex.exec(text);
  if (rangeMatch) {
    const a = resolveToken(rangeMatch[1]!);
    const b = resolveToken(rangeMatch[2]!);
    const higher = Math.max(a, b);
    const stripped = text.replace(rangeMatch[0], '').replace(/^\s*,?\s*/, '');
    if (!isInRange(higher)) {
      return { rpe: null, confidence: 0.2, stripped };
    }
    // Both sides resolved: if at least one side was a digit give 0.9, else 0.7
    const hasDigit =
      /\d/.test(rangeMatch[1]!) || /\d/.test(rangeMatch[2]!);
    return { rpe: higher, confidence: hasDigit ? 0.9 : 0.7, stripped };
  }

  // -------------------------------------------------------------------------
  // 3. Plain digit(s): "8", "8,", "8 felt …"
  //    Check digits before word forms so "8 felt grindy on the last three"
  //    does not accidentally resolve to the word "three".
  // -------------------------------------------------------------------------
  const digitRegex = /\b(\d+)\b/;
  const digitMatch = digitRegex.exec(text);
  if (digitMatch) {
    const value = parseInt(digitMatch[1]!, 10);
    // Remove the matched digit token and any immediately following comma
    const stripped = text.replace(digitMatch[0], '').replace(/^\s*,?\s*/, '');
    if (!isInRange(value)) {
      return { rpe: null, confidence: 0.2, stripped };
    }
    return { rpe: value, confidence: 0.9, stripped };
  }

  // -------------------------------------------------------------------------
  // 4. Plain word form: "seven", "eight"
  //    Only reached when there are no digit tokens in the utterance.
  // -------------------------------------------------------------------------
  const wordOnlyRegex = new RegExp(`\\b(${NUMBER_WORDS})\\b`, 'i');
  const wordMatch = wordOnlyRegex.exec(text);
  if (wordMatch) {
    const value = WORD_TO_DIGIT[wordMatch[1]!.toLowerCase()] ?? 0;
    const stripped = text.replace(wordMatch[0], '').replace(/^\s*,?\s*/, '');
    if (!isInRange(value)) {
      return { rpe: null, confidence: 0.2, stripped };
    }
    return { rpe: value, confidence: 0.7, stripped };
  }

  return { rpe: null, confidence: 0, stripped: text };
}

function resolveToken(token: string): number {
  const lower = token.toLowerCase();
  if (lower in WORD_TO_DIGIT) return WORD_TO_DIGIT[lower]!;
  return parseInt(token, 10);
}

function detectFlags(text: string): RpeFlag[] {
  const found: RpeFlag[] = [];
  for (const { pattern, flag } of FLAG_RULES) {
    if (pattern.test(text) && !found.includes(flag)) {
      found.push(flag);
    }
  }
  return found;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse a spoken RPE utterance into a structured `ParsedRpe` object.
 *
 * This is a pure synchronous, deterministic function. It never throws.
 * Source is always `'regex'`; the LLM path will be a separate runner that
 * satisfies the same return type.
 */
export function parseRpeUtterance(text: string): ParsedRpe {
  if (!text || !text.trim()) {
    return {
      rpe: null,
      notes: '',
      flags: [],
      confidence: 0.2,
      source: 'regex',
    };
  }

  const { rpe, confidence: rpeConfidence, stripped } = extractRpe(text);
  const flags = detectFlags(text);

  const notes = stripped.trim();

  let confidence: number;
  if (rpe !== null) {
    confidence = rpeConfidence;
  } else if (flags.length > 0) {
    confidence = 0.5;
  } else {
    confidence = 0.2;
  }

  return {
    rpe,
    notes,
    flags,
    confidence,
    source: 'regex',
  };
}
