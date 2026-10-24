import { createError } from '@/lib/services/ErrorHandler';
import { readEnabledProviderIds } from './config';
import { getProvider } from './registry';
import type { ModelCapability, ModelProvider, ModelRequest, ModelResult } from './types';

export interface RouteOptions {
  /** Provider ids to try first, in order (an explicit caller pin or a user preference). */
  prefer?: readonly (string | null | undefined)[];
  /** Capabilities every candidate must declare. `stream` is never required: it is adapted. */
  require?: readonly ModelCapability[];
  /** Try the next candidate when one fails with a retryable error. Default true. */
  fallback?: boolean;
  /** Called before each fallback hop. Telemetry only; never load-bearing. */
  onFallback?: (from: string, to: string, error: unknown) => void;
  /** Overrides `EXPO_PUBLIC_AI_PROVIDERS` (tests, previews). */
  enabled?: readonly string[];
}

/** Error codes that mean "this provider can't serve right now; another might". */
const FALLBACK_CODES = new Set(['COACH_COST_CAP_EXCEEDED', 'AI_PROVIDER_UNAVAILABLE']);

export function shouldFallBack(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, retryable } = error as { code?: string; retryable?: boolean };
  return retryable === true || (typeof code === 'string' && FALLBACK_CODES.has(code));
}

/**
 * Ordered candidates for one request: preferred ids first, then the enabled
 * order. Only enabled, registered providers with the required capabilities
 * are returned; availability is checked lazily while routing.
 */
export function candidateProviders(options: RouteOptions = {}): ModelProvider[] {
  const enabled = options.enabled ?? readEnabledProviderIds();
  const order = [...(options.prefer ?? []), ...enabled].filter((id): id is string => !!id);
  const required = (options.require ?? []).filter((capability) => capability !== 'stream');
  const seen = new Set<string>();
  const out: ModelProvider[] = [];
  for (const id of order) {
    if (seen.has(id) || !enabled.includes(id)) continue;
    seen.add(id);
    const provider = getProvider(id);
    if (provider && required.every((capability) => provider.capabilities.includes(capability))) out.push(provider);
  }
  return out;
}

async function route(
  request: ModelRequest,
  options: RouteOptions,
  run: (provider: ModelProvider) => Promise<ModelResult>,
): Promise<ModelResult> {
  const candidates = candidateProviders(options);
  const fallback = options.fallback !== false;
  let lastError: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i];
    if (!(await provider.isAvailable())) continue;
    try {
      return await run(provider);
    } catch (error) {
      lastError = error;
      const next = candidates.slice(i + 1)[0];
      if (!fallback || !next || !shouldFallBack(error) || request.signal?.aborted) throw error;
      try {
        options.onFallback?.(provider.id, next.id, error);
      } catch {
        // Telemetry must not change routing.
      }
    }
  }
  if (lastError) throw lastError;
  throw createError('validation', 'AI_PROVIDER_UNAVAILABLE', 'No AI model is available for this request.', {
    retryable: false,
    details: { enabled: options.enabled ?? readEnabledProviderIds(), require: options.require ?? [] },
  });
}

export function generate(request: ModelRequest, options: RouteOptions = {}): Promise<ModelResult> {
  return route(request, options, (provider) => provider.generate(request));
}

/**
 * Streams from providers that support it; any other provider generates the
 * full reply and delivers it as a single chunk, so callers keep one contract.
 */
export function stream(
  request: ModelRequest,
  onChunk: (delta: string) => void,
  options: RouteOptions = {},
): Promise<ModelResult> {
  return route(request, options, async (provider) => {
    if (provider.stream) return provider.stream(request, onChunk);
    const result = await provider.generate(request);
    if (result.text) onChunk(result.text);
    return result;
  });
}
