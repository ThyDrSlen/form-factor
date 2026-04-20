/**
 * Gemma JSON Response Parser
 *
 * Wrapper that enforces JSON-mode responses from the coach service (Gemma / cloud fallback).
 *
 * Responsibilities:
 *   1. Strip common markdown fences (```json ... ```) from the raw LLM response.
 *   2. Parse as JSON with forgiving recovery (extract first top-level object/array).
 *   3. Validate against a lightweight TS-only shape schema (zod-lite).
 *   4. Retry on parse/validation failure up to `maxRetries`, delegating re-prompt to the caller.
 *
 * Why not zod? The repo does not ship zod and the overnight rules forbid adding deps.
 * The local `JsonSchema<T>` primitives cover all generator shapes we need.
 */
import { createError, type AppError } from './ErrorHandler';

// =============================================================================
// Schema primitives (zod-lite, TS-only)
// =============================================================================

export type JsonSchemaIssue = { path: string; message: string };

export interface JsonSchema<T> {
  /** Human-readable name for error messages. */
  readonly name: string;
  /** Validate an arbitrary value. Returns the typed value on success or a list of issues. */
  validate(value: unknown, path?: string): { ok: true; value: T } | { ok: false; issues: JsonSchemaIssue[] };
}

function issue(path: string, message: string): JsonSchemaIssue {
  return { path: path || '$', message };
}

export const schema = {
  string(opts: { minLength?: number } = {}): JsonSchema<string> {
    return {
      name: 'string',
      validate(value, path = '') {
        if (typeof value !== 'string') return { ok: false, issues: [issue(path, `expected string, got ${typeof value}`)] };
        if (opts.minLength != null && value.length < opts.minLength) {
          return { ok: false, issues: [issue(path, `string shorter than ${opts.minLength}`)] };
        }
        return { ok: true, value };
      },
    };
  },

  number(opts: { min?: number; max?: number; integer?: boolean } = {}): JsonSchema<number> {
    return {
      name: 'number',
      validate(value, path = '') {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          return { ok: false, issues: [issue(path, `expected number, got ${typeof value}`)] };
        }
        if (opts.integer && !Number.isInteger(value)) {
          return { ok: false, issues: [issue(path, `expected integer`)] };
        }
        if (opts.min != null && value < opts.min) {
          return { ok: false, issues: [issue(path, `number < min(${opts.min})`)] };
        }
        if (opts.max != null && value > opts.max) {
          return { ok: false, issues: [issue(path, `number > max(${opts.max})`)] };
        }
        return { ok: true, value };
      },
    };
  },

  boolean(): JsonSchema<boolean> {
    return {
      name: 'boolean',
      validate(value, path = '') {
        if (typeof value !== 'boolean') return { ok: false, issues: [issue(path, `expected boolean`)] };
        return { ok: true, value };
      },
    };
  },

  literal<const L extends string | number | boolean | null>(lit: L): JsonSchema<L> {
    return {
      name: `literal(${String(lit)})`,
      validate(value, path = '') {
        if (value !== lit) return { ok: false, issues: [issue(path, `expected ${JSON.stringify(lit)}`)] };
        return { ok: true, value: lit };
      },
    };
  },

  enumOf<const U extends readonly (string | number)[]>(values: U): JsonSchema<U[number]> {
    return {
      name: `enum(${values.join('|')})`,
      validate(value, path = '') {
        if (!values.includes(value as U[number])) {
          return { ok: false, issues: [issue(path, `expected one of [${values.join(', ')}]`)] };
        }
        return { ok: true, value: value as U[number] };
      },
    };
  },

  array<T>(element: JsonSchema<T>, opts: { minLength?: number; maxLength?: number } = {}): JsonSchema<T[]> {
    return {
      name: `array<${element.name}>`,
      validate(value, path = '') {
        if (!Array.isArray(value)) return { ok: false, issues: [issue(path, `expected array`)] };
        if (opts.minLength != null && value.length < opts.minLength) {
          return { ok: false, issues: [issue(path, `array length < ${opts.minLength}`)] };
        }
        if (opts.maxLength != null && value.length > opts.maxLength) {
          return { ok: false, issues: [issue(path, `array length > ${opts.maxLength}`)] };
        }
        const out: T[] = [];
        const issues: JsonSchemaIssue[] = [];
        value.forEach((item, idx) => {
          const r = element.validate(item, `${path}[${idx}]`);
          if (r.ok) out.push(r.value);
          else issues.push(...r.issues);
        });
        if (issues.length > 0) return { ok: false, issues };
        return { ok: true, value: out };
      },
    };
  },

  object<T extends Record<string, unknown>>(
    shape: { [K in keyof T]: JsonSchema<T[K]> },
  ): JsonSchema<T> {
    return {
      name: `object{${Object.keys(shape).join(',')}}`,
      validate(value, path = '') {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
          return { ok: false, issues: [issue(path, `expected object`)] };
        }
        const issues: JsonSchemaIssue[] = [];
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(shape) as (keyof T)[]) {
          const fieldSchema = shape[key];
          const fieldPath = path ? `${path}.${String(key)}` : String(key);
          const r = fieldSchema.validate((value as Record<string, unknown>)[String(key)], fieldPath);
          if (r.ok) out[String(key)] = r.value;
          else issues.push(...r.issues);
        }
        if (issues.length > 0) return { ok: false, issues };
        return { ok: true, value: out as T };
      },
    };
  },

  optional<T>(inner: JsonSchema<T>): JsonSchema<T | undefined> {
    return {
      name: `optional<${inner.name}>`,
      validate(value, path = '') {
        if (value === undefined || value === null) return { ok: true, value: undefined };
        return inner.validate(value, path);
      },
    };
  },

  nullable<T>(inner: JsonSchema<T>): JsonSchema<T | null> {
    return {
      name: `nullable<${inner.name}>`,
      validate(value, path = '') {
        if (value === null) return { ok: true, value: null };
        return inner.validate(value, path);
      },
    };
  },
};

// =============================================================================
// Error type
// =============================================================================

export class GemmaJsonParseError extends Error {
  readonly domain = 'validation';
  readonly code: string;
  readonly rawText: string;
  readonly attempts: number;
  readonly issues?: JsonSchemaIssue[];
  readonly appError: AppError;

  constructor(
    code: 'GEMMA_JSON_SYNTAX' | 'GEMMA_JSON_SHAPE' | 'GEMMA_JSON_RETRY_EXHAUSTED',
    message: string,
    opts: {
      rawText: string;
      attempts: number;
      issues?: JsonSchemaIssue[];
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'GemmaJsonParseError';
    this.code = code;
    this.rawText = opts.rawText;
    this.attempts = opts.attempts;
    this.issues = opts.issues;
    this.appError = createError('validation', code, message, {
      details: {
        rawTextSnippet: opts.rawText.slice(0, 400),
        attempts: opts.attempts,
        issues: opts.issues,
        cause: opts.cause,
      },
      retryable: code === 'GEMMA_JSON_RETRY_EXHAUSTED',
      severity: 'warning',
    });
  }
}

// =============================================================================
// JSON fence stripping + forgiving parse
// =============================================================================

/**
 * Strip common Markdown code fences that Gemma / Gemini responses wrap JSON in.
 * Handles ```json\n...\n```, ```\n...\n```, and leading/trailing prose.
 */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();

  // Extract from fenced block if present
  const fenceMatch = s.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }

  // If the LLM prefixes / suffixes with prose, try to extract first {...} or [...] block.
  if (!(s.startsWith('{') || s.startsWith('['))) {
    const firstBrace = s.indexOf('{');
    const firstBracket = s.indexOf('[');
    const candidates = [firstBrace, firstBracket].filter((i) => i >= 0);
    if (candidates.length > 0) {
      s = s.slice(Math.min(...candidates));
    }
  }

  // Trim trailing prose by scanning for matching close of the first open.
  if (s.startsWith('{') || s.startsWith('[')) {
    const open = s[0];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          s = s.slice(0, i + 1);
          break;
        }
      }
    }
  }

  return s.trim();
}

// =============================================================================
// parseGemmaJsonResponse
// =============================================================================

export interface ParseGemmaJsonOptions {
  /** Max retries via `retry` callback. Default 0 (no retry). */
  maxRetries?: number;
  /**
   * Invoked between attempts to request a fresh response from the LLM.
   * Receives the last raw text + shape issues so the caller can re-prompt with feedback.
   * Should resolve to a new raw text string. If omitted and parse fails, throws immediately.
   */
  retry?: (ctx: { attempt: number; lastRawText: string; issues?: JsonSchemaIssue[]; lastError: Error }) => Promise<string>;
}

/**
 * Parse and validate a Gemma/cloud LLM JSON response.
 *
 * @param rawText     Raw completion text from the LLM.
 * @param shape       JSON schema to validate against.
 * @param options     maxRetries + optional retry callback.
 *
 * @throws GemmaJsonParseError on exhausted attempts.
 */
export async function parseGemmaJsonResponse<T>(
  rawText: string,
  shape: JsonSchema<T>,
  options: ParseGemmaJsonOptions = {},
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? 0);
  let currentRaw = rawText;
  let lastError: Error | null = null;
  let lastIssues: JsonSchemaIssue[] | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const stripped = stripJsonFences(currentRaw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (syntaxErr) {
      lastError = new GemmaJsonParseError(
        'GEMMA_JSON_SYNTAX',
        `JSON syntax error on attempt ${attempt + 1}: ${(syntaxErr as Error).message}`,
        { rawText: currentRaw, attempts: attempt + 1, cause: syntaxErr },
      );
      lastIssues = undefined;
      if (attempt < maxRetries && options.retry) {
        currentRaw = await options.retry({ attempt: attempt + 1, lastRawText: currentRaw, issues: undefined, lastError });
        continue;
      }
      break;
    }

    const result = shape.validate(parsed);
    if (result.ok) return result.value;

    lastIssues = result.issues;
    lastError = new GemmaJsonParseError(
      'GEMMA_JSON_SHAPE',
      `Schema validation failed on attempt ${attempt + 1} (${result.issues.length} issue(s))`,
      { rawText: currentRaw, attempts: attempt + 1, issues: result.issues },
    );

    if (attempt < maxRetries && options.retry) {
      currentRaw = await options.retry({ attempt: attempt + 1, lastRawText: currentRaw, issues: result.issues, lastError });
      continue;
    }
    break;
  }

  if (lastError instanceof GemmaJsonParseError && lastError.attempts <= maxRetries + 1 && maxRetries > 0) {
    throw new GemmaJsonParseError(
      'GEMMA_JSON_RETRY_EXHAUSTED',
      `Gemma JSON parse failed after ${maxRetries + 1} attempts`,
      { rawText: currentRaw, attempts: maxRetries + 1, issues: lastIssues, cause: lastError },
    );
  }

  throw lastError ?? new GemmaJsonParseError(
    'GEMMA_JSON_SYNTAX',
    'Unknown Gemma JSON parse error',
    { rawText: currentRaw, attempts: 1 },
  );
}
