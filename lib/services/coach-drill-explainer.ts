import { sendCoachPrompt } from '@/lib/services/coach-service';
import type { CoachMessage } from '@/lib/services/coach-service';
import type { CoachProvider } from '@/lib/services/coach-provider-types';
import { isCoachPipelineV2Enabled } from '@/lib/services/coach-pipeline-v2-flag';
import { isDispatchEnabled } from '@/lib/services/coach-model-dispatch-flag';

export type DrillExplainerProvider = 'cloud' | 'gemma' | 'openai';

/**
 * Narrow the coach service's CoachProvider tag into the drill-explainer's
 * three-way enum so callers see the actual producer (not the env-resolved
 * default). Unknown / cache / local-fallback collapse to 'cloud' so existing
 * UI branches that only handle the three primary values keep working.
 */
function mapToDrillProvider(cp: CoachProvider | undefined): DrillExplainerProvider | null {
  if (!cp) return null;
  if (cp === 'openai') return 'openai';
  if (cp === 'gemma-cloud' || cp === 'gemma-on-device') return 'gemma';
  return 'cloud';
}

/**
 * Pipeline-v2 provider resolution. Reads `EXPO_PUBLIC_COACH_CLOUD_PROVIDER`
 * mirroring `coach-auto-debrief.resolveCloudProvider`. Returns 'openai' when
 * unset or unrecognised.
 */
function resolveDrillProvider(): 'gemma' | 'openai' {
  const raw = (process.env.EXPO_PUBLIC_COACH_CLOUD_PROVIDER ?? 'openai')
    .trim()
    .toLowerCase();
  if (raw === 'gemma') return 'gemma';
  return 'openai';
}

export interface DrillFaultInput {
  code: string;
  displayName?: string;
  count: number;
  severity: 1 | 2 | 3;
}

export interface ExplainDrillInput {
  drillTitle: string;
  drillCategory: string;
  drillWhy: string;
  exerciseId: string;
  faults: DrillFaultInput[];
  userName?: string;
}

export interface ExplainDrillResult {
  explanation: string;
  provider: DrillExplainerProvider;
  error?: string;
}

const SYSTEM_PROMPT =
  "You're a strength coach. Given a drill and the form faults it targets, explain in 40-70 words why this drill helps THIS lifter RIGHT NOW. Reference their specific faults (by displayName when provided). Keep it direct, second-person, no hype. No markdown, no lists.";

function summarizeFaults(faults: DrillFaultInput[]): string {
  if (faults.length === 0) return 'no specific faults detected this session';
  return faults
    .map((f) => {
      const name = f.displayName ?? f.code.replace(/_/g, ' ');
      const severity = f.severity === 3 ? 'major' : f.severity === 2 ? 'moderate' : 'minor';
      return `${f.count}× ${severity} ${name}`;
    })
    .join(', ');
}

export function buildDrillExplainerMessages(input: ExplainDrillInput): CoachMessage[] {
  const faultLine = summarizeFaults(input.faults);
  const user =
    `Exercise: ${input.exerciseId}\n` +
    `Drill: ${input.drillTitle} (${input.drillCategory})\n` +
    `Stated rationale: ${input.drillWhy}\n` +
    `Faults this session: ${faultLine}` +
    (input.userName ? `\nLifter name: ${input.userName}` : '');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/**
 * Routes through the coach Edge Function with `focus: 'drill-explainer'`.
 *
 * Pipeline-v2: when the master flag is on, resolve the provider via
 * `EXPO_PUBLIC_COACH_CLOUD_PROVIDER` (mirroring `coach-auto-debrief.ts:157`)
 * and pass it through to `sendCoachPrompt`. Flag off → legacy behavior
 * (hardcoded 'cloud' return annotation).
 *
 * Gemma-first fallback: when BOTH the pipeline master flag AND the model
 * dispatch flag are on, we attempt Gemma first (regardless of the env
 * resolver, since the cost-aware dispatcher considers drill explanations
 * tactical), and fall back to the cloud on any error.
 *
 * Provider label (#539): the returned `provider` field always reflects
 * which path actually produced the text — `'gemma'` when the Gemma-first
 * attempt succeeded, `'openai'` when the OpenAI edge function produced
 * the reply (either as primary or as the Gemma-fallback). Legacy mode
 * (pipelineV2 off) still returns `'cloud'` for backward compatibility.
 */
export async function explainDrill(input: ExplainDrillInput): Promise<ExplainDrillResult> {
  const messages = buildDrillExplainerMessages(input);
  const pipelineV2 = isCoachPipelineV2Enabled();
  const dispatchOn = isDispatchEnabled();
  const gemmaFirst = pipelineV2 && dispatchOn;
  const resolvedProvider: 'gemma' | 'openai' | null = pipelineV2
    ? resolveDrillProvider()
    : null;

  const context = { focus: 'drill-explainer', sessionId: undefined };

  // Pipeline-v2: pass taskKind so the dispatcher recognises this as a
  // tactical `fault_explainer` (→ Gemma tier) rather than falling back to
  // general_chat, and so cost-tracker telemetry (#537) labels correctly.
  // Wave-34: even in legacy flag-off mode we annotate the taskKind for
  // cost-tracker bucketing. No provider hint is attached in legacy mode
  // (the legacy cloud provider resolves inside coach-service).
  const taskKindOpts = { taskKind: 'fault_explainer' as const };

  // Gemma-first attempt (both flags on). On any error we fall through to the
  // env-resolved provider below. Success returns provider='gemma' (#539).
  if (gemmaFirst) {
    try {
      // taskKind='fault_explainer' slots this call into the tactical
      // Gemma bucket of the dispatch router (see coach-model-dispatch.ts).
      const reply = await sendCoachPrompt(messages, context, {
        ...taskKindOpts,
        provider: 'gemma',
      });
      const text = (reply.content ?? '').trim();
      if (text) {
        return { explanation: text, provider: 'gemma' };
      }
      // Empty Gemma reply → fall through to cloud so the user still sees
      // something actionable.
    } catch {
      // Swallow and fall through to cloud. We deliberately don't log the
      // error here — sendCoachPrompt already logs structured errors via
      // ErrorHandler; duplicating the warning would pollute the toast UX.
    }
  }

  // Provider label (#539): the fallback path always lands on the OpenAI
  // edge function — we either hint 'openai' explicitly, let the resolver
  // resolve to 'openai' (when env=openai), OR we arrive here as the
  // Gemma-fallback. In every modern case the reply is authored by
  // OpenAI, so the returned label is 'openai'. Legacy mode (pipelineV2
  // off) preserves the historical 'cloud' label.
  const fallbackProvider: DrillExplainerProvider = pipelineV2 ? 'openai' : 'cloud';

  try {
    const cloudOpts = resolvedProvider
      ? { ...taskKindOpts, provider: resolvedProvider }
      : taskKindOpts;
    const reply = await sendCoachPrompt(messages, context, cloudOpts);
    const text = (reply.content ?? '').trim();
    const actualProvider = mapToDrillProvider(reply.provider) ?? fallbackProvider;
    if (!text) {
      return { explanation: '', provider: actualProvider, error: 'Empty response from coach.' };
    }
    return { explanation: text, provider: actualProvider };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown coach error';
    return {
      explanation: '',
      provider: fallbackProvider,
      error: message,
    };
  }
}

export const DRILL_EXPLAINER_SYSTEM_PROMPT = SYSTEM_PROMPT;
