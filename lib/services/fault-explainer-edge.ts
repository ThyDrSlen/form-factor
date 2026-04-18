/**
 * Edge Function–backed FaultExplainer.
 *
 * Phase 0 of the Gemma runtime rollout (see docs/GEMMA_RUNTIME_DECISION.md).
 * Wraps a Supabase Edge Function that calls Vertex-hosted Gemma for
 * fault-synthesis. When the network path fails or returns an unusable
 * response, this runner falls back to the static explainer so callers
 * never see an empty chip because of a flaky network.
 */

import { supabase } from '@/lib/supabase';
import { warnWithTs } from '@/lib/logger';
import {
  staticFallbackExplainer,
  type FaultExplainer,
  type FaultGlossaryEntrySnippet,
  type FaultSynthesisInput,
  type FaultSynthesisOutput,
} from './fault-explainer';
import {
  getGlossaryEntriesByFaultId,
  getGlossaryEntry,
} from './fault-glossary-store';

interface EdgeFaultSynthesisResponse {
  synthesizedExplanation?: string;
  primaryFaultId?: string | null;
  rootCauseHypothesis?: string | null;
  confidence?: number;
  error?: string;
}

export interface EdgeFaultExplainerOptions {
  /** Override the Edge Function name. Defaults to 'fault-synthesis'. */
  functionName?: string;
  /**
   * Hard timeout for the network call in ms. When exceeded the runner
   * falls back to the static explainer rather than leaving the chip
   * stuck in `loading`. Defaults to 2500ms.
   */
  timeoutMs?: number;
}

const DEFAULT_FUNCTION_NAME = (
  process.env.EXPO_PUBLIC_FAULT_SYNTHESIS_FUNCTION || 'fault-synthesis'
).trim();
const DEFAULT_TIMEOUT_MS = 2500;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.abort();
      reject(new Error(`edge-fault-synthesis timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function collectGlossarySnippets(input: FaultSynthesisInput): FaultGlossaryEntrySnippet[] {
  const snippets: FaultGlossaryEntrySnippet[] = [];
  const seen = new Set<string>();
  for (const faultId of input.faultIds) {
    if (seen.has(faultId)) continue;
    seen.add(faultId);
    const entry =
      getGlossaryEntry(input.exerciseId, faultId) ??
      getGlossaryEntriesByFaultId(faultId)[0] ??
      null;
    if (!entry) continue;
    snippets.push({
      faultId: entry.faultId,
      displayName: entry.displayName,
      shortExplanation: entry.shortExplanation,
      whyItMatters: entry.whyItMatters,
      fixTips: entry.fixTips,
      relatedFaults: entry.relatedFaults,
    });
  }
  return snippets;
}

function isValidResponse(data: EdgeFaultSynthesisResponse | null | undefined): data is Required<
  Pick<EdgeFaultSynthesisResponse, 'synthesizedExplanation' | 'confidence'>
> & EdgeFaultSynthesisResponse {
  if (!data) return false;
  if (data.error) return false;
  if (typeof data.synthesizedExplanation !== 'string') return false;
  if (!data.synthesizedExplanation.trim()) return false;
  if (typeof data.confidence !== 'number') return false;
  if (Number.isNaN(data.confidence)) return false;
  return true;
}

export function createEdgeFaultExplainer(
  options: EdgeFaultExplainerOptions = {},
): FaultExplainer {
  const functionName = options.functionName ?? DEFAULT_FUNCTION_NAME;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async synthesize(input: FaultSynthesisInput): Promise<FaultSynthesisOutput> {
      if (input.faultIds.length === 0) {
        return staticFallbackExplainer.synthesize(input);
      }

      const controller = new AbortController();
      try {
        const glossaryEntries = collectGlossarySnippets(input);
        const invocation = supabase.functions.invoke<EdgeFaultSynthesisResponse>(
          functionName,
          { body: { ...input, glossaryEntries } },
        );
        const { data, error } = await withTimeout(invocation, timeoutMs, controller);

        if (error) {
          warnWithTs('fault-synthesis edge invoke failed', {
            message: error.message,
            faultCount: input.faultIds.length,
          });
          return staticFallbackExplainer.synthesize(input);
        }

        if (!isValidResponse(data)) {
          warnWithTs('fault-synthesis edge returned invalid payload', {
            faultCount: input.faultIds.length,
            hasError: Boolean(data?.error),
          });
          return staticFallbackExplainer.synthesize(input);
        }

        return {
          synthesizedExplanation: data.synthesizedExplanation.trim(),
          primaryFaultId: data.primaryFaultId ?? null,
          rootCauseHypothesis: data.rootCauseHypothesis ?? null,
          confidence: Math.max(0, Math.min(1, data.confidence)),
          source: 'edge-function',
        };
      } catch (err) {
        warnWithTs('fault-synthesis edge threw', {
          message: err instanceof Error ? err.message : String(err),
          faultCount: input.faultIds.length,
        });
        return staticFallbackExplainer.synthesize(input);
      }
    },
  };
}
