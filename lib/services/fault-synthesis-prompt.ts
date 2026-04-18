/**
 * Canonical Gemma prompt surface for fault synthesis.
 *
 * Single source of truth for `SYSTEM_INSTRUCTION` and `buildFaultSynthesisUserPrompt`.
 * Both the offline evaluation script (`scripts/synthesis-report.ts`) and the
 * Supabase Edge Function (`supabase/functions/fault-synthesis/index.ts`) should
 * match the output of this module verbatim.
 *
 * The Edge Function currently keeps its own inline copy for Deno bundling
 * simplicity — keep it identical to this module and lean on
 * `tests/unit/services/fault-synthesis-prompt.test.ts` (snapshot) to catch
 * drift in the copy the script uses.
 *
 * Prompt authoring rules:
 *  - Output sections separated by blank-free newlines so token count is stable.
 *  - No variable-number tokens (timestamps, UUIDs, locales) anywhere in the
 *    prompt. Every rendering for the same input should be byte-identical.
 *  - JSON-only response contract so we can parse + validate server-side.
 */

// =============================================================================
// Shared input types — these match the runtime shapes sent by the client.
// =============================================================================

export interface FaultGlossarySnippet {
  faultId: string;
  displayName: string;
  shortExplanation: string;
  whyItMatters: string;
  fixTips: string[];
  relatedFaults: string[];
}

export interface FaultFrequencyHint {
  faultId: string;
  occurrencesInLastNSessions: number;
  sessionsSince: number;
}

export interface FaultSynthesisSetContext {
  repNumber?: number;
  setNumber?: number;
  rpe?: number;
}

// =============================================================================
// Prompt surface
// =============================================================================

export const SYSTEM_INSTRUCTION = [
  'You are a concise strength-and-form coach for Form Factor.',
  'Given a cluster of co-occurring form faults, you identify the most likely single root cause and write one user-facing sentence that collapses the cluster into a clear corrective.',
  'You receive glossary snippets for each fault. Treat them as reference only — do not quote them verbatim; synthesize.',
  'Never invent fault ids beyond those in the input.',
  'No medical advice. No mentions of AI, models, or being an assistant.',
  'Return ONLY the JSON object described in the user message — no prose, no markdown fences.',
].join(' ');

export interface BuildPromptInput {
  exerciseId: string;
  faultIds: string[];
  snippets: FaultGlossarySnippet[];
  history?: FaultFrequencyHint[];
  setContext?: FaultSynthesisSetContext;
}

export function buildFaultSynthesisUserPrompt(input: BuildPromptInput): string {
  const { exerciseId, faultIds, snippets } = input;
  const history = input.history ?? [];
  const setContext = input.setContext;

  const snippetBlock = snippets
    .map((s) => {
      const tips = s.fixTips.length ? s.fixTips.join(' | ') : '(no tips)';
      return `- ${s.faultId} (${s.displayName}): "${s.shortExplanation}" | why: ${s.whyItMatters} | fix tips: ${tips} | related: ${s.relatedFaults.join(',') || 'none'}`;
    })
    .join('\n');

  const historyBlock =
    history.length > 0
      ? history
          .map((h) => `- ${h.faultId}: seen in ${h.occurrencesInLastNSessions} recent sessions (${h.sessionsSince} ago)`)
          .join('\n')
      : '- (no recent history)';

  const contextBlock = setContext
    ? `- rep ${setContext.repNumber ?? '?'} of set ${setContext.setNumber ?? '?'}${setContext.rpe ? `, rpe ${setContext.rpe}` : ''}`
    : '- (no set context)';

  return [
    `Exercise: ${exerciseId}`,
    `Co-occurring fault ids: ${faultIds.join(', ')}`,
    'Glossary snippets:',
    snippetBlock || '- (no snippets provided)',
    'Recent history:',
    historyBlock,
    'Set context:',
    contextBlock,
    '',
    'Return a single JSON object with these keys:',
    '  "synthesizedExplanation": one user-facing sentence (<= 35 words) that explains the likely root cause and gives one corrective action. Reference fault names naturally, do not list them.',
    '  "primaryFaultId": the fault id you believe is the primary driver — must be one of the co-occurring ids above.',
    '  "rootCauseHypothesis": 1-4 words naming the underlying cause (e.g. "ankle mobility", "grip fatigue"), or null if unclear.',
    '  "confidence": a number in [0, 1] reflecting how sure you are. Use 0.5 when the cluster is ambiguous.',
    '',
    'Respond with the JSON object ONLY.',
  ].join('\n');
}
