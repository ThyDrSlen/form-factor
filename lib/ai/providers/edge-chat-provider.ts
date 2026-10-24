import { supabase } from '@/lib/supabase';
import { createError } from '@/lib/services/ErrorHandler';
import type { ModelCapability, ModelProvider, ModelRequest, ModelResult } from '../types';

/**
 * Transport for Supabase edge functions that speak the coach chat wire format:
 * request `{ messages, context, model? }`, response `{ message | content |
 * reply, model?, provider?, source?, error? }`. Every cloud backend (OpenAI,
 * Gemma, or any future model behind its own function) is one config entry.
 */
export interface EdgeChatConfig {
  id: string;
  label: string;
  /** Resolved per call so env overrides apply without a reload. */
  functionName: () => string;
  /** Error-code prefix, e.g. `COACH` → `COACH_RATE_LIMITED`. */
  errorPrefix: string;
  /** User-facing name in error copy, e.g. `Coach`, `Gemma coach`. */
  displayName: string;
  /** Upstream secret whose absence the function reports, e.g. `OPENAI_API_KEY`. */
  apiKeyName: string;
  /** Also map rate-limit text inside a 200 `{ error }` payload to `_RATE_LIMITED`. */
  rateLimitInPayload?: boolean;
  capabilities?: readonly ModelCapability[];
}

interface RawEdgeChatResponse {
  message?: string;
  content?: string;
  reply?: string;
  error?: string;
  provider?: string;
  model?: string;
  source?: 'cache' | 'local' | 'remote';
}

const RATE_LIMIT_TEXT = [/\b429\b/, /rate.?limit/i, /too many requests/i];

/**
 * Parse a `Retry-After` header value per RFC 7231 (integer seconds or an
 * HTTP-date). Returns the delay in milliseconds, or undefined.
 */
export function parseRetryAfterMs(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt >= 0 && /^\d+$/.test(raw.trim())) {
    return asInt * 1000;
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return undefined;
}

/**
 * `Retry-After` from a Supabase Functions failure: the raw Response when the
 * SDK surfaces one, else `error.context.headers`.
 */
function readRetryAfterMs(response: Response | undefined, error: unknown): number | undefined {
  const fromResponse = response?.headers?.get?.('Retry-After');
  if (fromResponse) {
    const parsed = parseRetryAfterMs(fromResponse);
    if (parsed !== undefined) return parsed;
  }
  const ctx = (error as { context?: unknown } | null | undefined)?.context;
  if (ctx && typeof ctx === 'object' && 'headers' in ctx) {
    const headers = (ctx as { headers?: { get?: (k: string) => string | null } }).headers;
    const parsed = parseRetryAfterMs(headers?.get?.('Retry-After') ?? null);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export async function invokeEdgeChat(config: EdgeChatConfig, request: ModelRequest): Promise<ModelResult> {
  const { errorPrefix: P, displayName: name, apiKeyName } = config;
  const body: Record<string, unknown> = { messages: request.messages, context: request.context };
  if (request.model) body.model = request.model;

  const { data, error, response } = await supabase.functions.invoke<RawEdgeChatResponse>(
    config.functionName(),
    { body },
  );

  if (error) {
    const errorMessage = error.message || '';
    const isConfigError = errorMessage.includes('not configured') ||
      errorMessage.includes(apiKeyName) ||
      errorMessage.includes('missing');
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status: unknown }).status
      : undefined;
    const isNotFound = status === 404 || errorMessage.includes('404');
    const isRateLimited = status === 429 || RATE_LIMIT_TEXT.some((re) => re.test(errorMessage));

    if (isNotFound) {
      throw createError('validation', `${P}_NOT_DEPLOYED`,
        `${name} service is not available. Please contact support.`,
        { details: error, retryable: false });
    }
    if (isConfigError) {
      throw createError('validation', `${P}_NOT_CONFIGURED`,
        `${name} is not configured. Please contact support.`,
        { details: error, retryable: false });
    }
    if (isRateLimited) {
      const retryAfterMs = readRetryAfterMs(response, error);
      throw createError('network', `${P}_RATE_LIMITED`,
        `${name} is rate-limited — try again in a moment.`,
        { details: retryAfterMs !== undefined ? { error, retryAfterMs } : error, retryable: true });
    }
    throw createError('network', `${P}_INVOKE_FAILED`, error.message || `${name} request failed`,
      { details: error, retryable: true });
  }

  if (data?.error) {
    const isConfigError = data.error.includes('not configured') || data.error.includes(apiKeyName);
    if (config.rateLimitInPayload && RATE_LIMIT_TEXT.some((re) => re.test(data.error!))) {
      const retryAfterMs = readRetryAfterMs(response, error);
      throw createError('network', `${P}_RATE_LIMITED`,
        `${name} is rate-limited — try again in a moment.`,
        { details: retryAfterMs !== undefined ? { error: data.error, retryAfterMs } : data.error, retryable: true });
    }
    throw createError(
      isConfigError ? 'validation' : 'network',
      isConfigError ? `${P}_NOT_CONFIGURED` : `${P}_ERROR`,
      data.error,
      { retryable: !isConfigError },
    );
  }

  const text = data?.message?.trim() || data?.content?.trim() || data?.reply?.trim();
  if (!text) {
    throw createError('validation', `${P}_EMPTY_RESPONSE`, `${name} did not return a reply`);
  }

  const model = typeof data?.model === 'string' && data.model.trim() ? data.model.trim() : undefined;
  return { text, providerId: config.id, model, source: data?.source, raw: data };
}

export interface EdgeChatHooks {
  /** Runs before every routed call, e.g. a spend cap that throws to trigger fallback. */
  beforeGenerate?: () => Promise<void>;
}

export function createEdgeChatProvider(config: EdgeChatConfig, hooks: EdgeChatHooks = {}): ModelProvider {
  return {
    id: config.id,
    label: config.label,
    kind: 'cloud',
    capabilities: config.capabilities ?? [],
    isAvailable: () => true,
    generate: async (request) => {
      await hooks.beforeGenerate?.();
      return invokeEdgeChat(config, request);
    },
  };
}
